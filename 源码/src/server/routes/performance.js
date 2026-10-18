import { Router } from 'express';
import { z } from 'zod';
import { pool, query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, isHQ } from '../auth.js';
import { asyncHandler, badRequest, conflict } from '../errors.js';
import { currentQuarter, makeNo, nowUtcSql } from '../utils.js';

const router = Router();

function periodFromQuery(req) {
  const q = currentQuarter();
  return {
    year: Number(req.query.year || q.year),
    quarter: Number(req.query.quarter || req.query.quarterNo || q.quarter)
  };
}

async function loadPerformance(req, year, quarter) {
  const params = [year, quarter];
  let dentistFilter = '1=1';
  if (req.user.role === 'DENTIST') { dentistFilter = 'd.dentist_id=?'; params.push(req.user.dentistId); }
  else if (!isHQ(req.user)) {
    if (!req.user.clinicIds.length) dentistFilter = '1=0';
    else {
      dentistFilter = 'EXISTS (SELECT 1 FROM dentist_schedule ds WHERE ds.dentist_id=d.dentist_id AND ds.clinic_id IN (' + req.user.clinicIds.map(()=>'?').join(',') + '))';
      params.push(...req.user.clinicIds);
    }
  }
  return query(
    "SELECT d.dentist_id, d.employee_no, u.display_name AS dentist_name, v.period_year, v.quarter_no, "
    + "v.data_source, v.snapshot_id, v.snapshot_version_no, v.snapshot_confirmed_at, v.recognized_revenue, "
    + "v.settled_visit_count, v.unsettled_visit_count_at_q_end, v.medical_supply_status, v.operating_expense_status, "
    + "v.medical_supply_cost, v.operating_expense, v.draft_cost_entry_count, v.rejected_cost_entry_count, "
    + "v.missing_cost_category_count, v.revenue_data_complete_flag, v.cost_data_complete_flag, "
    + "v.performance_status, v.calculated_net_profit, v.data_cutoff_at, v.data_updated_at "
    + "FROM dentist_profile d JOIN user_account u ON u.user_id=d.user_id AND u.status='ACTIVE' "
    + "LEFT JOIN v_quarterly_dentist_performance v ON v.dentist_id=d.dentist_id AND v.period_year=? AND v.quarter_no=? "
    + "WHERE " + dentistFilter + " ORDER BY u.display_name",
    params
  );
}

function reasonFor(row) {
  if (!row.performance_status) return '本季度暂无绩效数据';
  if (row.performance_status === 'CONFIRMED_COMPLETE') return '已确认快照';
  const reasons=[];
  if (Number(row.draft_cost_entry_count||0)>0) reasons.push('存在 '+row.draft_cost_entry_count+' 条草稿成本');
  if (Number(row.missing_cost_category_count||0)>0) reasons.push('存在 '+row.missing_cost_category_count+' 个缺失成本类别');
  if (Number(row.unsettled_visit_count_at_q_end||0)>0) reasons.push('季度末有 '+row.unsettled_visit_count_at_q_end+' 次未结算就诊');
  if (Number(row.revenue_data_complete_flag||0)!==1) reasons.push('收入数据不完整');
  if (Number(row.cost_data_complete_flag||0)!==1) reasons.push('成本数据不完整');
  return reasons.length?reasons.join('；'):'数据完整，可确认快照';
}

router.get('/', allow('DENTIST','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async(req,res)=>{
  const {year,quarter}=periodFromQuery(req);
  const rows=await loadPerformance(req,year,quarter);
  res.json({year,quarter,items:rows.map((r)=>({
    ...r,
    recognized_revenue:r.recognized_revenue===null?null:Number(r.recognized_revenue),
    medical_supply_cost:r.medical_supply_cost===null?null:Number(r.medical_supply_cost),
    operating_expense:r.operating_expense===null?null:Number(r.operating_expense),
    calculated_net_profit:r.calculated_net_profit===null?null:Number(r.calculated_net_profit),
    performance_status:r.performance_status||'NO_ACTIVITY',
    completeness_reason:reasonFor(r)
  }))});
}));

