import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { pool, transaction } from '../db.js';
import { makeNo, shanghaiToday, toUtcSql } from '../utils.js';

function shanghaiDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000 + 8 * 3600000);
  return d.toISOString().slice(0, 10);
}

function utc(date, time) {
  return toUtcSql(date + 'T' + time + ':00');
}

async function addSchedule(conn, { dentistId, clinicId, date, start, end, coordinatorId, qualificationIds, status = 'PUBLISHED' }) {
  const [result] = await conn.execute(
    "INSERT INTO dentist_schedule (dentist_id,clinic_id,available_start_at,available_end_at,transfer_minutes,status,coordinator_user_id) VALUES (?,?,?,?,30,?,?)",
    [dentistId, clinicId, utc(date,start), utc(date,end), status, coordinatorId]
  );
  for (const q of qualificationIds) await conn.execute('INSERT INTO schedule_qualification (schedule_id,qualification_id) VALUES (?,?)',[result.insertId,q]);
  return result.insertId;
}

async function addAppointment(conn, { patientId,dentistId,clinicId,scheduleId,date,start,end,status,expected,createdBy }) {
  const no=makeNo('APT');
  const [result]=await conn.execute(
    "INSERT INTO appointment (appointment_no,patient_id,dentist_id,clinic_id,schedule_id,scheduled_start_at,scheduled_end_at,expected_treatment,status,created_by_user_id,attendance_recorded_by_user_id,attendance_recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [no,patientId,dentistId,clinicId,scheduleId,utc(date,start),utc(date,end),expected,status,createdBy,status==='ATTENDED'?createdBy:null,status==='ATTENDED'?utc(date,start):null]
  );
  await conn.execute('INSERT INTO patient_clinic_relation (patient_id,clinic_id) VALUES (?,?) ON DUPLICATE KEY UPDATE patient_id=patient_id',[patientId,clinicId]);
  return result.insertId;
}

async function addCompletedVisit(conn, { appointmentId,date,time,patientProblem,treatments,settlementDate,userId }) {
  const visitNo=makeNo('VIS');
  const [visitResult]=await conn.execute(
    "INSERT INTO visit (visit_no,appointment_id,visit_datetime,patient_problem,status) VALUES (?,?,?,?, 'COMPLETED')",
    [visitNo,appointmentId,utc(date,time),patientProblem]
  );
  const details=[];
  for(const t of treatments){
    const [r]=await conn.execute(
      "INSERT INTO treatment_detail (visit_id,treatment_item_id,unit_quantity,unit_price_snapshot,status,recorded_by_user_id) VALUES (?,?,?,?, 'ACTIVE',?)",
      [visitResult.insertId,t.itemId,t.qty,t.price,userId]
    );
    details.push({id:r.insertId,itemId:t.itemId,name:t.name,qty:t.qty,price:t.price});
  }
  const total=details.reduce((sum,d)=>sum+d.qty*d.price,0);
  const [settlementResult]=await conn.execute(
    "INSERT INTO settlement (settlement_no,visit_id,version_no,settlement_date,total_amount,status,generated_by_user_id) VALUES (?,?,1,?,?, 'ACTIVE',?)",
    [makeNo('STL'),visitResult.insertId,utc(settlementDate||date,time),total,userId]
  );
  for(const d of details){
    await conn.execute(
      "INSERT INTO settlement_detail (settlement_id,treatment_detail_id,treatment_item_id,treatment_name_snapshot,unit_quantity_snapshot,unit_price_snapshot,subtotal) VALUES (?,?,?,?,?,?,?)",
      [settlementResult.insertId,d.id,d.itemId,d.name,d.qty,d.price,d.qty*d.price]
    );
  }
  return {visitId:visitResult.insertId,total};
}

