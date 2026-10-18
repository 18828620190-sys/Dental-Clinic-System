import { Router } from 'express';
import { z } from 'zod';
import { pool, query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, assertClinicAccess, isHQ, scopedClinicSql } from '../auth.js';
import { asyncHandler, conflict, notFound } from '../errors.js';
import { asId, makeNo, nowUtcSql, paged, parsePagination } from '../utils.js';

const router = Router();
const costSchema = z.object({
  dentistId: z.coerce.number().int().positive(),
  clinicId: z.coerce.number().int().positive().nullable().optional(),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  quarterNo: z.coerce.number().int().min(1).max(4),
  costType: z.enum(['MEDICAL_SUPPLIES','OPERATING_EXPENSE']),
  amount: z.coerce.number().min(0),
  sourceDocumentNo: z.string().trim().max(64).nullable().optional(),
  sourceLineNo: z.string().trim().max(32).nullable().optional(),
  allocationBasis: z.string().trim().min(1).max(255)
});

function scopeCondition(user, requestedClinicId) {
  if (requestedClinicId) {
    assertClinicAccess(user, requestedClinicId);
    return { sql: 'ce.clinic_id=?', params:[Number(requestedClinicId)] };
  }
  if (isHQ(user)) return { sql:'1=1', params:[] };
  if (!user.clinicIds.length) return { sql:'1=0', params:[] };
  return { sql:'ce.clinic_id IN ('+user.clinicIds.map(()=>'?').join(',')+')', params:user.clinicIds };
}

router.get('/', allow('CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const { page,pageSize,offset } = parsePagination(req.query);
  const scope = scopeCondition(req.user, req.query.clinicId || null);
  const where=[scope.sql]; const params=[...scope.params];
  if (req.query.periodYear) { where.push('ce.period_year=?'); params.push(Number(req.query.periodYear)); }
  if (req.query.quarterNo) { where.push('ce.quarter_no=?'); params.push(Number(req.query.quarterNo)); }
  if (req.query.dentistId) { where.push('ce.dentist_id=?'); params.push(Number(req.query.dentistId)); }
  if (req.query.status) { where.push('ce.status=?'); params.push(req.query.status); }
  if (req.query.costType) { where.push('ce.cost_type=?'); params.push(req.query.costType); }
  const condition=where.join(' AND ');
  const total=(await query('SELECT COUNT(*) AS total FROM quarterly_cost_entry ce WHERE '+condition,params))[0].total;
  const items=await query(
    "SELECT ce.*, u.display_name AS dentist_name, d.employee_no, c.clinic_no, r.display_name AS recorder_name, v.display_name AS verifier_name "
    + "FROM quarterly_cost_entry ce JOIN dentist_profile d ON d.dentist_id=ce.dentist_id JOIN user_account u ON u.user_id=d.user_id "
    + "LEFT JOIN clinic c ON c.clinic_id=ce.clinic_id JOIN user_account r ON r.user_id=ce.recorded_by_user_id "
    + "LEFT JOIN user_account v ON v.user_id=ce.verified_by_user_id WHERE "+condition
    + " ORDER BY ce.period_year DESC, ce.quarter_no DESC, ce.recorded_at DESC LIMIT ? OFFSET ?",
    [...params,pageSize,offset]
  );
  res.json(paged(items,Number(total),page,pageSize));
}));

router.post('/', allow('CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req,res)=>{
  const input=costSchema.parse(req.body);
  if (input.clinicId) assertClinicAccess(req.user,input.clinicId);
  const costEntryId=await transaction(async(conn)=>{
    const costEntryNo=makeNo('CST');
    const [result]=await conn.execute(
      "INSERT INTO quarterly_cost_entry (cost_entry_no, dentist_id, clinic_id, period_year, quarter_no, cost_type, amount, source_document_no, source_line_no, allocation_basis, status, recorded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)",
      [costEntryNo,input.dentistId,input.clinicId||null,input.periodYear,input.quarterNo,input.costType,input.amount,input.sourceDocumentNo||null,input.sourceLineNo||null,input.allocationBasis,req.user.userId]
    );
    await writeAudit(conn,req.user.userId,'CREATE_COST','quarterly_cost_entry',costEntryNo,{afterStatus:'DRAFT',relatedEntityId:input.clinicId||null,details:{costEntryId:result.insertId,...input},ipAddress:req.ip});
    return result.insertId;
  });
  res.status(201).json({costEntryId});
}));

