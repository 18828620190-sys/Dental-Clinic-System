import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, hashPassword, isHQ, loadUser } from '../auth.js';
import { asyncHandler, conflict, forbidden, notFound } from '../errors.js';
import { asId, nowUtcSql } from '../utils.js';

const router = Router();
const dentistSchema = z.object({
  username: z.string().trim().min(3).max(64),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(100).optional(),
  employeeNo: z.string().trim().min(1).max(32),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  homeAddress: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(5).max(32),
  email: z.string().trim().email().max(254),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  qualifications: z.array(z.object({
    qualificationId: z.coerce.number().int().positive(),
    obtainedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    verificationStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('VERIFIED')
  })).default([])
});

router.get('/', asyncHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.q) {
    where.push('(u.display_name LIKE ? OR d.employee_no LIKE ? OR d.phone LIKE ?)');
    const term = `%${String(req.query.q).trim()}%`;
    params.push(term, term, term);
  }
  if (req.query.qualificationId) {
    where.push('EXISTS (SELECT 1 FROM dentist_qualification dq WHERE dq.dentist_id=d.dentist_id AND dq.qualification_id=? AND dq.verification_status=\'VERIFIED\')');
    params.push(Number(req.query.qualificationId));
  }
  const rows = await query(
    `SELECT d.dentist_id, d.employee_no, d.birth_date, d.home_address, d.phone, d.email,
            u.user_id, u.username, u.display_name, u.status,
            GROUP_CONCAT(DISTINCT q.qualification_name ORDER BY q.qualification_name SEPARATOR '、') AS qualification_names,
            COUNT(DISTINCT dq.qualification_id) AS qualification_count
       FROM dentist_profile d
       JOIN user_account u ON u.user_id=d.user_id
       LEFT JOIN dentist_qualification dq ON dq.dentist_id=d.dentist_id
       LEFT JOIN qualification q ON q.qualification_id=dq.qualification_id
      WHERE ${where.join(' AND ')}
      GROUP BY d.dentist_id, d.employee_no, d.birth_date, d.home_address, d.phone, d.email,
               u.user_id, u.username, u.display_name, u.status
      ORDER BY u.status, u.display_name`,
    params
  );
  res.json({ items: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  if (req.user.role === 'DENTIST' && req.user.dentistId !== id) throw forbidden('只能查看自己的档案');
  const dentist = (await query(
    `SELECT d.*, u.username, u.display_name, u.status FROM dentist_profile d JOIN user_account u ON u.user_id=d.user_id WHERE d.dentist_id=?`,
    [id]
  ))[0];
  if (!dentist) throw notFound('牙医不存在');
  const [qualifications, schedules, stats] = await Promise.all([
    query(`SELECT dq.*, q.qualification_name FROM dentist_qualification dq JOIN qualification q ON q.qualification_id=dq.qualification_id WHERE dq.dentist_id=? ORDER BY q.qualification_name`, [id]),
    query(`SELECT ds.*, c.clinic_no, c.postal_address FROM dentist_schedule ds JOIN clinic c ON c.clinic_id=ds.clinic_id WHERE ds.dentist_id=? ORDER BY ds.available_start_at DESC LIMIT 30`, [id]),
    query(`SELECT COUNT(DISTINCT a.patient_id) AS patient_count, COUNT(DISTINCT v.visit_id) AS visit_count FROM appointment a LEFT JOIN visit v ON v.appointment_id=a.appointment_id WHERE a.dentist_id=?`, [id])
  ]);
  res.json({ dentist, qualifications, schedules, stats: stats[0] });
}));

router.post('/', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const input = dentistSchema.parse(req.body);
  const dentistId = await transaction(async (conn) => {
    const password = await hashPassword(input.password || config.defaultDentistPassword);
    const [userResult] = await conn.execute(
      `INSERT INTO user_account (username, password_hash, display_name, role_code, status) VALUES (?, ?, ?, 'DENTIST', ?)`,
      [input.username, password, input.displayName, input.status]
    );
    const userId = userResult.insertId;
    const [result] = await conn.execute(
      `INSERT INTO dentist_profile (user_id, employee_no, birth_date, home_address, phone, email)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, input.employeeNo, input.birthDate, input.homeAddress, input.phone, input.email]
    );
    for (const q of input.qualifications) {
      const verified = q.verificationStatus === 'VERIFIED';
      await conn.execute(
        `INSERT INTO dentist_qualification (dentist_id, qualification_id, obtained_date, verification_status, verified_by_user_id, verified_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, q.qualificationId, q.obtainedDate || null, q.verificationStatus,
         verified ? req.user.userId : null, verified ? nowUtcSql() : null]
      );
    }
    await writeAudit(conn, req.user.userId, 'CREATE', 'dentist_profile', result.insertId, {
      afterStatus: input.status, details: { employeeNo: input.employeeNo }, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.status(201).json({ dentistId });
}));

router.put('/:id', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = dentistSchema.partial().parse(req.body);
  const existing = (await query(
    `SELECT d.*, u.user_id, u.username, u.display_name, u.status FROM dentist_profile d JOIN user_account u ON u.user_id=d.user_id WHERE d.dentist_id=?`,
    [id]
  ))[0];
  if (!existing) throw notFound('牙医不存在');
  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE user_account SET display_name=?, status=? WHERE user_id=?`,
      [input.displayName ?? existing.display_name, input.status ?? existing.status, existing.user_id]
    );
    await conn.execute(
      `UPDATE dentist_profile SET employee_no=?, birth_date=?, home_address=?, phone=?, email=? WHERE dentist_id=?`,
      [input.employeeNo ?? existing.employee_no, input.birthDate ?? existing.birth_date,
       input.homeAddress ?? existing.home_address, input.phone ?? existing.phone,
       input.email ?? existing.email, id]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'dentist_profile', id, {
      beforeStatus: existing.status, afterStatus: input.status ?? existing.status, details: { fields: Object.keys(input) }, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

const qualAssignSchema = z.object({
  qualificationId: z.coerce.number().int().positive(),
  obtainedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  verificationStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING')
});

router.post('/:id/qualifications', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const dentistId = asId(req.params.id);
  const input = qualAssignSchema.parse(req.body);
  await transaction(async (conn) => {
    const verified = input.verificationStatus === 'VERIFIED';
    await conn.execute(
      `INSERT INTO dentist_qualification (dentist_id, qualification_id, obtained_date, verification_status, verified_by_user_id, verified_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE obtained_date=VALUES(obtained_date), verification_status=VALUES(verification_status),
         verified_by_user_id=VALUES(verified_by_user_id), verified_at=VALUES(verified_at)`,
      [dentistId, input.qualificationId, input.obtainedDate || null, input.verificationStatus,
       verified ? req.user.userId : null, verified ? nowUtcSql() : null]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'dentist_qualification', `${dentistId}:${input.qualificationId}`, {
      relatedEntityId: dentistId, afterStatus: input.verificationStatus, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

router.delete('/:id/qualifications/:qualificationId', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const dentistId = asId(req.params.id);
  const qualificationId = asId(req.params.qualificationId);
  await transaction(async (conn) => {
    const [result] = await conn.execute('DELETE FROM dentist_qualification WHERE dentist_id=? AND qualification_id=?', [dentistId, qualificationId]);
    if (!result.affectedRows) throw notFound('牙医资质关系不存在');
    await writeAudit(conn, req.user.userId, 'UPDATE', 'dentist_qualification', `${dentistId}:${qualificationId}`, {
      relatedEntityId: dentistId, reason: '移除牙医资质', ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

export default router;