async function main(){
  const existing=(await pool.query('SELECT COUNT(*) AS count FROM user_account'))[0][0].count;
  if(Number(existing)>0){ console.log('种子数据未写入：user_account 已有数据。为保护现有数据，本脚本不会清库。'); return; }
  const hash=await bcrypt.hash(config.demoPassword,10);
  const q4=Math.floor((Number(shanghaiToday().slice(5,7))-1)/3)+1;
  const year=Number(shanghaiToday().slice(0,4));
  await transaction(async(conn)=>{
    const userIds={};
    for(const [username,name,role] of [
      ['hqadmin','总部管理员','HQ_MANAGER'],['frontdesk','天河前台','FRONT_DESK'],['manager1','天河主管','CLINIC_MANAGER'],['manager2','越秀主管','CLINIC_MANAGER']
    ]){
      const [r]=await conn.execute('INSERT INTO user_account (username,password_hash,display_name,role_code) VALUES (?,?,?,?)',[username,hash,name,role]);
      userIds[username]=r.insertId;
    }
    const clinicRows=[];
    for(const [no,address,manager,phone,email,area] of [
      ['ADC-001','广州市天河区体育西路 101 号','陈晓','020-88880001','tianhe@adc-dental.cn',860.5],
      ['ADC-002','广州市越秀区中山五路 88 号','梁敏','020-88880002','yuexiu@adc-dental.cn',620.0],
      ['ADC-003','深圳市南山区科技园科苑路 66 号','赵磊','0755-86660003','nanshan@adc-dental.cn',780.0]
    ]){
      const [r]=await conn.execute('INSERT INTO clinic (clinic_no,postal_address,manager_name,phone,email,office_area_sqm) VALUES (?,?,?,?,?,?)',[no,address,manager,phone,email,area]);
      clinicRows.push(r.insertId);
    }
    await conn.execute('INSERT INTO user_clinic_scope (user_id,clinic_id) VALUES (?,?),(?,?),(?,?),(?,?)',[userIds.frontdesk,clinicRows[0],userIds.frontdesk,clinicRows[1],userIds.manager1,clinicRows[0],userIds.manager2,clinicRows[1]]);
    const quals={};
    for(const [name] of [['牙体牙髓'],['儿童口腔'],['口腔种植'],['口腔正畸'],['口腔外科']]){
      const [r]=await conn.execute('INSERT INTO qualification (qualification_name) VALUES (?)',[name]);
      quals[name]=r.insertId;
    }
    const dentists=[];
    const dentistDefs=[
      ['dentist1','张明','D001','1990-03-12','广州市天河区','13800010001','zhangming@adc-dental.cn',['牙体牙髓','口腔外科']],
      ['dentist2','李悦','D002','1992-07-08','广州市越秀区','13800010002','liyue@adc-dental.cn',['儿童口腔','口腔正畸']],
      ['dentist3','王浩','D003','1987-11-21','深圳市南山区','13800010003','wanghao@adc-dental.cn',['口腔种植','牙体牙髓']],
      ['dentist4','周宁','D004','1991-02-16','广州市海珠区','13800010004','zhouning@adc-dental.cn',['口腔正畸','儿童口腔']]
    ];
    for(const [username,name,employeeNo,birth,address,phone,email,qnames] of dentistDefs){
      const [u]=await conn.execute("INSERT INTO user_account (username,password_hash,display_name,role_code) VALUES (?,?,?,'DENTIST')",[username,hash,name]);
      const [d]=await conn.execute('INSERT INTO dentist_profile (user_id,employee_no,birth_date,home_address,phone,email) VALUES (?,?,?,?,?,?)',[u.insertId,employeeNo,birth,address,phone,email]);
      for(const qn of qnames) await conn.execute("INSERT INTO dentist_qualification (dentist_id,qualification_id,obtained_date,verification_status,verified_by_user_id,verified_at) VALUES (?,?,?, 'VERIFIED',?,UTC_TIMESTAMP(6))",[d.insertId,quals[qn],'2018-01-01',userIds.hqadmin]);
      dentists.push({id:d.insertId,userId:u.insertId,name});
    }
    const treatments={};
    const treatmentDefs=[['初诊检查',120],['超声波洁牙',280],['树脂充填',480],['根管治疗',1600],['全瓷牙冠',2800],['种植体植入',6800],['儿童涂氟',180],['拔牙',420],['口腔X光片',80]];
    for(const [name,price] of treatmentDefs){
      const [item]=await conn.execute('INSERT INTO treatment_item (treatment_name) VALUES (?)',[name]);
      await conn.execute("INSERT INTO treatment_price (treatment_item_id,version_no,standard_unit_price,effective_from,approval_status,approved_by_user_id,approved_at,created_by_user_id) VALUES (?,1,?,'2026-01-01','APPROVED',?,UTC_TIMESTAMP(6),?)",[item.insertId,price,userIds.hqadmin,userIds.hqadmin]);
      treatments[name]={id:item.insertId,price};
    }
    const patients=[];
    const patientDefs=[
      ['林可','1994-05-20','广州市天河区华穗路 18 号','13910001001','linc@example.com','林先生','13920001001',[['青霉素','皮试阳性','CONFIRMED']]],
      ['黄思远','1988-09-03','广州市越秀区东风中路 90 号','13910001002',null,'黄女士','13920001002',[['乳胶','接触后皮疹','CONFIRMED']]],
      ['陈一诺','2017-12-11','广州市天河区珠江新城 12 号','13910001003','chenyn@example.com','陈先生','13920001003',[['暂无已知过敏','待复诊确认','PENDING']]],
      ['吴洁','1979-01-28','深圳市南山区科苑路 9 号','13910001004','wujie@example.com','吴先生','13920001004',[]],
      ['何嘉','1996-06-16','广州市海珠区江南大道 66 号','13910001005',null,'何女士','13920001005',[['金属','牙冠材料需替代','CONFIRMED']]],
      ['邓晨','2001-10-07','广州市荔湾区芳村大道 15 号','13910001006','dengc@example.com','邓女士','13920001006',[]]
    ];
    for(const [name,birth,address,phone,email,ecn,ecp,allergies] of patientDefs){
      const [p]=await conn.execute('INSERT INTO patient (patient_no,patient_name,birth_date,billing_address,phone,email,emergency_contact_name,emergency_contact_phone) VALUES (?,?,?,?,?,?,?,?)',[makeNo('PAT'),name,birth,address,phone,email,ecn,ecp]);
      for(const [allergyName,note,status] of allergies) await conn.execute('INSERT INTO patient_allergy (patient_id,allergy_name,note,confirmation_status) VALUES (?,?,?,?)',[p.insertId,allergyName,note,status]);
      patients.push(p.insertId);
    }
    const schedules={};
    const schedule = async(dentist,clinic,dOffset,start,end,qs)=>{ const date=shanghaiDate(dOffset); const id=await addSchedule(conn,{dentistId:dentist.id,clinicId:clinic,date,start,end,coordinatorId:userIds.hqadmin,qualificationIds:qs.map(q=>quals[q])}); schedules[dentist.id+'-'+date+'-'+start]=id; return id; };
    const d1s1=await schedule(dentists[0],clinicRows[0],-15,'09:00','18:00',['牙体牙髓']);
    const d1s2=await schedule(dentists[0],clinicRows[0],-10,'09:00','18:00',['牙体牙髓']);
    const d2s1=await schedule(dentists[1],clinicRows[1],-12,'09:00','18:00',['儿童口腔']);
    const d3s1=await schedule(dentists[2],clinicRows[2],-8,'09:00','18:00',['口腔种植']);
    const d2s2=await schedule(dentists[1],clinicRows[0],-5,'09:00','18:00',['儿童口腔']);
    const d1f1=await schedule(dentists[0],clinicRows[0],1,'09:00','18:00',['牙体牙髓']);
    const d2f1=await schedule(dentists[1],clinicRows[1],2,'09:00','18:00',['儿童口腔']);
    const d3f1=await schedule(dentists[2],clinicRows[2],3,'09:00','18:00',['口腔种植']);
    const d4f1=await schedule(dentists[3],clinicRows[1],4,'09:00','18:00',['口腔正畸']);
    const d1f2=await schedule(dentists[0],clinicRows[0],6,'09:00','18:00',['牙体牙髓']);
    const a1=await addAppointment(conn,{patientId:patients[0],dentistId:dentists[0].id,clinicId:clinicRows[0],scheduleId:d1s1,date:shanghaiDate(-15),start:'09:00',end:'10:00',status:'ATTENDED',expected:'洁牙与树脂充填',createdBy:userIds.frontdesk});
    const a2=await addAppointment(conn,{patientId:patients[1],dentistId:dentists[0].id,clinicId:clinicRows[0],scheduleId:d1s2,date:shanghaiDate(-10),start:'10:00',end:'11:30',status:'ATTENDED',expected:'根管治疗',createdBy:userIds.frontdesk});
    const a3=await addAppointment(conn,{patientId:patients[2],dentistId:dentists[1].id,clinicId:clinicRows[1],scheduleId:d2s1,date:shanghaiDate(-12),start:'10:00',end:'11:00',status:'ATTENDED',expected:'儿童涂氟',createdBy:userIds.frontdesk});
    const a4=await addAppointment(conn,{patientId:patients[3],dentistId:dentists[2].id,clinicId:clinicRows[2],scheduleId:d3s1,date:shanghaiDate(-8),start:'14:00',end:'16:00',status:'ATTENDED',expected:'种植咨询与影像检查',createdBy:userIds.frontdesk});
    const a5=await addAppointment(conn,{patientId:patients[4],dentistId:dentists[1].id,clinicId:clinicRows[0],scheduleId:d2s2,date:shanghaiDate(-5),start:'11:00',end:'12:00',status:'ATTENDED',expected:'儿童口腔复诊',createdBy:userIds.frontdesk});
    await addCompletedVisit(conn,{appointmentId:a1,date:shanghaiDate(-15),time:'09:10',patientProblem:'牙结石与后牙龋齿',treatments:[{itemId:treatments['超声波洁牙'].id,name:'超声波洁牙',qty:1,price:280},{itemId:treatments['树脂充填'].id,name:'树脂充填',qty:1,price:480}],settlementDate:shanghaiDate(-15),userId:dentists[0].userId});
    await addCompletedVisit(conn,{appointmentId:a2,date:shanghaiDate(-10),time:'10:05',patientProblem:'右上磨牙慢性牙髓炎',treatments:[{itemId:treatments['根管治疗'].id,name:'根管治疗',qty:1,price:1600},{itemId:treatments['口腔X光片'].id,name:'口腔X光片',qty:1,price:80}],settlementDate:shanghaiDate(-10),userId:dentists[0].userId});
    await addCompletedVisit(conn,{appointmentId:a3,date:shanghaiDate(-12),time:'10:15',patientProblem:'儿童龋齿预防',treatments:[{itemId:treatments['儿童涂氟'].id,name:'儿童涂氟',qty:1,price:180},{itemId:treatments['初诊检查'].id,name:'初诊检查',qty:1,price:120}],settlementDate:shanghaiDate(-12),userId:dentists[1].userId});
    await addCompletedVisit(conn,{appointmentId:a4,date:shanghaiDate(-8),time:'14:10',patientProblem:'右下后牙缺失，评估种植',treatments:[{itemId:treatments['种植体植入'].id,name:'种植体植入',qty:1,price:6800},{itemId:treatments['初诊检查'].id,name:'初诊检查',qty:1,price:120}],settlementDate:shanghaiDate(-8),userId:dentists[2].userId});
    const [visit5]=await conn.execute("INSERT INTO visit (visit_no,appointment_id,visit_datetime,patient_problem,status) VALUES (?,?,?,?, 'COMPLETED')",[makeNo('VIS'),a5,utc(shanghaiDate(-5),'11:10'),'儿童口腔复诊，待前台结算']);
    await conn.execute("INSERT INTO treatment_detail (visit_id,treatment_item_id,unit_quantity,unit_price_snapshot,status,recorded_by_user_id) VALUES (?,?,1,?,'ACTIVE',?)",[visit5.insertId,treatments['初诊检查'].id,treatments['初诊检查'].price,dentists[1].userId]);
    const a6=await addAppointment(conn,{patientId:patients[5],dentistId:dentists[0].id,clinicId:clinicRows[0],scheduleId:d1f1,date:shanghaiDate(1),start:'09:30',end:'10:30',status:'SCHEDULED',expected:'首次检查与洁牙',createdBy:userIds.frontdesk});
    await addAppointment(conn,{patientId:patients[2],dentistId:dentists[1].id,clinicId:clinicRows[1],scheduleId:d2f1,date:shanghaiDate(2),start:'10:00',end:'11:00',status:'SCHEDULED',expected:'儿童口腔复诊',createdBy:userIds.frontdesk});
    await addAppointment(conn,{patientId:patients[4],dentistId:dentists[2].id,clinicId:clinicRows[2],scheduleId:d3f1,date:shanghaiDate(3),start:'14:00',end:'16:00',status:'SCHEDULED',expected:'种植方案沟通',createdBy:userIds.frontdesk});
    await addAppointment(conn,{patientId:patients[1],dentistId:dentists[3].id,clinicId:clinicRows[1],scheduleId:d4f1,date:shanghaiDate(4),start:'11:00',end:'12:00',status:'SCHEDULED',expected:'正畸初诊评估',createdBy:userIds.frontdesk});
    await addAppointment(conn,{patientId:patients[0],dentistId:dentists[0].id,clinicId:clinicRows[0],scheduleId:d1f2,date:shanghaiDate(6),start:'15:00',end:'16:00',status:'SCHEDULED',expected:'复查',createdBy:userIds.frontdesk});
    const costs=[
      [dentists[0].id,clinicRows[0],'MEDICAL_SUPPLIES',1200,'DEMO-MED-D1','按牙医季度耗材分摊','VERIFIED'],
      [dentists[0].id,clinicRows[0],'OPERATING_EXPENSE',800,'DEMO-OPS-D1','按牙医接诊面积分摊','VERIFIED'],
      [dentists[1].id,clinicRows[1],'MEDICAL_SUPPLIES',300,'DEMO-MED-D2','按牙医季度耗材分摊','VERIFIED'],
      [dentists[1].id,clinicRows[0],'OPERATING_EXPENSE',450,'DEMO-OPS-D2','按牙医接诊面积分摊','DRAFT'],
      [dentists[2].id,clinicRows[2],'MEDICAL_SUPPLIES',2400,'DEMO-MED-D3','按牙医季度耗材分摊','VERIFIED'],
      [dentists[2].id,clinicRows[2],'OPERATING_EXPENSE',1700,'DEMO-OPS-D3','按牙医接诊面积分摊','VERIFIED']
    ];
    for(const [dentistId,clinicId,type,amount,doc,basis,status] of costs){
      const costEntryNo=makeNo('CST');
      const [costResult]=await conn.execute('INSERT INTO quarterly_cost_entry (cost_entry_no,dentist_id,clinic_id,period_year,quarter_no,cost_type,amount,source_document_no,allocation_basis,status,recorded_by_user_id,verified_by_user_id,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[costEntryNo,dentistId,clinicId,year,q4,type,amount,doc,basis,status,userIds.hqadmin,status==='VERIFIED'?userIds.hqadmin:null,status==='VERIFIED'?utc(shanghaiToday(),'12:00'):null]);
      await conn.execute("INSERT INTO audit_log (actor_user_id,action_type,entity_type,entity_id,after_status,details_json) VALUES (?,?, 'quarterly_cost_entry', ?, ?, ?)",[userIds.hqadmin,status==='VERIFIED'?'VERIFY_COST':'CREATE_COST',costEntryNo,status,JSON.stringify({costEntryId:costResult.insertId,amount,sourceDocumentNo:doc})]);
    }
  });
  console.log('演示数据写入完成。演示账号密码：'+config.demoPassword);
  console.log('账号：hqadmin / frontdesk / manager1 / manager2 / dentist1 / dentist2 / dentist3 / dentist4');
}

main().catch((e)=>{console.error(e);process.exitCode=1}).finally(async()=>{await pool.end()});
