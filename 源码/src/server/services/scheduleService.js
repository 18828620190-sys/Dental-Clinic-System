import { conflict } from '../errors.js';

export async function assertQualificationsVerified(connection, dentistId, qualificationIds) {
  const ids = [...new Set((qualificationIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT q.qualification_id, q.qualification_name, dq.verification_status
       FROM qualification q
       LEFT JOIN dentist_qualification dq ON dq.qualification_id=q.qualification_id AND dq.dentist_id=?
      WHERE q.qualification_id IN (${placeholders})`,
    [dentistId, ...ids]
  );
  const missing = rows.filter((r) => r.verification_status !== 'VERIFIED');
  if (missing.length) {
    throw conflict('牙医未具备排班要求的全部有效资质', { missingQualifications: missing.map((r) => r.qualification_name) });
  }
  return ids;
}

export async function assertNoScheduleConflict(connection, { dentistId, start, end, scheduleId = null }) {
  await connection.execute('SELECT dentist_id FROM dentist_profile WHERE dentist_id=? FOR UPDATE', [dentistId]);
  const params = [dentistId, end, start];
  let exclude = '';
  if (scheduleId) { exclude = 'AND ds.schedule_id <> ?'; params.push(scheduleId); }
  const [rows] = await connection.execute(
    `SELECT ds.schedule_id, ds.clinic_id, ds.available_start_at, ds.available_end_at, c.clinic_no
       FROM dentist_schedule ds JOIN clinic c ON c.clinic_id=ds.clinic_id
      WHERE ds.dentist_id=? AND ds.status='PUBLISHED'
        AND ds.available_start_at < ? AND ds.available_end_at > ? ${exclude}`,
    params
  );
  if (rows.length) throw conflict('牙医在该时段已有已发布排班', { conflicts: rows });

  const appointmentParams = [dentistId, end, start];
  if (scheduleId) appointmentParams.push(scheduleId);
  const appointmentExclude = scheduleId ? 'AND a.schedule_id <> ?' : '';
  const [appointments] = await connection.execute(
    `SELECT a.appointment_id, a.appointment_no, a.scheduled_start_at, a.scheduled_end_at
       FROM appointment a
      WHERE a.dentist_id=? AND a.status='SCHEDULED'
        AND a.scheduled_start_at < ? AND a.scheduled_end_at > ? ${appointmentExclude}`,
    appointmentParams
  );
  if (appointments.length) throw conflict('牙医在该时段已有有效预约', { conflicts: appointments });
}

export async function getScheduleImpact(connection, scheduleId) {
  const [rows] = await connection.execute(
    `SELECT a.appointment_id, a.appointment_no, a.scheduled_start_at, a.scheduled_end_at,
            p.patient_name, a.status
       FROM appointment a JOIN patient p ON p.patient_id=a.patient_id
      WHERE a.schedule_id=? AND a.status='SCHEDULED' ORDER BY a.scheduled_start_at`,
    [scheduleId]
  );
  return rows;
}

export async function setScheduleQualifications(connection, scheduleId, qualificationIds) {
  await connection.execute('DELETE FROM schedule_qualification WHERE schedule_id=?', [scheduleId]);
  for (const id of [...new Set((qualificationIds || []).map(Number).filter(Boolean))]) {
    await connection.execute('INSERT INTO schedule_qualification (schedule_id, qualification_id) VALUES (?, ?)', [scheduleId, id]);
  }
}
