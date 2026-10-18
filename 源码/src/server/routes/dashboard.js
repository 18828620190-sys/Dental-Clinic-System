import { Router } from 'express';
import { query } from '../db.js';
import { scopedClinicSql } from '../auth.js';
import { asyncHandler } from '../errors.js';
import { currentQuarter, dayBounds, shanghaiToday } from '../utils.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const requested = req.query.clinicId ? Number(req.query.clinicId) : null;
  const scope = scopedClinicSql(req.user, 'a.clinic_id', requested);
  const dentistScope = req.user.role === 'DENTIST'
    ? { sql: 'a.dentist_id = ?', params: [req.user.dentistId] }
    : { sql: '1=1', params: [] };
  const where = `${scope.sql} AND ${dentistScope.sql}`;
  const params = [...scope.params, ...dentistScope.params];
  const today = dayBounds(shanghaiToday());
  const month = dayBounds(`${shanghaiToday().slice(0, 7)}-01`);
  const trendStart = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  const todayRows = (await query(
    `SELECT SUM(a.status = 'SCHEDULED') AS scheduled_today,
            SUM(a.status IN ('CANCELLED','NO_SHOW')) AS lost_today,
            COUNT(*) AS appointments_today
       FROM appointment a
      WHERE a.scheduled_start_at >= ? AND a.scheduled_start_at < ? AND ${where}`,
    [today.start, today.end, ...params]
  ))[0];

  const revenueRows = (await query(
    `SELECT COALESCE(SUM(s.total_amount), 0) AS revenue_today, COUNT(*) AS settled_today
       FROM settlement s
       JOIN visit v ON v.visit_id = s.visit_id
       JOIN appointment a ON a.appointment_id = v.appointment_id
      WHERE s.status = 'ACTIVE' AND s.settlement_date >= ? AND s.settlement_date < ? AND ${where}`,
    [today.start, today.end, ...params]
  ))[0];

  const monthRows = (await query(
    `SELECT COUNT(*) AS total, SUM(a.status IN ('CANCELLED','NO_SHOW')) AS lost
       FROM appointment a
      WHERE a.scheduled_start_at >= ? AND a.scheduled_start_at < ? AND ${where}`,
    [month.start, month.end, ...params]
  ))[0];

  const unsettledRows = (await query(
    `SELECT COUNT(*) AS count
       FROM visit v
       JOIN appointment a ON a.appointment_id = v.appointment_id
       LEFT JOIN settlement s ON s.visit_id = v.visit_id AND s.status = 'ACTIVE'
      WHERE v.status IN ('IN_PROGRESS','COMPLETED') AND s.settlement_id IS NULL AND ${where}`,
    params
  ))[0];

  const patientRows = (await query(
    `SELECT COUNT(DISTINCT a.patient_id) AS patients FROM appointment a WHERE ${where}`,
    params
  ))[0];

  const upcoming = await query(
    `SELECT a.appointment_id, a.appointment_no, a.patient_id, a.scheduled_start_at, a.scheduled_end_at, a.status,
            p.patient_name, p.patient_no, c.clinic_no, c.postal_address, u.display_name AS dentist_name
       FROM appointment a
       JOIN patient p ON p.patient_id = a.patient_id
       JOIN clinic c ON c.clinic_id = a.clinic_id
       JOIN dentist_profile d ON d.dentist_id = a.dentist_id
       JOIN user_account u ON u.user_id = d.user_id
      WHERE a.scheduled_start_at >= ? AND ${where}
      ORDER BY a.scheduled_start_at LIMIT 8`,
    [new Date().toISOString().slice(0, 19).replace('T', ' '), ...params]
  );

  const trend = await query(
    `SELECT DATE_FORMAT(CONVERT_TZ(s.settlement_date, '+00:00', '+08:00'), '%Y-%m') AS month,
            SUM(s.total_amount) AS revenue
       FROM settlement s
       JOIN visit v ON v.visit_id = s.visit_id
       JOIN appointment a ON a.appointment_id = v.appointment_id
      WHERE s.status = 'ACTIVE' AND s.settlement_date >= ? AND ${where}
      GROUP BY month ORDER BY month`,
    [trendStart, ...params]
  );

  const dentistFilter = req.user.role === 'DENTIST' ? 'd.dentist_id = ?' : '1=1';
  const quarterDentists = await query(
    `SELECT u.display_name AS dentist_name, d.employee_no,
            COALESCE(SUM(CASE WHEN s.status = 'ACTIVE' THEN s.total_amount ELSE 0 END), 0) AS revenue
       FROM dentist_profile d
       JOIN user_account u ON u.user_id = d.user_id
       LEFT JOIN appointment a ON a.dentist_id = d.dentist_id AND ${scope.sql}
       LEFT JOIN visit v ON v.appointment_id = a.appointment_id
       LEFT JOIN settlement s ON s.visit_id = v.visit_id
      WHERE u.status = 'ACTIVE' AND ${dentistFilter}
      GROUP BY d.dentist_id, u.display_name, d.employee_no
      ORDER BY revenue DESC LIMIT 5`,
    [...scope.params, ...(req.user.role === 'DENTIST' ? [req.user.dentistId] : [])]
  );

  const totalAppointments = Number(monthRows?.total || 0);
  res.json({
    metrics: {
      scheduledToday: Number(todayRows?.scheduled_today || 0),
      appointmentsToday: Number(todayRows?.appointments_today || 0),
      revenueToday: Number(revenueRows?.revenue_today || 0),
      settledToday: Number(revenueRows?.settled_today || 0),
      activePatients: Number(patientRows?.patients || 0),
      unsettledVisits: Number(unsettledRows?.count || 0),
      cancellationRate: totalAppointments ? Number(monthRows.lost || 0) / totalAppointments : 0
    },
    upcoming,
    revenueTrend: trend.map((r) => ({ month: r.month, revenue: Number(r.revenue) })),
    topDentists: quarterDentists.map((r) => ({ ...r, revenue: Number(r.revenue) })),
    quarter: currentQuarter()
  });
}));

export default router;
