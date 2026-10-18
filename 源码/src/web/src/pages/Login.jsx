import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { useApp } from '../components/AppContext.jsx';
import { Button, Field } from '../components/ui.jsx';

const demoAccounts = [
  ['hqadmin', '总部管理人员'], ['frontdesk', '前台人员'], ['manager1', '诊所主管'], ['dentist1', '牙医']
];

export default function Login() {
  const { login } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('hqadmin');
  const [password, setPassword] = useState('Dental@2026');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(username, password); navigate(location.state?.from?.pathname || '/', { replace: true }); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  return <div className="login-page">
    <section className="login-story">
      <div className="login-brand"><div className="brand-mark large">A</div><div><strong>ADC</strong><span>Andrew’s Dental Chain</span></div></div>
      <div className="story-copy"><div className="eyebrow light"><Sparkles size={14} /> 连锁经营 · 标准协同</div><h1>让每一家诊所，<br />运行在同一套标准里。</h1><p>患者主档案、跨店预约、就诊治疗、结算与季度绩效，在授权范围内形成可追溯的业务闭环。</p></div>
      <div className="story-stats"><div><strong>15</strong><span>家门店统一管理</span></div><div><strong>12</strong><span>项核心业务用例</span></div><div><strong>100%</strong><span>关键操作留痕</span></div></div>
      <div className="story-note"><ShieldCheck size={16} /> 仅限 ADC 内部授权人员使用</div>
    </section>
    <section className="login-panel">
      <form className="login-form" onSubmit={submit}>
        <div className="login-head"><div className="eyebrow">内部员工登录</div><h2>欢迎回到工作台</h2><p>使用总部或门店分配的账号登录。</p></div>
        <Field label="用户名" required><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
        <Field label="密码" required><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        {error && <div className="inline-error">{error}</div>}
        <Button type="submit" className="login-submit" disabled={loading}>{loading ? '正在登录…' : '进入管理平台'} {!loading && <ArrowRight size={18} />}</Button>
        <div className="demo-box"><span>演示账号（密码均为 Dental@2026）</span><div>{demoAccounts.map(([name, role]) => <button type="button" key={name} onClick={() => { setUsername(name); setPassword('Dental@2026'); }}><strong>{name}</strong><small>{role}</small></button>)}</div></div>
      </form>
      <div className="login-foot">ADC Dental Clinic Management System · 内部管理系统</div>
    </section>
  </div>;
}