router.get('/export', allow('CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async(req,res)=>{
  const {year,quarter}=periodFromQuery(req);
  const rows=await loadPerformance(req,year,quarter);
  const header=['牙医员工号','牙医姓名','年度','季度','收入','医疗用品成本','运营费用','净利润','绩效状态','结算就诊数','季度末未结算数','数据截止时间'];
  const lines=[header.join(',')];
  for(const r of rows){
    lines.push([r.employee_no,r.dentist_name,year,quarter,r.recognized_revenue??'',r.medical_supply_cost??'',r.operating_expense??'',r.calculated_net_profit??'',r.performance_status||'NO_ACTIVITY',r.settled_visit_count??0,r.unsettled_visit_count_at_q_end??0,r.data_cutoff_at??''].map((v)=>'"'+String(v).replaceAll('"','""')+'"').join(','));
  }
  await writeAudit(pool,req.user.userId,'EXPORT','v_quarterly_dentist_performance',year+'-Q'+quarter,{details:{rowCount:rows.length},ipAddress:req.ip});
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="performance-'+year+'-Q'+quarter+'.csv"');
  res.send('\uFEFF' + lines.join('\r\n'));
}));

router.post('/confirm', allow('HQ_MANAGER'), asyncHandler(async(req,res)=>{
  const input=z.object({
    dentistId:z.coerce.number().int().positive(),
    year:z.coerce.number().int().min(2000).max(2100),
    quarter:z.coerce.number().int().min(1).max(4),
    correctionReason:z.string().trim().max(500).nullable().optional()
  }).parse(req.body);
  const rows=await query("SELECT * FROM v_quarterly_dentist_performance WHERE dentist_id=? AND period_year=? AND quarter_no=?",[input.dentistId,input.year,input.quarter]);
  const row=rows[0];
  if(!row) throw conflict('本季度没有可确认的绩效数据');
  const correction = Boolean(row.snapshot_id && input.correctionReason);
  if(row.performance_status!=='PROVISIONAL_COMPLETE' && !correction) throw conflict('绩效数据不完整，不能确认快照',{reason:reasonFor(row)});
  if(row.calculated_net_profit===null||row.calculated_net_profit===undefined) throw conflict('净利润不可计算，不能确认快照');
  if(row.snapshot_id&&!input.correctionReason) throw conflict('该季度已有确认快照，更正时必须填写更正原因',{snapshotId:row.snapshot_id});
  if(correction && row.performance_status==='CONFIRMED_COMPLETE') { /* 已确认数据保持完整，可建立更正版本 */ }
  const result=await transaction(async(conn)=>{
    const [versions]=await conn.execute("SELECT COALESCE(MAX(version_no),0)+1 AS next_version, MAX(snapshot_id) AS latest_id FROM quarterly_performance_snapshot WHERE dentist_id=? AND period_year=? AND quarter_no=? FOR UPDATE",[input.dentistId,input.year,input.quarter]);
    const version=Number(versions[0].next_version);
    const latestId=versions[0].latest_id||null;
    const at=nowUtcSql();
    const revenue=Number(row.recognized_revenue);
    const medical=Number(row.medical_supply_cost);
    const operating=Number(row.operating_expense);
    const net=revenue-medical-operating;
    const snapshotNo=makeNo('SNP');
    const [inserted]=await conn.execute(
      "INSERT INTO quarterly_performance_snapshot (snapshot_no,dentist_id,period_year,quarter_no,version_no,recognized_revenue,medical_supply_cost,operating_expense,net_profit,data_complete_status,settled_visit_count,unsettled_visit_count,data_cutoff_at,confirmed_by_user_id,confirmed_at,correction_reason,supersedes_snapshot_id) VALUES (?,?,?,?,?,?,?,?,?,'COMPLETE',?,?,?,?,?,?,?)",
      [snapshotNo,input.dentistId,input.year,input.quarter,version,revenue,medical,operating,net,Number(row.settled_visit_count||0),0,at,req.user.userId,at,input.correctionReason||null,latestId]
    );
    await writeAudit(conn,req.user.userId,version===1?'CONFIRM_PERFORMANCE_SNAPSHOT':'CORRECT_PERFORMANCE_SNAPSHOT','quarterly_performance_snapshot',inserted.insertId,{
      relatedEntityId:input.dentistId,afterStatus:'COMPLETE',reason:input.correctionReason||null,details:{year:input.year,quarter:input.quarter,version,netProfit:net},ipAddress:req.ip
    });
    return {snapshotId:inserted.insertId,snapshotNo,version};
  });
  res.status(201).json(result);
}));

export default router;
