import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { forbidden, unauthorized } from './errors.js';

export const COOKIE_NAME = 'adc_session';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: '8h' });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  };
}

export async function loadUser(userId) {
  const rows = await query(
    `SELECT u.user_id, u.username, u.display_name, u.role_code, u.status,
            d.dentist_id
       FROM user_account u
       LEFT JOIN dentist_profile d ON d.user_id = u.user_id
      WHERE u.user_id = ?`,
    [userId]
  );
  if (!rows[0] || rows[0].status !== 'ACTIVE') throw unauthorized('账号不存在或已停用');
  const scopes = await query(
    'SELECT clinic_id FROM user_clinic_scope WHERE user_id = ? ORDER BY clinic_id',
    [userId]
  );
  return {
    userId: Number(rows[0].user_id),
    username: rows[0].username,
    displayName: rows[0].display_name,
    role: rows[0].role_code,
    dentistId: rows[0].dentist_id ? Number(rows[0].dentist_id) : null,
    clinicIds: scopes.map((r) => Number(r.clinic_id))
  };
}

export async function authRequired(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw unauthorized();
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = await loadUser(Number(payload.sub));
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(unauthorized('登录已过期，请重新登录'));
    }
    next(error);
  }
}

export function allow(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export function isHQ(user) {
  return user.role === 'HQ_MANAGER';
}

export function assertClinicAccess(user, clinicId) {
  const id = Number(clinicId);
  if (isHQ(user) || user.role === 'DENTIST') return id;
  if (!user.clinicIds.includes(id)) throw forbidden('该诊所不在您的授权范围内');
  return id;
}

export function scopedClinicSql(user, column, requestedClinicId) {
  if (requestedClinicId) {
    assertClinicAccess(user, requestedClinicId);
    return { sql: `${column} = ?`, params: [Number(requestedClinicId)] };
  }
  if (isHQ(user) || user.role === 'DENTIST') return { sql: '1 = 1', params: [] };
  if (!user.clinicIds.length) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${user.clinicIds.map(() => '?').join(',')})`, params: user.clinicIds };
}

export function canAccessDentist(user, dentistId) {
  return isHQ(user) || user.role !== 'DENTIST' || Number(user.dentistId) === Number(dentistId);
}

export function requireDentistSelf(user, dentistId) {
  if (user.role === 'DENTIST' && Number(user.dentistId) !== Number(dentistId)) {
    throw forbidden('牙医只能操作自己的接诊记录');
  }
}
