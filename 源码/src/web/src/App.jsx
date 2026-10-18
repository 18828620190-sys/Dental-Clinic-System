import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './components/AppContext.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Patients from './pages/Patients.jsx';
import PatientDetail from './pages/PatientDetail.jsx';
import Appointments from './pages/Appointments.jsx';
import Schedules from './pages/Schedules.jsx';
import Dentists from './pages/Dentists.jsx';
import Clinics from './pages/Clinics.jsx';
import Treatments from './pages/Treatments.jsx';
import Visits from './pages/Visits.jsx';
import VisitDetail from './pages/VisitDetail.jsx';
import Settlements from './pages/Settlements.jsx';
import SettlementDetail from './pages/SettlementDetail.jsx';
import Costs from './pages/Costs.jsx';
import Performance from './pages/Performance.jsx';
import Records from './pages/Records.jsx';
import Audit from './pages/Audit.jsx';

function Protected() {
  const { user, loading } = useApp();
  const location = useLocation();
  if (loading) return <div className="boot"><Loading label="正在验证登录状态…" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Layout />;
}

function PublicOnly({ children }) {
  const { user, loading } = useApp();
  if (loading) return <div className="boot"><Loading /></div>;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return <AppProvider>
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="/patients" element={<Patients />} />
        <Route path="/patients/:id" element={<PatientDetail />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/schedules" element={<Schedules />} />
        <Route path="/dentists" element={<Dentists />} />
        <Route path="/clinics" element={<Clinics />} />
        <Route path="/treatments" element={<Treatments />} />
        <Route path="/visits" element={<Visits />} />
        <Route path="/visits/:id" element={<VisitDetail />} />
        <Route path="/settlements" element={<Settlements />} />
        <Route path="/settlements/:id" element={<SettlementDetail />} />
        <Route path="/costs" element={<Costs />} />
        <Route path="/performance" element={<Performance />} />
        <Route path="/records" element={<Records />} />
        <Route path="/audit" element={<Audit />} />
      </Route>
    </Routes>
  </AppProvider>;
}
