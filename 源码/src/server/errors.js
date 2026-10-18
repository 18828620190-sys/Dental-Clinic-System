import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = '请先登录') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = '无权执行此操作') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = '记录不存在') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);

export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError) {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: '表单校验失败', details: error.flatten() }
    });
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      error: { code: 'DUPLICATE', message: '数据已存在，请检查唯一字段', details: error.sqlMessage }
    });
  }
  if (error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return res.status(422).json({ error: { code: 'CONSTRAINT_VIOLATED', message: '数据不满足业务约束', details: error.sqlMessage } });
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(422).json({ error: { code: 'INVALID_REFERENCE', message: '关联记录不存在或不可用', details: error.sqlMessage } });
  }
  if (error?.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({
      error: { code: 'REFERENCED', message: '记录已被其他业务数据引用，不能删除或修改' }
    });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status >= 500 ? '服务器处理请求时发生错误' : error.message,
      details: error.details || null
    }
  });
}
