import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, transaction } from '../db.js';
import { writeAudit } from '../audit.js';
import { COOKIE_NAME, cookieOptions, loadUser, signToken, verifyPassword } from '../auth.js';
import { asyncHandler, unauthorized } from '../errors.js';
import { nowUtcSql } from '../utils.js';
import jwt from 'jsonwebtoken';

const router = Router();
const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(64),
  password: z.string().min(1, '请输入密码').max(200)
});

router.post('/login', asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const rows = await query(
    'SELECT user_id, username, display_name, role_code, status, password_hash FROM user_account WHERE username = ?',
    [input.username]
  );
  const account = rows[0];
  if (!account || account.status !== 'ACTIVE' || !(await verifyPassword(input.password, account.password_hash))) {
    throw unauthorized('用户名或密码错误');
  }
  const user = await loadUser(account.user_id);
  res.cookie(COOKIE_NAME, signToken(account.user_id), cookieOptions());
  await transaction(async (conn) => {
    await conn.execute('UPDATE user_account SET last_login_at = ? WHERE user_id = ?', [nowUtcSql(), account.user_id]);
    await writeAudit(conn, account.user_id, 'LOGIN', 'user_account', account.user_id, {
      afterStatus: 'ACTIVE', details: { username: account.username, role: account.role_code }, ipAddress: req.ip
    });
  });
  res.json({ user });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}));

router.get('/me', asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw unauthorized();
  const payload = jwt.verify(token, config.jwtSecret);
  res.json({ user: await loadUser(Number(payload.sub)) });
}));

export default router;
