import { Router } from 'express';
import { z } from 'zod';
import { pool, query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, assertClinicAccess, isHQ, scopedClinicSql } from '../auth.js';
import { asyncHandler, conflict, forbidden, notFound } from '../errors.js';
import { asId, dayBounds, nowUtcSql, paged, parsePagination } from '../utils.js';

const router = Router();

async function loadVisit(id) {
  const rows = await query(
    "SELECT v.*, a.appointment_no, a.patient_id, a.dentist_id, a.clinic_id, a.scheduled_start_at, a.scheduled_end_at, a.expected_treatment, "
    + "p.patient_name, p.patient_no, p.phone, p.birth_date, c.clinic_no, c.postal_address, u.display_name AS dentist_name, d.employee_no "
    + "FROM visit v JOIN appointment a ON a.appointment_id=v.appointment_id JOIN patient p ON p.patient_id=a.patient_id "
    + "JOIN clinic c ON c.clinic_id=a.clinic_id JOIN dentist_profile d ON d.dentist_id=a.dentist_id "
    + "JOIN user_account u ON u.user_id=d.user_id WHERE v.visit_id=?",
    [id]
  );
  return rows[0] || null;
}

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const scope = scopedClinicSql(req.user, 'a.clinic_id', req.query.clinicId || null);
  const where = [scope.sql];
  const params = [...scope.params];
  if (req.user.role === 'DENTIST') { where.push('a.dentist_id=?'); params.push(req.user.dentistId); }
  if (req.query.dentistId) { where.push('a.dentist_id=?'); params.push(Number(req.query.dentistId)); }
  if (req.query.patientId) { where.push('a.patient_id=?'); params.push(Number(req.query.patientId)); }
  if (req.query.status) { where.push('v.status=?'); params.push(req.query.status); }
  if (req.query.date) { const b = dayBounds(req.query.date); where.push('v.visit_datetime>=? AND v.visit_datetime<?'); params.push(b.start, b.end); }
  if (req.query.from) { where.push('v.visit_datetime>=?'); params.push(dayBounds(req.query.from).start); }
  if (req.query.to) { where.push('v.visit_datetime<?'); params.push(dayBounds(req.query.to).end); }
  if (req.query.settlementStatus === 'UNSETTLED') where.push("s.settlement_id IS NULL");
  if (req.query.settlementStatus === 'SETTLED') where.push("s.settlement_id IS NOT NULL");
  if (req.query.q) {
    where.push('(v.visit_no LIKE ? OR a.appointment_no LIKE ? OR p.patient_name LIKE ? OR p.patient_no LIKE ? OR u.display_name LIKE ?)');
    const term = '%' + String(req.query.q).trim() + '%';
    params.push(term, term, term, term, term);
  }
  const baseFrom = " FROM visit v JOIN appointment a ON a.appointment_id=v.appointment_id JOIN patient p ON p.patient_id=a.patient_id "
    + "JOIN clinic c ON c.clinic_id=a.clinic_id JOIN dentist_profile d ON d.dentist_id=a.dentist_id "
    + "JOIN user_account u ON u.user_id=d.user_id LEFT JOIN settlement s ON s.visit_id=v.visit_id AND s.status='ACTIVE'";
  const condition = where.join(' AND ');
  const total = (await query("SELECT COUNT(*) AS total " + baseFrom + " WHERE " + condition, params))[0].total;
  const items = await query(
    "SELECT v.*, a.appointment_no, a.patient_id, a.dentist_id, a.clinic_id, p.patient_name, p.patient_no, c.clinic_no, "
    + "u.display_name AS dentist_name, d.employee_no, s.settlement_id, s.settlement_no, s.total_amount, s.status AS settlement_status, "
    + "(SELECT COALESCE(SUM(td.subtotal),0) FROM treatment_detail td WHERE td.visit_id=v.visit_id AND td.status='ACTIVE') AS treatment_total "
    + baseFrom + " WHERE " + condition + " ORDER BY v.visit_datetime DESC LIMIT ? OFFSET ?",
    [...params, pageSize, offset]
  );
  await writeAudit(pool, req.user.userId, 'QUERY', 'visit', null, { details: { route: 'visit-list', filters: req.query }, ipAddress: req.ip });
  res.json(paged(items, Number(total), page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const visit = await loadVisit(id);
  if (!visit) throw notFound('就诊记录不存在');
  assertClinicAccess(req.user, visit.clinic_id);
  if (req.user.role === 'DENTIST' && Number(req.user.dentistId) !== Number(visit.dentist_id)) throw forbidden('只能查看自己的接诊记录');
  const [treatments, allergies, settlements, history] = await Promise.all([
    query("SELECT td.*, ti.treatment_name, ti.status AS item_status FROM treatment_detail td JOIN treatment_item ti ON ti.treatment_item_id=td.treatment_item_id WHERE td.visit_id=? ORDER BY td.recorded_at", [id]),
    query("SELECT * FROM patient_allergy WHERE patient_id=? ORDER BY confirmation_status, allergy_name", [visit.patient_id]),
    query("SELECT s.*, u.display_name AS generated_by_name, vu.display_name AS voided_by_name FROM settlement s JOIN user_account u ON u.user_id=s.generated_by_user_id LEFT JOIN user_account vu ON vu.user_id=s.voided_by_user_id WHERE s.visit_id=? ORDER BY s.version_no DESC", [id]),
    query("SELECT v.visit_id, v.visit_no, v.visit_datetime, v.status, v.patient_problem, c.clinic_no, u.display_name AS dentist_name FROM visit v JOIN appointment a ON a.appointment_id=v.appointment_id JOIN clinic c ON c.clinic_id=a.clinic_id JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id WHERE a.patient_id=? AND v.visit_id<>? ORDER BY v.visit_datetime DESC LIMIT 12", [visit.patient_id, id])
  ]);
  res.json({ visit, treatments, allergies, settlements, history });
}));

