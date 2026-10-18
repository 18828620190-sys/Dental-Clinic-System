# ADC 牙科连锁诊所管理系统

安德鲁牙科连锁（Andrew's Dental Chain, ADC）内部管理系统。本仓库包含最终课程报告和可运行的前后端源码。

## 仓库结构

```text
报告/
  ADC牙科连锁诊所管理系统_分析与设计报告_最终版.pdf
源码/
  src/server/        Express 后端
  src/web/           React 管理端
  sql/01_schema.sql  MySQL 8.0 建表脚本
  .env.example       环境变量模板
  package.json       运行与测试命令
```

## 系统说明

- 技术栈：React 18、Vite 4、Express 4、mysql2、JWT Cookie、bcrypt、MySQL 8.0。
- 使用对象：前台人员、牙医、诊所主管、总部管理人员。
- 本项目是 ADC 内部管理平台，不包含患者注册、患者登录、患者自助预约或患者结算门户。

## 环境要求

- Node.js >= 16.20，建议使用 Node.js 16.20.x 或更高版本。
- npm。
- MySQL 8.0。
- 可选：Chrome，用于执行页面冒烟测试。

## 一、初始化数据库

以下命令默认在仓库根目录的 `源码` 目录中执行：

```bash
cd 源码
mysql -h 127.0.0.1 -P 3307 -u root -p < sql/01_schema.sql
```

进入 MySQL 后创建应用账号并授权。请把示例密码替换为自己的本地密码：

```sql
CREATE USER 'dental_app'@'127.0.0.1' IDENTIFIED BY '你的本地数据库密码';
CREATE USER 'dental_app'@'localhost' IDENTIFIED BY '你的本地数据库密码';

GRANT ALL PRIVILEGES ON dental_clinic_db.* TO 'dental_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON dental_clinic_db.* TO 'dental_app'@'localhost';

GRANT ALL PRIVILEGES ON dental_clinic_test.* TO 'dental_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON dental_clinic_test.* TO 'dental_app'@'localhost';

FLUSH PRIVILEGES;
```

如果本机 MySQL 使用 3306 端口，请把命令和 `.env` 中的端口改为 3306。

## 二、配置环境变量

Windows PowerShell（在 `源码` 目录执行）：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
PORT=3000
JWT_SECRET=替换为足够长的随机字符串
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=dental_app
DB_PASSWORD=你的本地数据库密码
DB_DATABASE=dental_clinic_db
DEFAULT_DENTIST_PASSWORD=新建牙医时的初始密码
APP_TIMEZONE=Asia/Shanghai
DEMO_PASSWORD=Dental@2026
```

`.env` 包含本地凭据，不要提交到 GitHub。

## 三、安装依赖

继续在 `源码` 目录执行：

```bash
npm install
```

## 四、写入演示数据

```bash
npm run db:seed
```

种子脚本只在 `user_account` 为空时写入数据。如果数据库中已经存在账号，脚本会停止，不会清空已有数据。

演示账号：

| 用户名 | 角色 |
|---|---|
| `hqadmin` | 总部管理人员 |
| `frontdesk` | 前台人员 |
| `manager1` / `manager2` | 诊所主管 |
| `dentist1` — `dentist4` | 牙医 |

统一演示密码：`Dental@2026`

仅用于本地开发，生产环境必须修改。

## 五、构建并启动

```bash
npm run build
npm start
```

浏览器打开：

```text
http://127.0.0.1:3000
```

### 开发模式

```bash
npm run dev
```

- 前端开发地址：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:3000`

## 六、测试

后端集成测试：

```bash
npm test
```

该命令会删除并重建仅用于测试的 `dental_clinic_test` 数据库，然后运行真实 MySQL 集成测试。请勿把测试数据库指向业务数据库。

页面冒烟测试需要先启动系统，并安装本机 Chrome：

```bash
npm run test:ui
```

## 七、项目报告

最终报告位于：

```text
报告/ADC牙科连锁诊所管理系统_分析与设计报告_最终版.pdf
```

## 八、常见问题

### 数据库连接失败

检查 MySQL 是否启动、端口是否正确，以及 `.env` 中的 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD` 是否与本地环境一致。

### npm install 或构建失败

先执行：

```bash
node --version
npm --version
```

确认 Node.js 版本不低于 16.20。

### 种子脚本没有写入数据

说明数据库的 `user_account` 已有记录。为保护现有数据，脚本不会清库或覆盖账号。

### 页面无法登录

确认已经执行 `npm run db:seed`，并使用上方演示账号。

## 安全说明

- 仓库不包含 `.env`、真实密码或密钥。
- 数据库业务时间统一按 UTC 保存，界面和季度边界按 `Asia/Shanghai` 展示。
- 关键业务写操作使用事务、行锁和审计日志。
