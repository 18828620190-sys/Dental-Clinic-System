import { conflict, notFound } from '../errors.js';

export async function lockPublishedSchedule(connection, scheduleId, dentistId = null, clinicId = null) {
  const [rows] = await connection.execute(
    "SELECT ds.*, c.status AS clinic_status, u.status AS dentist_status FROM dentist_schedule ds "
    + "JOIN clinic c ON c.clinic_id=ds.clinic_id JOIN dentist_profile d ON d.dentist_id=ds.dentist_id "
    + "JOIN user_account u ON u.user_id=d.user_id WHERE ds.schedule_id=? FOR UPDATE",
    [scheduleId]
  );
  const schedule = rows[0];
  if (!schedule) throw notFound('排班不存在');
  if (schedule.status !== 'PUBLISHED') throw conflict('排班尚未发布，不能预约');
  if (schedule.clinic_status !== 'ACTIVE') throw conflict('诊所已停用，不能预约');
  if (schedule.dentist_status !== 'ACTIVE') throw conflict('牙医账号已停用，不能预约');
  if (dentistId && Number(schedule.dentist_id) !== Number(dentistId)) throw conflict('排班与牙医不匹配');
  if (clinicId && Number(schedule.clinic_id) !== Number(clinicId)) throw conflict('排班与诊所不匹配');
  return schedule;
}

export async function assertScheduleQualifications(connection, scheduleId, dentistId) {
  const [rows] = await connection.execute(
    "SELECT q.qualification_name, dq.verification_status FROM schedule_qualification sq "
    + "JOIN qualification q ON q.qualification_id=sq.qualification_id "
    + "LEFT JOIN dentist_qualification dq ON dq.dentist_id=? AND dq.qualification_id=sq.qualification_id "
    + "WHERE sq.schedule_id=?",
    [dentistId, scheduleId]
  );
  const missing = rows.filter((r) => r.verification_status !== 'VERIFIED');
  if (missing.length) throw conflict('牙医缺少该排班的有效资质', { missingQualifications: missing });
}

export async function assertNoAppointmentConflict(connection, { dentistId, start, end, excludeAppointmentId = null }) {
  await connection.execute('SELECT dentist_id FROM dentist_profile WHERE dentist_id=? FOR UPDATE', [dentistId]);
  const params = [dentistId, end, start];
  let exclude = '';
  if (excludeAppointmentId) { exclude = 'AND appointment_id<>?'; params.push(excludeAppointmentId); }
  const [rows] = await connection.execute(
    "SELECT appointment_id, appointment_no, scheduled_start_at, scheduled_end_at FROM appointment "
    + "WHERE dentist_id=? AND status='SCHEDULED' AND scheduled_start_at < ? AND scheduled_end_at > ? " + exclude
    + " LIMIT 1",
    params
  );
  if (rows.length) throw conflict('该牙医在所选时段已有预约', { conflictingAppointment: rows[0] });
}

export function assertWindowInsideSchedule(schedule, start, end) {
  if (end <= start) throw conflict('预约结束时间必须晚于开始时间');
  if (start < schedule.available_start_at || end > schedule.available_end_at) {
    throw conflict('预约时间超出已发布排班范围', {
      availableStartAt: schedule.available_start_at,
      availableEndAt: schedule.available_end_at
    });
  }
}

export async function validatePatientAndRelation(connection, patientId) {
  const [rows] = await connection.execute("SELECT * FROM patient WHERE patient_id=? AND status='ACTIVE'", [patientId]);
  if (!rows[0]) throw conflict('患者不存在或已停用');
  return rows[0];
}
