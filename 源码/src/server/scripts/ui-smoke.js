import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.resolve('artifacts/ui-smoke');
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('401')) errors.push('console: ' + msg.text()); });
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('response', (res) => { if (res.status() >= 500) errors.push('http '+res.status()+': '+res.url()); });

await page.goto(baseUrl + '/login', { waitUntil: 'networkidle0' });
await page.screenshot({ path: path.join(outDir, 'login.png'), fullPage: true });
await page.click('input[autocomplete="username"]', { clickCount: 3 });
await page.type('input[autocomplete="username"]', 'hqadmin', { delay: 10 });
await page.click('input[type="password"]', { clickCount: 3 });
await page.type('input[type="password"]', 'Dental@2026', { delay: 10 });
await page.click('.login-submit');
await page.waitForSelector('.app-shell', { timeout: 30000 });
await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 });
await new Promise((resolve) => setTimeout(resolve, 800));
await page.screenshot({ path: path.join(outDir, 'dashboard.png'), fullPage: true });

const routes = [
  ['/patients','患者档案'], ['/appointments','预约管理'], ['/schedules','排班与跨店出诊'],
  ['/dentists','牙医与资质'], ['/clinics','诊所信息'], ['/treatments','治疗项目与标准单价'],
  ['/visits','就诊与治疗'], ['/settlements','结算单'], ['/costs','季度成本审核'],
  ['/performance','牙医季度绩效'], ['/records','历史查询'], ['/audit','审计日志']
];
for (const [route, title] of routes) {
  await page.goto(baseUrl + route, { waitUntil: 'networkidle0' });
  await page.waitForFunction((expected) => document.querySelector('h1')?.textContent?.includes(expected), {}, title);
  await page.screenshot({ path: path.join(outDir, route.slice(1) + '.png'), fullPage: true });
}
await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
await page.goto(baseUrl + '/login', { waitUntil: 'networkidle0' });
await page.click('input[autocomplete="username"]', { clickCount: 3 });
await page.type('input[autocomplete="username"]', 'frontdesk', { delay: 10 });
await page.click('input[type="password"]', { clickCount: 3 });
await page.type('input[type="password"]', 'Dental@2026', { delay: 10 });
await page.click('.login-submit');
await page.waitForSelector('.app-shell', { timeout: 30000 });
const restricted = await page.evaluate(() => ['/costs','/performance','/audit'].filter((href) => document.querySelector('a[href="' + href + '"]')));
if (restricted.length) { errors.push('front desk saw restricted navigation: ' + restricted.join(',')); }
await page.goto(baseUrl + '/appointments', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('预约管理'));
await page.screenshot({ path: path.join(outDir, 'frontdesk-appointments.png'), fullPage: true });

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('UI smoke passed. Screenshots: ' + outDir);
