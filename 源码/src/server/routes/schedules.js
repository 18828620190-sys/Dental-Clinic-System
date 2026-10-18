import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, assertClinicAccess, scopedClinicSql } from '../auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../errors.js';
import { asId, dayBounds, shanghaiToday, toUtcSql } from '../utils.js';
import { assertNoScheduleConflict, assertQualificationsVerified, getScheduleImpact, setScheduleQualifications } from '../services/scheduleService.js';

const router = Router();
const scheduleSchema = z.object({
  dentistId: z.coerce.number().int().positive(),
  clinicId: z.coerce.number().int().positive(),
  availableStartAt: z.string().min(10),
  availableEndAt: z.string().min(10),
  transferMinutes: z.coerce.number().int().min(0).max(240).nullable().optional(),
  status: z.enum(['DRAFT','PUBLISHED']).default('DRAFT'),
  qualificationIds: z.array(z.coerce.number().int().positive()).default([])
});

router.get('/', asyncHandler(async (req, res) => {
  const at = req.query.from || shanghaiToday();
  const to = req.query.to || new Date(new Date(at + 'T00:00:00+08:00').getTime() + 45 * 86400000).toISOString().slice(0, 10);
  const scope = scopedClinicSql(req.user, 'ds.clinic_id', req.query.clinicId || null);
  const where = [scope.sql, 'ds.available_start_at < ?', 'ds.available_end_at > ?'];
  const params = [...scope.params, dayBounds(to).end, dayBounds(at).start];
  if (req.query.dentistId) { where.push('ds.dentist_id=?'); params.push(Number(req.query.dentistId)); }
  if (req.query.status) { where.push('ds.status=?'); params.push(req.query.status); }
  if (req.user.role === 'DENTIST') { where.push('ds.dentist_id=?'); params.push(req.user.dentistId); }
  const rows = await query(
    "SELECT ds.*, c.clinic_no, c.postal_address, u.display_name AS dentist_name, d.employee_no, "
    + "(SELECT COUNT(*) FROM appointment a WHERE a.schedule_id=ds.schedule_id AND a.status='SCHEDULED') AS booked_count, "
    + "GROUP_CONCAT(DISTINCT q.qualification_name ORDER BY q.qualification_name SEPARATOR '、') AS qualification_names "
    + "FROM dentist_schedule ds JOIN clinic c ON c.clinic_id=ds.clinic_id "
    + "JOIN dentist_profile d ON d.dentist_id=ds.dentist_id JOIN user_account u ON u.user_id=d.user_id "
    + "LEFT JOIN schedule_qualification sq ON sq.schedule_id=ds.schedule_id "
    + "LEFT JOIN qualification q ON q.qualification_id=sq.qualification_id "
    + "WHERE " + where.join(' AND ')
    + " GROUP BY ds.schedule_id, c.clinic_no, c.postal_address, u.display_name, d.employee_no "
    + "ORDER BY ds.available_start_at",
    params
  );
  res.json({ items: rows });
}));



