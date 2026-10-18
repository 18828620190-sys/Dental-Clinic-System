import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow, assertClinicAccess, isHQ } from '../auth.js';
import { asyncHandler, conflict, notFound } from '../errors.js';
import { asId, makeNo, paged, parsePagination, safeJson } from '../utils.js';

const router = Router();
const patientSchema = z.object({
  patientName: z.string().trim().min(1).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingAddress: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(5).max(32),
  email: z.string().trim().email().max(254).nullable().optional().or(z.literal('')),
  emergencyContactName: z.string().trim().min(1).max(100),
  emergencyContactPhone: z.string().trim().min(5).max(32),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  clinicId: z.coerce.number().int().positive().nullable().optional(),
  allergies: z.array(z.object({
    allergyName: z.string().trim().min(1).max(100),
    note: z.string().trim().max(255).nullable().optional(),
    confirmationStatus: z.enum(['CONFIRMED', 'PENDING']).default('PENDING')
  })).default([]),
  confirmDuplicate: z.boolean().default(false)
});

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.q) {
    where.push('(p.patient_name LIKE ? OR p.phone LIKE ? OR p.patient_no LIKE ?)');
    const term = `%${String(req.query.q).trim()}%`;
    params.push(term, term, term);
  }
  if (req.query.status) { where.push('p.status = ?'); params.push(req.query.status); }
  if (req.query.clinicId) {
    assertClinicAccess(req.user, req.query.clinicId);
    where.push('EXISTS (SELECT 1 FROM patient_clinic_relation pcr WHERE pcr.patient_id = p.patient_id AND pcr.clinic_id = ?)');
    params.push(Number(req.query.clinicId));
  }
  const condition = where.join(' AND ');
  const count = (await query(`SELECT COUNT(*) AS total FROM patient p WHERE ${condition}`, params))[0].total;
  const items = await query(
    `SELECT p.patient_id, p.patient_no, p.patient_name, p.birth_date, p.phone, p.email,
            p.billing_address, p.emergency_contact_name, p.emergency_contact_phone, p.status,
            p.created_at, p.updated_at,
            (SELECT COUNT(*) FROM patient_allergy pa WHERE pa.patient_id = p.patient_id) AS allergy_count,
            (SELECT COUNT(*) FROM appointment a WHERE a.patient_id = p.patient_id) AS appointment_count,
            (SELECT COUNT(*) FROM visit v JOIN appointment a ON a.appointment_id=v.appointment_id WHERE a.patient_id=p.patient_id) AS visit_count
       FROM patient p WHERE ${condition}
      ORDER BY p.updated_at DESC, p.patient_id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json(paged(items, Number(count), page, pageSize));
}));

router.post('/', allow('FRONT_DESK', 'CLINIC_MANAGER', 'HQ_MANAGER'), asyncHandler(async (req, res) => {
  const input = patientSchema.parse(req.body);
  if (input.clinicId) assertClinicAccess(req.user, input.clinicId);
  if (!input.confirmDuplicate) {
    const duplicates = await query(
      `SELECT patient_id, patient_no, patient_name, birth_date, phone
         FROM patient WHERE patient_name = ? AND birth_date = ? AND phone = ? AND status = 'ACTIVE' LIMIT 5`,
      [input.patientName, input.birthDate, input.phone]
    );
    if (duplicates.length) throw conflict('发现疑似重复患者，请核实后确认新建', { duplicates });
  }
  const patientId = await transaction(async (conn) => {
    const patientNo = makeNo('PAT');
    const [result] = await conn.execute(
      `INSERT INTO patient (patient_no, patient_name, birth_date, billing_address, phone, email,
         emergency_contact_name, emergency_contact_phone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patientNo, input.patientName, input.birthDate, input.billingAddress, input.phone,
       input.email || null, input.emergencyContactName, input.emergencyContactPhone, input.status]
    );
    const id = result.insertId;
    for (const allergy of input.allergies) {
      await conn.execute(
        'INSERT INTO patient_allergy (patient_id, allergy_name, note, confirmation_status) VALUES (?, ?, ?, ?)',
        [id, allergy.allergyName, allergy.note || null, allergy.confirmationStatus]
      );
    }
    if (input.clinicId) {
      await conn.execute('INSERT INTO patient_clinic_relation (patient_id, clinic_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE patient_id = patient_id', [id, input.clinicId]);
    }
    await writeAudit(conn, req.user.userId, 'CREATE', 'patient', id, {
      afterStatus: input.status, details: { patientNo, patientName: input.patientName }, ipAddress: req.ip
    });
    return id;
  });
  res.status(201).json({ patientId });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const patient = (await query('SELECT * FROM patient WHERE patient_id = ?', [id]))[0];
  if (!patient) throw notFound('患者不存在');
  const [allergies, clinics, appointments, visits, settlements] = await Promise.all([
    query('SELECT * FROM patient_allergy WHERE patient_id = ? ORDER BY created_at', [id]),
    query(`SELECT c.clinic_id, c.clinic_no, c.postal_address, pcr.created_at FROM patient_clinic_relation pcr JOIN clinic c ON c.clinic_id=pcr.clinic_id WHERE pcr.patient_id=?`, [id]),
    query(`SELECT a.*, c.clinic_no, u.display_name AS dentist_name FROM appointment a JOIN clinic c ON c.clinic_id=a.clinic_id JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id WHERE a.patient_id=? ORDER BY a.scheduled_start_at DESC`, [id]),
    query(`SELECT v.*, a.appointment_no, c.clinic_no, u.display_name AS dentist_name FROM visit v JOIN appointment a ON a.appointment_id=v.appointment_id JOIN clinic c ON c.clinic_id=a.clinic_id JOIN dentist_profile d ON d.dentist_id=a.dentist_id JOIN user_account u ON u.user_id=d.user_id WHERE a.patient_id=? ORDER BY v.visit_datetime DESC`, [id]),
    query(`SELECT s.*, v.visit_no, c.clinic_no FROM settlement s JOIN visit v ON v.visit_id=s.visit_id JOIN appointment a ON a.appointment_id=v.appointment_id JOIN clinic c ON c.clinic_id=a.clinic_id WHERE a.patient_id=? ORDER BY s.activated_at DESC`, [id])
  ]);
  res.json({ patient, allergies, clinics, appointments, visits, settlements });
}));

