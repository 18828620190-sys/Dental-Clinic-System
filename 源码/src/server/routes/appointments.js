import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, assertClinicAccess, scopedClinicSql } from '../auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../errors.js';
import { asId, dayBounds, makeNo, nowUtcSql, paged, parsePagination, shanghaiToday, toUtcSql } from '../utils.js';
import { assertNoAppointmentConflict, assertScheduleQualifications, assertWindowInsideSchedule, lockPublishedSchedule, validatePatientAndRelation } from '../services/appointmentService.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const scope = scopedClinicSql(req.user, 'a.clinic_id', req.query.clinicId || null);
  const where = [scope.sql];
  const params = [...scope.params];
  if (req.user.role === 'DENTIST') { where.push('a.dentist_id=?'); params.push(req.user.dentistId); }
  if (req.query.dentistId) { where.push('a.dentist_id=?'); params.push(Number(req.query.dentistId)); }
  if (req.query.patientId) { where.push('a.patient_id=?'); params.push(Number(req.query.patientId)); }
  if (req.query.status) { where.push('a.status=?'); params.push(req.query.status); }
  if (req.query.date) {
    const b = dayBounds(req.query.date);
    where.push('a.scheduled_start_at>=? AND a.scheduled_start_at<?');
    params.push(b.start, b.end);
  }
  if (req.query.from) { where.push('a.scheduled_start_at>=?'); params.push(dayBounds(req.query.from).start); }
  if (req.query.to) { where.push('a.scheduled_start_at<?'); params.push(dayBounds(req.query.to).end); }
  if (req.query.q) {
    where.push('(a.appointment_no LIKE ? OR p.patient_name LIKE ? OR p.patient_no LIKE ? OR p.phone LIKE ?)');
    const term = '%' + String(req.query.q).trim() + '%';
    params.push(term, term, term, term);
  }
  const condition = where.join(' AND ');
  const count = (await query(
    "SELECT COUNT(*) AS total FROM appointment a JOIN patient p ON p.patient_id=a.patient_id WHERE " + condition,
    params
  ))[0].total;
  const items = await query(
    "SELECT a.*, p.patient_name, p.patient_no, p.phone AS patient_phone, c.clinic_no, c.postal_address, "
    + "u.display_name AS dentist_name, d.employee_no, v.visit_id, v.visit_no, v.status AS visit_status, "
    + "s.settlement_id, s.settlement_no, s.total_amount, s.status AS settlement_status "
    + "FROM appointment a JOIN patient p ON p.patient_id=a.patient_id JOIN clinic c ON c.clinic_id=a.clinic_id "
    + "JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id "
    + "LEFT JOIN visit v ON v.appointment_id=a.appointment_id "
    + "LEFT JOIN settlement s ON s.visit_id=v.visit_id AND s.status='ACTIVE' "
    + "WHERE " + condition + " ORDER BY a.scheduled_start_at DESC LIMIT ? OFFSET ?",
    [...params, pageSize, offset]
  );
  res.json(paged(items, Number(count), page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const appointment = (await query(
    "SELECT a.*, p.patient_name, p.patient_no, p.phone AS patient_phone, p.birth_date, c.clinic_no, c.postal_address, u.display_name AS dentist_name, d.employee_no "
    + "FROM appointment a JOIN patient p ON p.patient_id=a.patient_id JOIN clinic c ON c.clinic_id=a.clinic_id "
    + "JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id WHERE a.appointment_id=?",
    [id]
  ))[0];
  if (!appointment) throw notFound('预约不存在');
  assertClinicAccess(req.user, appointment.clinic_id);
  const [changes, visit, allergies] = await Promise.all([
    query("SELECT ac.*, u.display_name AS handler_name FROM appointment_change ac JOIN user_account u ON u.user_id=ac.handled_by_user_id WHERE ac.original_appointment_id=? ORDER BY ac.changed_at", [id]),
    query("SELECT * FROM visit WHERE appointment_id=?", [id]),
    query("SELECT * FROM patient_allergy WHERE patient_id=? ORDER BY confirmation_status, allergy_name", [appointment.patient_id])
  ]);
  res.json({ appointment, changes, visit: visit[0] || null, allergies });
}));

const createSchema = z.object({
  patientId: z.coerce.number().int().positive(),
  scheduleId: z.coerce.number().int().positive(),
  startAt: z.string().min(10),
  endAt: z.string().min(10),
  expectedTreatment: z.string().trim().min(1).max(500)
});

