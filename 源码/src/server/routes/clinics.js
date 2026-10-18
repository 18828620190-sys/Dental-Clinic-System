import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, assertClinicAccess, scopedClinicSql } from '../auth.js';
import { asyncHandler, notFound } from '../errors.js';
import { asId } from '../utils.js';

const router = Router();
const clinicSchema = z.object({
  clinicNo: z.string().trim().min(1).max(32).optional(),
  postalAddress: z.string().trim().min(1).max(255),
  managerName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(5).max(32),
  email: z.string().trim().email().max(254).nullable().optional().or(z.literal('')),
  officeAreaSqm: z.coerce.number().positive(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE')
});

router.get('/', asyncHandler(async (req, res) => {
  const scope = scopedClinicSql(req.user, 'c.clinic_id', req.query.clinicId || null);
  const rows = await query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM appointment a WHERE a.clinic_id=c.clinic_id) AS appointment_count,
            (SELECT COUNT(*) FROM dentist_schedule ds WHERE ds.clinic_id=c.clinic_id AND ds.status='PUBLISHED') AS published_schedule_count
       FROM clinic c WHERE ${scope.sql} ORDER BY c.status, c.clinic_no`,
    scope.params
  );
  res.json({ items: rows });
}));

router.post('/', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const input = clinicSchema.parse(req.body);
  const clinicId = await transaction(async (conn) => {
    const no = input.clinicNo || `CL-${Date.now().toString().slice(-8)}`;
    const [result] = await conn.execute(
      `INSERT INTO clinic (clinic_no, postal_address, manager_name, phone, email, office_area_sqm, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [no, input.postalAddress, input.managerName, input.phone, input.email || null, input.officeAreaSqm, input.status]
    );
    await writeAudit(conn, req.user.userId, 'CREATE', 'clinic', result.insertId, {
      afterStatus: input.status, details: { clinicNo: no }, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.status(201).json({ clinicId });
}));

router.put('/:id', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = clinicSchema.partial().parse(req.body);
  const existing = (await query('SELECT * FROM clinic WHERE clinic_id=?', [id]))[0];
  if (!existing) throw notFound('诊所不存在');
  assertClinicAccess(req.user, id);
  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE clinic SET clinic_no=?, postal_address=?, manager_name=?, phone=?, email=?, office_area_sqm=?, status=? WHERE clinic_id=?`,
      [input.clinicNo ?? existing.clinic_no, input.postalAddress ?? existing.postal_address,
       input.managerName ?? existing.manager_name, input.phone ?? existing.phone,
       input.email === '' ? null : (input.email ?? existing.email), input.officeAreaSqm ?? existing.office_area_sqm,
       input.status ?? existing.status, id]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'clinic', id, {
      beforeStatus: existing.status, afterStatus: input.status ?? existing.status, details: { fields: Object.keys(input) }, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

export default router;