router.put('/:id', allow('FRONT_DESK', 'CLINIC_MANAGER', 'HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = patientSchema.partial().parse(req.body);
  const existing = (await query('SELECT * FROM patient WHERE patient_id=?', [id]))[0];
  if (!existing) throw notFound('患者不存在');
  const values = {
    patient_name: input.patientName ?? existing.patient_name,
    birth_date: input.birthDate ?? existing.birth_date,
    billing_address: input.billingAddress ?? existing.billing_address,
    phone: input.phone ?? existing.phone,
    email: input.email === '' ? null : (input.email ?? existing.email),
    emergency_contact_name: input.emergencyContactName ?? existing.emergency_contact_name,
    emergency_contact_phone: input.emergencyContactPhone ?? existing.emergency_contact_phone,
    status: input.status ?? existing.status
  };
  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE patient SET patient_name=?, birth_date=?, billing_address=?, phone=?, email=?,
         emergency_contact_name=?, emergency_contact_phone=?, status=? WHERE patient_id=?`,
      [values.patient_name, values.birth_date, values.billing_address, values.phone, values.email,
       values.emergency_contact_name, values.emergency_contact_phone, values.status, id]
    );
    if (input.clinicId) {
      assertClinicAccess(req.user, input.clinicId);
      await conn.execute('INSERT INTO patient_clinic_relation (patient_id, clinic_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE patient_id=patient_id', [id, input.clinicId]);
    }
    await writeAudit(conn, req.user.userId, 'UPDATE', 'patient', id, {
      beforeStatus: existing.status, afterStatus: values.status, details: { fields: Object.keys(input) }, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

const allergySchema = z.object({
  allergyName: z.string().trim().min(1).max(100),
  note: z.string().trim().max(255).nullable().optional(),
  confirmationStatus: z.enum(['CONFIRMED', 'PENDING']).default('PENDING')
});

router.post('/:id/allergies', allow('FRONT_DESK', 'CLINIC_MANAGER', 'HQ_MANAGER'), asyncHandler(async (req, res) => {
  const patientId = asId(req.params.id);
  const input = allergySchema.parse(req.body);
  const allergyId = await transaction(async (conn) => {
    const [result] = await conn.execute(
      'INSERT INTO patient_allergy (patient_id, allergy_name, note, confirmation_status) VALUES (?, ?, ?, ?)',
      [patientId, input.allergyName, input.note || null, input.confirmationStatus]
    );
    await writeAudit(conn, req.user.userId, 'CREATE', 'patient_allergy', result.insertId, {
      relatedEntityId: patientId, details: input, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.status(201).json({ allergyId });
}));

router.put('/:id/allergies/:allergyId', allow('FRONT_DESK', 'CLINIC_MANAGER', 'HQ_MANAGER'), asyncHandler(async (req, res) => {
  const patientId = asId(req.params.id);
  const allergyId = asId(req.params.allergyId);
  const input = allergySchema.parse(req.body);
  const existing = (await query('SELECT * FROM patient_allergy WHERE allergy_id=? AND patient_id=?', [allergyId, patientId]))[0];
  if (!existing) throw notFound('过敏记录不存在');
  await transaction(async (conn) => {
    await conn.execute(
      'UPDATE patient_allergy SET allergy_name=?, note=?, confirmation_status=? WHERE allergy_id=?',
      [input.allergyName, input.note || null, input.confirmationStatus, allergyId]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'patient_allergy', allergyId, {
      relatedEntityId: patientId, details: input, ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

router.delete('/:id/allergies/:allergyId', allow('FRONT_DESK', 'CLINIC_MANAGER', 'HQ_MANAGER'), asyncHandler(async (req, res) => {
  const patientId = asId(req.params.id);
  const allergyId = asId(req.params.allergyId);
  await transaction(async (conn) => {
    const [result] = await conn.execute('DELETE FROM patient_allergy WHERE allergy_id=? AND patient_id=?', [allergyId, patientId]);
    if (!result.affectedRows) throw notFound('过敏记录不存在');
    await writeAudit(conn, req.user.userId, 'UPDATE', 'patient_allergy', allergyId, {
      relatedEntityId: patientId, reason: '删除过敏记录', ipAddress: req.ip
    });
  });
  res.json({ ok: true });
}));

export default router;
