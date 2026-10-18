export class ApiError extends Error {
  constructor(payload, status) {
    super(payload?.message || '请求失败');
    this.status = status;
    this.code = payload?.code || 'ERROR';
    this.details = payload?.details || null;
  }
}

export async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch('/api' + path, {
    credentials: 'include',
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new ApiError(payload?.error || { message: payload }, response.status);
  }
  return payload;
}

export const money = (value) => value === null || value === undefined || value === ''
  ? '—'
  : new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(value));

export const dateTime = (value) => !value ? '—' : new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'))
  .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export const dateOnly = (value) => !value ? '—' : String(value).slice(0, 10);

export const localInput = (value) => {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return get('year') + '-' + get('month') + '-' + get('day') + 'T' + get('hour') + ':' + get('minute');
};

export const statusText = {
  SCHEDULED: '待就诊', ATTENDED: '已到诊', NO_SHOW: '未到诊', CANCELLED: '已取消', RESCHEDULED: '已改期',
  IN_PROGRESS: '诊疗中', COMPLETED: '已完成', VOID: '已作废',
  ACTIVE: '有效', INACTIVE: '停用', DRAFT: '草稿', PUBLISHED: '已发布', CANCELLED_SCHEDULE: '已取消',
  APPROVED: '已批准', REJECTED: '已驳回', VERIFIED: '已审核', PENDING: '待处理', CONFIRMED: '已确认',
  PROVISIONAL_COMPLETE: '临时完整', PROVISIONAL_INCOMPLETE: '数据不完整', CONFIRMED_COMPLETE: '已确认快照', NO_ACTIVITY: '暂无数据',
  MISSING: '缺失', CONFIRMED_ZERO: '确认零成本', REJECTED_ONLY: '仅驳回', PENDING_COST: '待审核',
  PATIENT: '患者', CLINIC: '诊所', MEDICAL_SUPPLIES: '医疗用品', OPERATING_EXPENSE: '运营费用'
};

export const statusTone = (value) => {
  if (['ACTIVE','SCHEDULED','PUBLISHED','APPROVED','VERIFIED','CONFIRMED','COMPLETED','ATTENDED','PROVISIONAL_COMPLETE','CONFIRMED_COMPLETE'].includes(value)) return 'green';
  if (['CANCELLED','NO_SHOW','VOID','REJECTED','INACTIVE','PROVISIONAL_INCOMPLETE','MISSING','REJECTED_ONLY'].includes(value)) return 'red';
  if (['DRAFT','PENDING','IN_PROGRESS','RESCHEDULED','PENDING_COST'].includes(value)) return 'amber';
  return 'blue';
};
