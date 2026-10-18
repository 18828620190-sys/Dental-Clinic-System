import { Router } from 'express';
import { query } from '../db.js';
import { assertClinicAccess } from '../auth.js';
import { asyncHandler, badRequest } from '../errors.js';
import { dayBounds } from '../utils.js';

const router = Router();

function parseUtc(value) {
  return new Date(String(value).replace(' ', 'T') + 'Z');
}

router.get('/', asyncHandler(async (req, res) => {
  const clinicId = Number(req.query.clinicId);
  if (!clinicId) throw badRequest('请选择诊所');
  assertClinicAccess(req.user, clinicId);
  const date = req.query.date;
  const range = dayBounds(date);
  const duration = Math.min(180, Math.max(15, Number(req.query.durationMinutes) || 30));
  const qualificationId = req.query.qualificationId ? Number(req.query.qualificationId) : null;
  const params = [clinicId, range.end, range.start];
  let qualificationFilter = '';
  if (qualificationId) {
    qualificationFilter = 'AND EXISTS (SELECT 1 FROM schedule_qualification sqf WHERE sqf.schedule_id=ds.schedule_id AND sqf.qualification_id=?)';
    params.push(qualificationId);
  }
  if (req.query.dentistId) {
    qualificationFilter += ' AND ds.dentist_id=?';
    params.push(Number(req.query.dentistId));
  }
  const schedules = await query(
    "SELECT ds.schedule_id, ds.dentist_id, ds.available_start_at, ds.available_end_at, "
    + "u.display_name AS dentist_name, d.employee_no, "
    + "GROUP_CONCAT(DISTINCT q.qualification_name ORDER BY q.qualification_name SEPARATOR '、') AS qualification_names "
    + "FROM dentist_schedule ds JOIN dentist_profile d ON d.dentist_id=ds.dentist_id "
    + "JOIN user_account u ON u.user_id=d.user_id AND u.status='ACTIVE' "
    + "LEFT JOIN schedule_qualification sq ON sq.schedule_id=ds.schedule_id "
    + "LEFT JOIN qualification q ON q.qualification_id=sq.qualification_id "
    + "WHERE ds.clinic_id=? AND ds.status='PUBLISHED' AND ds.available_start_at < ? AND ds.available_end_at > ? "
    + "AND NOT EXISTS (SELECT 1 FROM schedule_qualification sq2 "
    + "LEFT JOIN dentist_qualification dq ON dq.dentist_id=ds.dentist_id AND dq.qualification_id=sq2.qualification_id "
    + "WHERE sq2.schedule_id=ds.schedule_id AND (dq.verification_status IS NULL OR dq.verification_status<>'VERIFIED')) "
    + qualificationFilter
    + " GROUP BY ds.schedule_id, ds.dentist_id, ds.available_start_at, ds.available_end_at, u.display_name, d.employee_no "
    + "ORDER BY ds.available_start_at",
    params
  );
  const scheduleIds = schedules.map((s) => s.schedule_id);
  let appointments = [];
  if (scheduleIds.length) {
    appointments = await query(
      "SELECT schedule_id, scheduled_start_at, scheduled_end_at FROM appointment WHERE status='SCHEDULED' AND schedule_id IN (" + scheduleIds.map(() => '?').join(',') + ")",
      scheduleIds
    );
  }

  const now = Date.now() + 5 * 60 * 1000;
  const slots = [];
  for (const schedule of schedules) {
    const bookings = appointments.filter((a) => Number(a.schedule_id) === Number(schedule.schedule_id));
    let cursor = parseUtc(schedule.available_start_at).getTime();
    const end = parseUtc(schedule.available_end_at).getTime();
    while (cursor + duration * 60000 <= end) {
      const slotEnd = cursor + duration * 60000;
      const blocked = bookings.some((a) => {
        const bs = parseUtc(a.scheduled_start_at).getTime();
        const be = parseUtc(a.scheduled_end_at).getTime();
        return cursor < be && slotEnd > bs;
      });
      if (cursor >= now && !blocked) {
        slots.push({
          scheduleId: schedule.schedule_id,
          dentistId: schedule.dentist_id,
          dentistName: schedule.dentist_name,
          employeeNo: schedule.employee_no,
          qualificationNames: schedule.qualification_names,
          startAt: new Date(cursor).toISOString(),
          endAt: new Date(slotEnd).toISOString()
        });
      }
      cursor += 30 * 60000;
    }
  }
  res.json({ date, clinicId, durationMinutes: duration, slots });
}));

export default router;
