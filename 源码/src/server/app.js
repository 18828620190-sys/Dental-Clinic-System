import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { projectRoot } from './config.js';
import { authRequired } from './auth.js';
import { errorHandler } from './errors.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import dashboardRoutes from './routes/dashboard.js';
import patientRoutes from './routes/patients.js';
import dentistRoutes from './routes/dentists.js';
import clinicRoutes from './routes/clinics.js';
import catalogRoutes from './routes/catalog.js';
import scheduleRoutes from './routes/schedules.js';
import availabilityRoutes from './routes/availability.js';
import appointmentRoutes from './routes/appointments.js';
import visitRoutes from './routes/visits.js';
import settlementRoutes from './routes/settlements.js';
import costRoutes from './routes/costs.js';
import performanceRoutes from './routes/performance.js';
import auditRoutes from './routes/audit.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req,res,next)=>{ res.set('X-Request-Time', new Date().toISOString()); next(); });

app.get('/api/health', (req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.use('/api/auth', authRoutes);
app.use('/api', authRequired);
app.use('/api/meta', metaRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/dentists', dentistRoutes);
app.use('/api/clinics', clinicRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/costs', costRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/audit', auditRoutes);

const dist = path.resolve(projectRoot, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req,res,next)=>{
    if(req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist,'index.html'));
  });
}
app.use('/api', (req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'接口不存在'}}));
app.use(errorHandler);