router.post('/', allow('HQ_MANAGER','CLINIC_MANAGER'), asyncHandler(async (req, res) => {
  const input = scheduleSchema.parse(req.body);
  assertClinicAccess(req.user, input.clinicId);
  const start = toUtcSql(input.availableStartAt);
  const end = toUtcSql(input.availableEndAt);
  if (end <= start) throw badRequest('排班结束时间必须晚于开始时间');
  const scheduleId = await transaction(async (conn) => {
    await assertQualificationsVerified(conn, input.dentistId, input.qualificationIds);
    if (input.status === 'PUBLISHED') await assertNoScheduleConflict(conn, { dentistId: input.dentistId, start, end });
    const [result] = await conn.execute(
      "INSERT INTO dentist_schedule (dentist_id, clinic_id, available_start_at, available_end_at, transfer_minutes, status, coordinator_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [input.dentistId, input.clinicId, start, end, input.transferMinutes ?? null, input.status, req.user.userId]
    );
    await setScheduleQualifications(conn, result.insertId, input.qualificationIds);
    await writeAudit(conn, req.user.userId, 'CREATE_SCHEDULE', 'dentist_schedule', result.insertId, {
      afterStatus: input.status, relatedEntityId: input.clinicId, details: { start, end, dentistId: input.dentistId }, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.status(201).json({ scheduleId });
}));

router.put('/:id', allow('HQ_MANAGER','CLINIC_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = scheduleSchema.parse(req.body);
  assertClinicAccess(req.user, input.clinicId);
  const start = toUtcSql(input.availableStartAt);
  const end = toUtcSql(input.availableEndAt);
  if (end <= start) throw badRequest('排班结束时间必须晚于开始时间');
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM dentist_schedule WHERE schedule_id=? FOR UPDATE', [id]);
    const existing = rows[0];
    if (!existing) throw notFound('排班不存在');
    assertClinicAccess(req.user, existing.clinic_id);
    const impact = await getScheduleImpact(conn, id);
    const identityChanged = Number(existing.dentist_id) !== input.dentistId || Number(existing.clinic_id) !== input.clinicId;
    if (impact.length && (identityChanged || start > existing.available_start_at || end < existing.available_end_at)) {
      throw conflict('排班已有有效预约，不能缩短、换店或换牙医；请先处理受影响预约', { affectedAppointments: impact });
    }
    await assertQualificationsVerified(conn, input.dentistId, input.qualificationIds);
    if (input.status === 'PUBLISHED') await assertNoScheduleConflict(conn, { dentistId: input.dentistId, start, end, scheduleId: id });
    await conn.execute(
      "UPDATE dentist_schedule SET dentist_id=?, clinic_id=?, available_start_at=?, available_end_at=?, transfer_minutes=?, status=?, coordinator_user_id=? WHERE schedule_id=?",
      [input.dentistId, input.clinicId, start, end, input.transferMinutes ?? null, input.status, req.user.userId, id]
    );
    await setScheduleQualifications(conn, id, input.qualificationIds);
    await writeAudit(conn, req.user.userId, 'UPDATE_SCHEDULE', 'dentist_schedule', id, {
      beforeStatus: existing.status, afterStatus: input.status, relatedEntityId: input.clinicId,
      details: { affectedAppointmentCount: impact.length }, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

router.post('/:id/publish', allow('HQ_MANAGER','CLINIC_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM dentist_schedule WHERE schedule_id=? FOR UPDATE', [id]);
    const existing = rows[0];
    if (!existing) throw notFound('排班不存在');
    assertClinicAccess(req.user, existing.clinic_id);
    if (existing.status !== 'DRAFT') throw conflict('只有草稿排班可以发布');
    const [quals] = await conn.execute('SELECT qualification_id FROM schedule_qualification WHERE schedule_id=?', [id]);
    await assertQualificationsVerified(conn, existing.dentist_id, quals.map((q) => q.qualification_id));
    await assertNoScheduleConflict(conn, { dentistId: existing.dentist_id, start: existing.available_start_at, end: existing.available_end_at, scheduleId: id });
    await conn.execute("UPDATE dentist_schedule SET status='PUBLISHED' WHERE schedule_id=?", [id]);
    await writeAudit(conn, req.user.userId, 'UPDATE_SCHEDULE', 'dentist_schedule', id, { beforeStatus: 'DRAFT', afterStatus: 'PUBLISHED', reason: '发布排班', relatedEntityId: existing.clinic_id, ipAddress: req.ip });
  });
  res.json({ ok: true });
}));

router.post('/:id/cancel', allow('HQ_MANAGER','CLINIC_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM dentist_schedule WHERE schedule_id=? FOR UPDATE', [id]);
    const existing = rows[0];
    if (!existing) throw notFound('排班不存在');
    assertClinicAccess(req.user, existing.clinic_id);
    const impact = await getScheduleImpact(conn, id);
    if (impact.length) throw conflict('排班已有有效预约，不能直接取消', { affectedAppointments: impact });
    await conn.execute("UPDATE dentist_schedule SET status='CANCELLED' WHERE schedule_id=?", [id]);
    await writeAudit(conn, req.user.userId, 'UPDATE_SCHEDULE', 'dentist_schedule', id, {
      beforeStatus: existing.status, afterStatus: 'CANCELLED', reason: req.body?.reason || '取消排班', ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

export default router;