router.post('/', allow('FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const input = createSchema.parse(req.body);
  const start = toUtcSql(input.startAt);
  const end = toUtcSql(input.endAt);
  const appointmentId = await transaction(async (conn) => {
    const schedule = await lockPublishedSchedule(conn, input.scheduleId);
    assertClinicAccess(req.user, schedule.clinic_id);
    assertWindowInsideSchedule(schedule, start, end);
    await assertScheduleQualifications(conn, schedule.schedule_id, schedule.dentist_id);
    await validatePatientAndRelation(conn, input.patientId);
    await assertNoAppointmentConflict(conn, { dentistId: schedule.dentist_id, start, end });
    const appointmentNo = makeNo('APT');
    const [result] = await conn.execute(
      "INSERT INTO appointment (appointment_no, patient_id, dentist_id, clinic_id, schedule_id, scheduled_start_at, scheduled_end_at, expected_treatment, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)",
      [appointmentNo, input.patientId, schedule.dentist_id, schedule.clinic_id, schedule.schedule_id, start, end, input.expectedTreatment, req.user.userId]
    );
    await conn.execute("INSERT INTO patient_clinic_relation (patient_id, clinic_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE patient_id=patient_id", [input.patientId, schedule.clinic_id]);
    await writeAudit(conn, req.user.userId, 'CREATE', 'appointment', result.insertId, {
      afterStatus: 'SCHEDULED', relatedEntityId: schedule.clinic_id,
      details: { appointmentNo, patientId: input.patientId, dentistId: schedule.dentist_id, start, end }, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.status(201).json({ appointmentId });
}));

router.post('/:id/cancel', allow('FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = z.object({
    reason: z.string().trim().min(1).max(255),
    initiator: z.enum(['PATIENT','CLINIC']).default('PATIENT')
  }).parse(req.body);
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM appointment WHERE appointment_id=? FOR UPDATE', [id]);
    const appointment = rows[0];
    if (!appointment) throw notFound('预约不存在');
    assertClinicAccess(req.user, appointment.clinic_id);
    if (appointment.status !== 'SCHEDULED') throw conflict('只有待就诊预约可以取消');
    await conn.execute(
      "UPDATE appointment SET status='CANCELLED', cancellation_reason=?, cancellation_initiator=?, attendance_recorded_by_user_id=?, attendance_recorded_at=? WHERE appointment_id=?",
      [input.reason, input.initiator, req.user.userId, nowUtcSql(), id]
    );
    await conn.execute(
      "INSERT INTO appointment_change (original_appointment_id, change_type, reason, initiator_party, handled_by_user_id) VALUES (?, 'CANCEL', ?, ?, ?)",
      [id, input.reason, input.initiator, req.user.userId]
    );
    await writeAudit(conn, req.user.userId, 'CANCEL', 'appointment', id, {
      beforeStatus: 'SCHEDULED', afterStatus: 'CANCELLED', reason: input.reason,
      relatedEntityId: appointment.clinic_id, details: { initiator: input.initiator }, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

const rescheduleSchema = z.object({
  scheduleId: z.coerce.number().int().positive(),
  startAt: z.string().min(10),
  endAt: z.string().min(10),
  reason: z.string().trim().min(1).max(255),
  initiator: z.enum(['PATIENT','CLINIC']).default('PATIENT'),
  expectedTreatment: z.string().trim().min(1).max(500).optional()
});

router.post('/:id/reschedule', allow('FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = rescheduleSchema.parse(req.body);
  const start = toUtcSql(input.startAt);
  const end = toUtcSql(input.endAt);
  const newAppointmentId = await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM appointment WHERE appointment_id=? FOR UPDATE', [id]);
    const original = rows[0];
    if (!original) throw notFound('预约不存在');
    assertClinicAccess(req.user, original.clinic_id);
    if (original.status !== 'SCHEDULED') throw conflict('只有待就诊预约可以改期');
    if (Number(original.schedule_id) === input.scheduleId && start === original.scheduled_start_at && end === original.scheduled_end_at) {
      throw badRequest('新预约时段与原预约相同');
    }
    const schedule = await lockPublishedSchedule(conn, input.scheduleId);
    assertClinicAccess(req.user, schedule.clinic_id);
    assertWindowInsideSchedule(schedule, start, end);
    await assertScheduleQualifications(conn, schedule.schedule_id, schedule.dentist_id);
    await assertNoAppointmentConflict(conn, { dentistId: schedule.dentist_id, start, end, excludeAppointmentId: id });
    const newNo = makeNo('APT');
    const [inserted] = await conn.execute(
      "INSERT INTO appointment (appointment_no, patient_id, dentist_id, clinic_id, schedule_id, scheduled_start_at, scheduled_end_at, expected_treatment, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)",
      [newNo, original.patient_id, schedule.dentist_id, schedule.clinic_id, schedule.schedule_id, start, end, input.expectedTreatment || original.expected_treatment, req.user.userId]
    );
    await conn.execute("UPDATE appointment SET status='RESCHEDULED' WHERE appointment_id=?", [id]);
    await conn.execute(
      "INSERT INTO appointment_change (original_appointment_id, new_appointment_id, change_type, reason, initiator_party, handled_by_user_id) VALUES (?, ?, 'RESCHEDULE', ?, ?, ?)",
      [id, inserted.insertId, input.reason, input.initiator, req.user.userId]
    );
    await conn.execute("INSERT INTO patient_clinic_relation (patient_id, clinic_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE patient_id=patient_id", [original.patient_id, schedule.clinic_id]);
    await writeAudit(conn, req.user.userId, 'RESCHEDULE', 'appointment', id, {
      beforeStatus: 'SCHEDULED', afterStatus: 'RESCHEDULED', relatedEntityId: inserted.insertId,
      reason: input.reason, details: { newAppointmentNo: newNo, start, end, scheduleId: schedule.schedule_id }, ipAddress: req.ip
    });
    return inserted.insertId;
  });
  res.json({ newAppointmentId });
}));

router.post('/:id/attend', allow('FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = z.object({
    patientProblem: z.string().trim().max(1000).optional(),
    specialNeeds: z.string().trim().max(1000).nullable().optional()
  }).parse(req.body);
  const visitId = await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM appointment WHERE appointment_id=? FOR UPDATE', [id]);
    const appointment = rows[0];
    if (!appointment) throw notFound('预约不存在');
    assertClinicAccess(req.user, appointment.clinic_id);
    if (appointment.status !== 'SCHEDULED') throw conflict('只有待就诊预约可以登记到诊');
    const [existingVisits] = await conn.execute('SELECT visit_id FROM visit WHERE appointment_id=?', [id]);
    if (existingVisits.length) throw conflict('该预约已生成就诊记录', { visitId: existingVisits[0].visit_id });
    const at = nowUtcSql();
    await conn.execute(
      "UPDATE appointment SET status='ATTENDED', attendance_recorded_by_user_id=?, attendance_recorded_at=? WHERE appointment_id=?",
      [req.user.userId, at, id]
    );
    const visitNo = makeNo('VIS');
    const [result] = await conn.execute(
      "INSERT INTO visit (visit_no, appointment_id, visit_datetime, patient_problem, special_needs, status) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS')",
      [visitNo, id, at, input.patientProblem || appointment.expected_treatment, input.specialNeeds || null]
    );
    await writeAudit(conn, req.user.userId, 'ATTEND', 'appointment', id, {
      beforeStatus: 'SCHEDULED', afterStatus: 'ATTENDED', relatedEntityId: result.insertId,
      details: { visitNo, patientId: appointment.patient_id }, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.json({ visitId });
}));

router.post('/:id/no-show', allow('FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const reason = z.object({ reason: z.string().trim().max(255).optional() }).parse(req.body).reason;
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM appointment WHERE appointment_id=? FOR UPDATE', [id]);
    const appointment = rows[0];
    if (!appointment) throw notFound('预约不存在');
    assertClinicAccess(req.user, appointment.clinic_id);
    if (appointment.status !== 'SCHEDULED') throw conflict('只有待就诊预约可以标记未到诊');
    await conn.execute(
      "UPDATE appointment SET status='NO_SHOW', cancellation_reason=?, attendance_recorded_by_user_id=?, attendance_recorded_at=? WHERE appointment_id=?",
      [reason || null, req.user.userId, nowUtcSql(), id]
    );
    await writeAudit(conn, req.user.userId, 'NO_SHOW', 'appointment', id, {
      beforeStatus: 'SCHEDULED', afterStatus: 'NO_SHOW', reason: reason || null, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

export default router;
