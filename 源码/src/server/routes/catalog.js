import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { allow } from '../auth.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { asId, shanghaiToday } from '../utils.js';

const router = Router();

router.get('/qualifications', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM qualification ORDER BY status, qualification_name');
  res.json({ items: rows });
}));

router.post('/qualifications', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const input = z.object({ qualificationName: z.string().trim().min(1).max(100), status: z.enum(['ACTIVE','INACTIVE']).default('ACTIVE') }).parse(req.body);
  const id = await transaction(async (conn) => {
    const [result] = await conn.execute('INSERT INTO qualification (qualification_name, status) VALUES (?, ?)', [input.qualificationName, input.status]);
    await writeAudit(conn, req.user.userId, 'CREATE', 'qualification', result.insertId, { afterStatus: input.status, details: input, ipAddress: req.ip });
    return result.insertId;
  });
  res.status(201).json({ qualificationId: id });
}));

router.put('/qualifications/:id', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = z.object({ qualificationName: z.string().trim().min(1).max(100), status: z.enum(['ACTIVE','INACTIVE']) }).parse(req.body);
  await transaction(async (conn) => {
    const [result] = await conn.execute('UPDATE qualification SET qualification_name=?, status=? WHERE qualification_id=?', [input.qualificationName, input.status, id]);
    if (!result.affectedRows) throw notFound('资质不存在');
    await writeAudit(conn, req.user.userId, 'UPDATE', 'qualification', id, { afterStatus: input.status, details: input, ipAddress: req.ip });
  });
  res.json({ ok: true });
}));

router.get('/treatments', asyncHandler(async (req, res) => {
  const today = shanghaiToday();
  const items = await query(
    `SELECT ti.*,
       (SELECT tp.price_id FROM treatment_price tp WHERE tp.treatment_item_id=ti.treatment_item_id AND tp.approval_status='APPROVED' AND tp.effective_from<=? ORDER BY tp.effective_from DESC, tp.version_no DESC LIMIT 1) AS current_price_id,
       (SELECT tp.standard_unit_price FROM treatment_price tp WHERE tp.treatment_item_id=ti.treatment_item_id AND tp.approval_status='APPROVED' AND tp.effective_from<=? ORDER BY tp.effective_from DESC, tp.version_no DESC LIMIT 1) AS current_price,
       (SELECT tp.effective_from FROM treatment_price tp WHERE tp.treatment_item_id=ti.treatment_item_id AND tp.approval_status='APPROVED' AND tp.effective_from<=? ORDER BY tp.effective_from DESC, tp.version_no DESC LIMIT 1) AS current_effective_from
     FROM treatment_item ti ORDER BY ti.status, ti.treatment_name`,
    [today, today, today]
  );
  const prices = await query(
    `SELECT tp.*, u.display_name AS approved_by_name FROM treatment_price tp LEFT JOIN user_account u ON u.user_id=tp.approved_by_user_id ORDER BY tp.treatment_item_id, tp.version_no DESC`
  );
  res.json({ items, prices });
}));

router.post('/treatments', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const input = z.object({
    treatmentName: z.string().trim().min(1).max(100),
    status: z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),
    standardUnitPrice: z.coerce.number().positive(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }).parse(req.body);
  const itemId = await transaction(async (conn) => {
    const [result] = await conn.execute('INSERT INTO treatment_item (treatment_name, status) VALUES (?, ?)', [input.treatmentName, input.status]);
    await conn.execute(
      `INSERT INTO treatment_price (treatment_item_id, version_no, standard_unit_price, effective_from, approval_status, created_by_user_id)
       VALUES (?, 1, ?, ?, 'DRAFT', ?)`,
      [result.insertId, input.standardUnitPrice, input.effectiveFrom, req.user.userId]
    );
    await writeAudit(conn, req.user.userId, 'CREATE', 'treatment_item', result.insertId, {
      afterStatus: input.status, details: { treatmentName: input.treatmentName, standardUnitPrice: input.standardUnitPrice }, ipAddress: req.ip
    });
    return result.insertId;
  });
  res.status(201).json({ treatmentItemId: itemId });
}));

router.put('/treatments/:id', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const input = z.object({ treatmentName: z.string().trim().min(1).max(100).optional(), status: z.enum(['ACTIVE','INACTIVE']).optional() }).parse(req.body);
  const existing = (await query('SELECT * FROM treatment_item WHERE treatment_item_id=?', [id]))[0];
  if (!existing) throw notFound('治疗项目不存在');
  await transaction(async (conn) => {
    await conn.execute('UPDATE treatment_item SET treatment_name=?, status=? WHERE treatment_item_id=?', [input.treatmentName ?? existing.treatment_name, input.status ?? existing.status, id]);
    await writeAudit(conn, req.user.userId, 'UPDATE', 'treatment_item', id, { beforeStatus: existing.status, afterStatus: input.status ?? existing.status, details: { fields: Object.keys(input) }, ipAddress: req.ip });
  });
  res.json({ ok: true });
}));

router.post('/treatments/:id/prices', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const itemId = asId(req.params.id);
  const input = z.object({ standardUnitPrice: z.coerce.number().positive(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
  const priceId = await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT COALESCE(MAX(version_no),0)+1 AS next_version FROM treatment_price WHERE treatment_item_id=? FOR UPDATE', [itemId]);
    const [result] = await conn.execute(
      `INSERT INTO treatment_price (treatment_item_id, version_no, standard_unit_price, effective_from, approval_status, created_by_user_id)
       VALUES (?, ?, ?, ?, 'DRAFT', ?)`,
      [itemId, rows[0].next_version, input.standardUnitPrice, input.effectiveFrom, req.user.userId]
    );
    await writeAudit(conn, req.user.userId, 'CREATE', 'treatment_price', result.insertId, { relatedEntityId: itemId, afterStatus: 'DRAFT', details: input, ipAddress: req.ip });
    return result.insertId;
  });
  res.status(201).json({ priceId });
}));

router.post('/prices/:id/approve', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM treatment_price WHERE price_id=? FOR UPDATE', [id]);
    const price = rows[0];
    if (!price) throw notFound('价格记录不存在');
    if (price.approval_status !== 'DRAFT') throw badRequest('只有草稿价格可以审核通过');
    await conn.execute(
      `UPDATE treatment_price SET approval_status='APPROVED', approved_by_user_id=?, approved_at=? WHERE price_id=?`,
      [req.user.userId, now, id]
    );
    await writeAudit(conn, req.user.userId, 'UPDATE', 'treatment_price', id, { relatedEntityId: price.treatment_item_id, beforeStatus: 'DRAFT', afterStatus: 'APPROVED', ipAddress: req.ip });
  });
  res.json({ ok: true });
}));

router.post('/prices/:id/reject', allow('HQ_MANAGER'), asyncHandler(async (req, res) => {
  const id = asId(req.params.id);
  const reason = z.object({ reason: z.string().trim().min(1).max(255) }).parse(req.body).reason;
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM treatment_price WHERE price_id=? FOR UPDATE', [id]);
    const price = rows[0];
    if (!price) throw notFound('价格记录不存在');
    if (price.approval_status !== 'DRAFT') throw badRequest('只有草稿价格可以退回');
    await conn.execute("UPDATE treatment_price SET approval_status='REJECTED' WHERE price_id=?", [id]);
    await writeAudit(conn, req.user.userId, 'UPDATE', 'treatment_price', id, { relatedEntityId: price.treatment_item_id, beforeStatus: 'DRAFT', afterStatus: 'REJECTED', reason, ipAddress: req.ip });
  });
  res.json({ ok: true });
}));

export default router;
