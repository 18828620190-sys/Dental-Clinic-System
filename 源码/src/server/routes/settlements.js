import { Router } from 'express';
import { z } from 'zod';
import { pool, query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, assertClinicAccess, scopedClinicSql } from '../auth.js';
import { asyncHandler, conflict, notFound } from '../errors.js';
import { asId, dayBounds, nowUtcSql, paged, parsePagination } from '../utils.js';
import { createSettlement } from '../services/settlementService.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const scope = scopedClinicSql(req.user, 'a.clinic_id', req.query.clinicId || null);
  const where = [scope.sql];
  const params = [...scope.params];
  if (req.user.role === 'DENTIST') { where.push('a.dentist_id=?'); params.push(req.user.dentistId); }
  if (req.query.status) { where.push('s.status=?'); params.push(req.query.status); }
  if (req.query.patientId) { where.push('a.patient_id=?'); params.push(Number(req.query.patientId)); }
  if (req.query.date) { const b = dayBounds(req.query.date); where.push('s.settlement_date>=? AND s.settlement_date<?'); params.push(b.start,b.end); }
  if (req.query.from) { where.push('s.settlement_date>=?'); params.push(dayBounds(req.query.from).start); }
  if (req.query.to) { where.push('s.settlement_date<?'); params.push(dayBounds(req.query.to).end); }
  if (req.query.q) {
    where.push('(s.settlement_no LIKE ? OR p.patient_name LIKE ? OR p.patient_no LIKE ? OR v.visit_no LIKE ?)');
    const term='%'+String(req.query.q).trim()+'%'; params.push(term,term,term,term);
  }
  const base = " FROM settlement s JOIN visit v ON v.visit_id=s.visit_id JOIN appointment a ON a.appointment_id=v.appointment_id "
    + "JOIN patient p ON p.patient_id=a.patient_id JOIN clinic c ON c.clinic_id=a.clinic_id "
    + "JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id";
  const condition = where.join(' AND ');
  const total = (await query('SELECT COUNT(*) AS total '+base+' WHERE '+condition, params))[0].total;
  const items = await query(
    "SELECT s.*, v.visit_no, v.visit_datetime, a.appointment_no, p.patient_name, p.patient_no, c.clinic_no, u.display_name AS dentist_name "
    + "FROM settlement s JOIN visit v ON v.visit_id=s.visit_id JOIN appointment a ON a.appointment_id=v.appointment_id "
    + "JOIN patient p ON p.patient_id=a.patient_id JOIN clinic c ON c.clinic_id=a.clinic_id "
    + "JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id "
    + "WHERE "+condition+" ORDER BY s.settlement_date DESC LIMIT ? OFFSET ?",
    [...params,pageSize,offset]
  );
  await writeAudit(pool, req.user.userId, 'QUERY', 'settlement', null, { details: { route: 'settlement-list', filters: req.query }, ipAddress: req.ip });
  res.json(paged(items, Number(total), page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const settlement = (await query(
    "SELECT s.*, v.visit_no, v.visit_datetime, v.patient_problem, a.appointment_no, a.clinic_id, a.patient_id, a.dentist_id, "
    + "p.patient_name, p.patient_no, p.phone, c.clinic_no, c.postal_address, u.display_name AS dentist_name, d.employee_no, "
    + "gu.display_name AS generated_by_name, vu.display_name AS voided_by_name "
    + "FROM settlement s JOIN visit v ON v.visit_id=s.visit_id JOIN appointment a ON a.appointment_id=v.appointment_id "
    + "JOIN patient p ON p.patient_id=a.patient_id JOIN clinic c ON c.clinic_id=a.clinic_id "
    + "JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id "
    + "JOIN user_account gu ON gu.user_id=s.generated_by_user_id LEFT JOIN user_account vu ON vu.user_id=s.voided_by_user_id "
    + "WHERE s.settlement_id=?",[id]
  ))[0];
  if (!settlement) throw notFound('结算单不存在');
  assertClinicAccess(req.user, settlement.clinic_id);
  const [details, versions] = await Promise.all([
    query("SELECT * FROM settlement_detail WHERE settlement_id=? ORDER BY settlement_detail_id",[id]),
    query("SELECT settlement_id, settlement_no, version_no, status, total_amount, activated_at, voided_at FROM settlement WHERE visit_id=? ORDER BY version_no DESC",[settlement.visit_id])
  ]);
  await writeAudit(pool, req.user.userId, 'QUERY', 'settlement', id, { details: { route: 'settlement-detail' }, ipAddress: req.ip });
  res.json({ settlement, details, versions });
}));

router.post('/visits/:visitId', allow('FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const visitId = asId(req.params.visitId);
  const input = z.object({ settlementDate: z.string().min(10).nullable().optional() }).parse(req.body || {});
  const visit = (await query("SELECT a.clinic_id FROM visit v JOIN appointment a ON a.appointment_id=v.appointment_id WHERE v.visit_id=?",[visitId]))[0];
  if (!visit) throw notFound('就诊记录不存在');
  assertClinicAccess(req.user, visit.clinic_id);
  const result = await transaction((conn) => createSettlement(conn, {
    visitId, actorUserId: req.user.userId, settlementDate: input.settlementDate || null, ipAddress: req.ip
  }));
  res.status(201).json(result);
}));

router.post('/:id/void', allow('FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const reason = z.object({ reason: z.string().trim().min(1).max(255) }).parse(req.body).reason;
  await transaction(async (conn) => {
    const [rows] = await conn.execute(
      "SELECT s.*, a.clinic_id FROM settlement s JOIN visit v ON v.visit_id=s.visit_id JOIN appointment a ON a.appointment_id=v.appointment_id WHERE s.settlement_id=? FOR UPDATE",
      [id]
    );
    const settlement = rows[0];
    if (!settlement) throw notFound('结算单不存在');
    assertClinicAccess(req.user, settlement.clinic_id);
    if (settlement.status !== 'ACTIVE') throw conflict('结算单已作废');
    const now = nowUtcSql();
    await conn.execute("UPDATE settlement SET status='VOID', voided_at=?, void_reason=?, voided_by_user_id=? WHERE settlement_id=?",[now,reason,req.user.userId,id]);
    await writeAudit(conn, req.user.userId, 'VOID_SETTLEMENT', 'settlement', id, {
      beforeStatus:'ACTIVE', afterStatus:'VOID', relatedEntityId: settlement.visit_id, reason, ipAddress:req.ip
    });
  });
  res.json({ ok:true });
}));

export default router;
