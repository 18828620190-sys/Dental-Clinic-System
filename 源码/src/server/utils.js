import crypto from 'node:crypto';

const SHANGHAI_OFFSET = '+08:00';

export function toUtcSql(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) return raw.slice(0, 19);
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) normalized = `${raw}${SHANGHAI_OFFSET}`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`无效日期时间：${raw}`);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function nowUtcSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function shanghaiDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

export function shanghaiToday() {
  const p = shanghaiDateParts();
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function currentQuarter(date = new Date()) {
  const p = shanghaiDateParts(date);
  return { year: p.year, quarter: Math.floor((p.month - 1) / 3) + 1 };
}

export function quarterBounds(year, quarter) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('年度无效');
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error('季度无效');
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 3;
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01T00:00:00+08:00`;
  const endYear = endMonth > 12 ? year + 1 : year;
  const endMonthNormalized = endMonth > 12 ? endMonth - 12 : endMonth;
  const end = `${endYear}-${String(endMonthNormalized).padStart(2, '0')}-01T00:00:00+08:00`;
  return { start: toUtcSql(start), end: toUtcSql(end) };
}

export function dayBounds(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString))) throw new Error('日期格式应为 YYYY-MM-DD');
  const start = new Date(`${dateString}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().slice(0, 19).replace('T', ' '),
    end: end.toISOString().slice(0, 19).replace('T', ' ')
  };
}

export function makeNo(prefix) {
  const p = shanghaiDateParts();
  const date = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  return `${prefix}-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function parsePagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paged(rows, total, page, pageSize) {
  return { items: rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export function asId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('记录编号无效');
  return id;
}

export function safeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}
