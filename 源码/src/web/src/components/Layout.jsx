import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, CalendarDays, CalendarClock, Stethoscope, Building2,
  BadgeDollarSign, ClipboardPlus, ReceiptText, WalletCards, ChartNoAxesCombined,
  SearchCheck, ScrollText, LogOut, Menu, X, ShieldCheck
} from 'lucide-react';
import { useApp } from './AppContext.jsx';

const roleLabels = { HQ_MANAGER: '总部管理人员', CLINIC_MANAGER: '诊所主管', FRONT_DESK: '前台人员', DENTIST: '牙医' };
const navItems = [
  { to: '/', label: '经营概览', icon: LayoutDashboard, exact: true },
  { to: '/patients', label: '患者档案', icon: Users, roles: ['FRONT_DESK','DENTIST','CLINIC_MANAGER','HQ_MANAGER'] },
  { to: '/appointments', label: '预约管理', icon: CalendarDays },
  { to: '/schedules', label: '排班与出诊', icon: CalendarClock },
  { to: '/dentists', label: '牙医与资质', icon: Stethoscope },
  { to: '/clinics', label: '诊所信息', icon: Building2 },
  { to: '/treatments', label: '治疗项目', icon: BadgeDollarSign },
  { to: '/visits', label: '就诊与治疗', icon: ClipboardPlus },
  { to: '/settlements', label: '结算单', icon: ReceiptText },
  { to: '/costs', label: '成本审核', icon: WalletCards, roles: ['CLINIC_MANAGER','HQ_MANAGER'] },
  { to: '/performance', label: '季度绩效', icon: ChartNoAxesCombined, roles: ['DENTIST','CLINIC_MANAGER','HQ_MANAGER'] },
  { to: '/records', label: '历史查询', icon: SearchCheck },
  { to: '/audit', label: '审计日志', icon: ScrollText, roles: ['HQ_MANAGER'] }
];

export default function Layout() {
  const { user, logout } = useApp();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const visible = navItems.filter((item) => !item.roles || item.roles.includes(user.role));
  const doLogout = async () => { await logout(); navigate('/login'); };
  return <div className="app-shell">
    <aside className={'sidebar ' + (open ? 'open' : '')}>
      <div className="brand"><div className="brand-mark">A</div><div><strong>ADC 牙科连锁</strong><span>Clinic Management</span></div><button className="mobile-close icon-btn" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <nav>
        {visible.map(({ to, label, icon: Icon, exact }) => <NavLink key={to} to={to} end={exact} onClick={() => setOpen(false)} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={18} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-foot"><ShieldCheck size={16} /><span>数据按角色与诊所范围隔离</span></div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <button className="mobile-menu icon-btn" onClick={() => setOpen(true)}><Menu size={20} /></button>
        <div className="topbar-title">安德鲁牙科连锁 · 内部管理平台</div>
        <div className="user-area"><div className="avatar">{user.displayName.slice(0, 1)}</div><div className="user-meta"><strong>{user.displayName}</strong><span>{roleLabels[user.role]}{user.clinicIds?.length ? ' · ' + user.clinicIds.length + ' 家诊所' : user.role === 'HQ_MANAGER' ? ' · 全部门店' : ''}</span></div><button className="icon-btn" title="退出登录" onClick={doLogout}><LogOut size={18} /></button></div>
      </header>
      <main className="content"><Outlet /></main>
    </div>
    {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
  </div>;
}