router.put('/:id', allow('CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async(req,res)=>{
  const id=asId(req.params.id);
  const input=costSchema.partial().parse(req.body);
  await transaction(async(conn)=>{
    const [rows]=await conn.execute('SELECT * FROM quarterly_cost_entry WHERE cost_entry_id=? FOR UPDATE',[id]);
    const existing=rows[0];
    if(!existing) throw notFound('成本记录不存在');
    if(existing.clinic_id) assertClinicAccess(req.user,existing.clinic_id);
    if(existing.status!=='DRAFT') throw conflict('只有草稿成本可以修改');
    const next={...existing,...{
      dentist_id:input.dentistId??existing.dentist_id, clinic_id:input.clinicId===undefined?existing.clinic_id:input.clinicId,
      period_year:input.periodYear??existing.period_year, quarter_no:input.quarterNo??existing.quarter_no,
      cost_type:input.costType??existing.cost_type, amount:input.amount??existing.amount,
      source_document_no:input.sourceDocumentNo===undefined?existing.source_document_no:input.sourceDocumentNo,
      source_line_no:input.sourceLineNo===undefined?existing.source_line_no:input.sourceLineNo,
      allocation_basis:input.allocationBasis??existing.allocation_basis
    }};
    await conn.execute(
      "UPDATE quarterly_cost_entry SET dentist_id=?, clinic_id=?, period_year=?, quarter_no=?, cost_type=?, amount=?, source_document_no=?, source_line_no=?, allocation_basis=? WHERE cost_entry_id=?",
      [next.dentist_id,next.clinic_id,next.period_year,next.quarter_no,next.cost_type,next.amount,next.source_document_no,next.source_line_no,next.allocation_basis,id]
    );
    await writeAudit(conn,req.user.userId,'CREATE_COST','quarterly_cost_entry',existing.cost_entry_no,{afterStatus:'DRAFT',details:{costEntryId:id,fields:Object.keys(input)},ipAddress:req.ip});
  });
  res.json({ok:true});
}));

router.post('/:id/verify', allow('CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async(req,res)=>{
  const id=asId(req.params.id);
  await transaction(async(conn)=>{
    const [rows]=await conn.execute('SELECT * FROM quarterly_cost_entry WHERE cost_entry_id=? FOR UPDATE',[id]);
    const cost=rows[0]; if(!cost) throw notFound('成本记录不存在');
    if(cost.clinic_id) assertClinicAccess(req.user,cost.clinic_id);
    if(cost.status!=='DRAFT') throw conflict('只有草稿成本可以审核');
    await conn.execute("UPDATE quarterly_cost_entry SET status='VERIFIED', verified_by_user_id=?, verified_at=? WHERE cost_entry_id=?",[req.user.userId,nowUtcSql(),id]);
    await writeAudit(conn,req.user.userId,'VERIFY_COST','quarterly_cost_entry',cost.cost_entry_no,{beforeStatus:'DRAFT',afterStatus:'VERIFIED',reason:'成本审核通过',details:{costEntryId:id},ipAddress:req.ip});
  });
  res.json({ok:true});
}));

router.post('/:id/reject', allow('CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async(req,res)=>{
  const id=asId(req.params.id);
  const reason=z.object({reason:z.string().trim().min(1).max(255)}).parse(req.body).reason;
  await transaction(async(conn)=>{
    const [rows]=await conn.execute('SELECT * FROM quarterly_cost_entry WHERE cost_entry_id=? FOR UPDATE',[id]);
    const cost=rows[0]; if(!cost) throw notFound('成本记录不存在');
    if(cost.clinic_id) assertClinicAccess(req.user,cost.clinic_id);
    if(cost.status!=='DRAFT') throw conflict('只有草稿成本可以驳回');
    await conn.execute("UPDATE quarterly_cost_entry SET status='REJECTED', verified_by_user_id=?, verified_at=? WHERE cost_entry_id=?",[req.user.userId,nowUtcSql(),id]);
    await writeAudit(conn,req.user.userId,'REJECT_COST','quarterly_cost_entry',cost.cost_entry_no,{beforeStatus:'DRAFT',afterStatus:'REJECTED',reason,details:{costEntryId:id},ipAddress:req.ip});
  });
  res.json({ok:true});
}));

export default router;
