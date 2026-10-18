import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

const database = required('DB_DATABASE', 'dental_clinic_db');
if (process.env.NODE_ENV === 'test' && !database.endsWith('_test')) {
  throw new Error(`测试环境数据库必须以 _test 结尾，当前为 ${database}`);
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  jwtSecret: required('JWT_SECRET', 'development-only-change-me'),
  appTimezone: process.env.APP_TIMEZONE || 'Asia/Shanghai',
  demoPassword: process.env.DEMO_PASSWORD || 'Dental@2026',
  defaultDentistPassword: process.env.DEFAULT_DENTIST_PASSWORD || 'Dentist@2026',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER', 'root'),
    password: process.env.DB_PASSWORD || '',
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+00:00',
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false
  }
};