router.put('/:id', allow('DENTIST','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = z.object({
    patientProblem: z.string().trim().min(1).max(1000).optional(),
    specialNeeds: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(['IN_PROGRESS','COMPLETED']).optional()
  }).parse(req.body);
  const visit = await loadVisit(id);
  if (!visit) throw notFound('就诊记录不存在');
  assertClinicAccess(req.user, visit.clinic_id);
  if (req.user.role === 'DENTIST' && Number(req.user.dentistId) !== Number(visit.dentist_id)) throw forbidden('只能维护自己的接诊记录');
  await transaction(async (conn) => {
    await conn.execute(
      'UPDATE visit SET patient_problem=?, special_needs=?, status=? WHERE visit_id=?',
      [input.patientProblem ?? visit.patient_problem, input.specialNeeds === undefined ? visit.special_needs : (input.specialNeeds || null), input.status ?? visit.status, id]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'visit', id, {
      beforeStatus: visit.status, afterStatus: input.status ?? visit.status, details: { fields: Object.keys(input) }, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

router.post('/:id/treatments', allow('DENTIST','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = z.object({
    treatmentItemId: z.coerce.number().int().positive(),
    unitQuantity: z.coerce.number().positive().max(999),
    expectedUnitPrice: z.coerce.number().nonnegative().nullable().optional()
  }).parse(req.body);
  const visit = await loadVisit(id);
  if (!visit) throw notFound('就诊记录不存在');
  assertClinicAccess(req.user, visit.clinic_id);
  if (req.user.role === 'DENTIST' && Number(req.user.dentistId) !== Number(visit.dentist_id)) throw forbidden('只能记录自己的接诊治疗');
  const treatmentDetailId = await transaction(async (conn) => {
    const [active] = await conn.execute("SELECT settlement_id FROM settlement WHERE visit_id=? AND status='ACTIVE'", [id]);
    if (active.length) throw conflict('该就诊已有有效结算单，不能追加治疗');
    const [visits] = await conn.execute("SELECT status FROM visit WHERE visit_id=? FOR UPDATE", [id]);
    if (visits[0].status === 'VOID') throw conflict('已作废就诊不能追加治疗');
    const [items] = await conn.execute("SELECT * FROM treatment_item WHERE treatment_item_id=? AND status='ACTIVE'", [input.treatmentItemId]);
    if (!items[0]) throw conflict('治疗项目不存在或已停用');
    const [prices] = await conn.execute(
      "SELECT standard_unit_price FROM treatment_price WHERE treatment_item_id=? AND approval_status='APPROVED' "
      + "AND effective_from <= DATE(CONVERT_TZ(?, '+00:00', '+08:00')) ORDER BY effective_from DESC, version_no DESC LIMIT 1",
      [input.treatmentItemId, visit.visit_datetime]
    );
    if (!prices[0]) throw conflict('治疗项目在就诊日期没有已生效的标准单价');
    const price = Number(prices[0].standard_unit_price);
    if (input.expectedUnitPrice !== null && input.expectedUnitPrice !== undefined && Math.abs(input.expectedUnitPrice - price) > 0.001) {
      throw conflict('标准单价已变化，请刷新后重新确认', { currentPrice: price });
    }
    const [result] = await conn.execute(
      "INSERT INTO treatment_detail (visit_id, treatment_item_id, unit_quantity, unit_price_snapshot, status, recorded_by_user_id) VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
      [id, input.treatmentItemId, input.unitQuantity, price, req.user.userId]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'visit', id, {
      relatedEntityId: result.insertId, afterStatus: visits[0].status,
      details: { action: 'ADD_TREATMENT', treatmentItemId: input.treatmentItemId, unitQuantity: input.unitQuantity, unitPrice: price }, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.status(201).json({ treatmentDetailId });
}));


router.post('/:id/treatments/:treatmentDetailId/void', allow('DENTIST','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const visitId = asId(req.params.id);
  const detailId = asId(req.params.treatmentDetailId);
  const reason = z.object({ reason: z.string().trim().min(1).max(255) }).parse(req.body).reason;
  const visit = await loadVisit(visitId);
  if (!visit) throw notFound('就诊记录不存在');
  assertClinicAccess(req.user, visit.clinic_id);
  if (req.user.role === 'DENTIST' && Number(req.user.dentistId) !== Number(visit.dentist_id)) throw forbidden('只能维护自己的接诊治疗');
  await transaction(async (conn) => {
    const [active] = await conn.execute("SELECT settlement_id FROM settlement WHERE visit_id=? AND status='ACTIVE'", [visitId]);
    if (active.length) throw conflict('该就诊已有有效结算单，不能作废治疗明细');
    const [rows] = await conn.execute("SELECT * FROM treatment_detail WHERE treatment_detail_id=? AND visit_id=? FOR UPDATE", [detailId, visitId]);
    if (!rows[0]) throw notFound('治疗明细不存在');
    if (rows[0].status !== 'ACTIVE') throw conflict('治疗明细已作废');
    await conn.execute(
      "UPDATE treatment_detail SET status='VOID', void_reason=?, voided_by_user_id=?, voided_at=? WHERE treatment_detail_id=?",
      [reason, req.user.userId, nowUtcSql(), detailId]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'treatment_detail', detailId, {
      relatedEntityId: visitId, beforeStatus: 'ACTIVE', afterStatus: 'VOID', reason, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

export default router;
