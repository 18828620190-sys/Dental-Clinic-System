import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(root, '.env') });
const testDatabase = 'dental_clinic_test';
if (!testDatabase.endsWith('_test')) throw new Error('安全保护：测试数据库名必须以 _test 结尾');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
  charset: 'utf8mb4'
});
try {
  await connection.query('DROP DATABASE IF EXISTS `dental_clinic_test`');
  await connection.query('CREATE DATABASE `dental_clinic_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  await connection.query('USE `dental_clinic_test`');
  const schema = fs.readFileSync(path.join(root, 'sql/01_schema.sql'), 'utf8').replaceAll('dental_clinic_db', testDatabase);
  await connection.query(schema);
  console.log('测试数据库已重建：' + testDatabase);
} finally {
  await connection.end();
}
