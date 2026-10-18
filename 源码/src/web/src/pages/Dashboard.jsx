import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, CircleDollarSign, ClipboardList, TrendingDown, Users, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { api, dateTime, money } from '../lib/api.js';
import { Card, Empty, ErrorState, Loading, PageHeader, Badge } from '../components/ui.jsx';
import { useApp } from '../components/AppContext.jsx';

const metricDefs = [
  ['scheduledToday','今日待就诊',CalendarCheck2,'teal'],
  ['revenueToday','今日有效收入',CircleDollarSign,'gold'],
  ['activePatients','服务患者数',Users,'blue'],
  ['unsettledVisits','未结算就诊',ClipboardList,'coral'],
  ['cancellationRate','近30天取消/未到率',TrendingDown,'violet']
];

export default function Dashboard() {
  const { user } = useApp();
  const [meta, setMeta] = useState(null);
  const [clinicId, setClinicId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true); setError(null);
    Promise.all([api('/meta'), api('/dashboard' + (clinicId ? '?clinicId=' + clinicId : ''))])
      .then(([m,d]) => { setMeta(m); setData(d); }).catch(setError).finally(() => setLoading(false));
  };
  useEffect(load, [clinicId]);

  return <div>
    <PageHeader eyebrow="OPERATIONS OVERVIEW" title={'早上好，' + user.displayName} description="今天的预约、收入与待处理事项都汇总在这里。" actions={<select value={clinicId} onChange={(e) => setClinicId(e.target.value)}><option value="">全部授权诊所</option>{meta?.clinics.map((c) => <option key={c.clinic_id} value={c.clinic_id}>{c.clinic_no} · {c.postal_address}</option>)}</select>} />
    {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={load} /> : data && <>
      <div className="metric-grid">
        {metricDefs.map(([key,label,Icon,tone]) => <Card key={key} className={'metric-card tone-' + tone}><div className="metric-icon"><Icon size={20} /></div><span>{label}</span><strong>{key === 'revenueToday' ? money(data.metrics[key]) : key === 'cancellationRate' ? (data.metrics[key] * 100).toFixed(1) + '%' : data.metrics[key]}</strong>{key === 'revenueToday' && <small>{data.metrics.settledToday} 张有效结算</small>}{key === 'scheduledToday' && <small>今日共 {data.metrics.appointmentsToday} 个预约</small>}{key === 'unsettledVisits' && <small className={data.metrics.unsettledVisits ? 'warn-text' : ''}>{data.metrics.unsettledVisits ? '需要尽快处理' : '当前已全部结算'}</small>}</Card>)}
      </div>
      <div className="dashboard-grid">
        <Card className="chart-card span-2"><div className="card-head"><div><h2>收入趋势</h2><p>最近 6 个月 ACTIVE 结算单收入</p></div><Link to="/performance">查看季度绩效 <ArrowUpRight size={15} /></Link></div>{data.revenueTrend.length ? <div className="bar-chart">{data.revenueTrend.map((item) => { const max = Math.max(...data.revenueTrend.map((x) => x.revenue),1); return <div className="bar-item" key={item.month}><div className="bar-value">{money(item.revenue)}</div><div className="bar-track"><div className="bar-fill" style={{height: Math.max(6, item.revenue / max * 100) + '%'}} /></div><span>{item.month}</span></div>; })}</div> : <Empty title="暂无结算收入" description="完成结算后这里会显示真实收入趋势。" />}</Card>
        <Card><div className="card-head"><div><h2>牙医收入排行</h2><p>本季度累计有效结算收入</p></div></div>{data.topDentists.length ? <div className="ranking-list">{data.topDentists.map((d,i)=><div key={d.employee_no}><span className="rank-no">{String(i+1).padStart(2,'0')}</span><div><strong>{d.dentist_name}</strong><small>{d.employee_no}</small></div><b>{money(d.revenue)}</b></div>)}</div> : <Empty />}</Card>
        <Card className="span-2"><div className="card-head"><div><h2>即将到来的预约</h2><p>按预约开始时间排序</p></div><Link to="/appointments">全部预约 <ArrowUpRight size={15} /></Link></div>{data.upcoming.length ? <div className="table-wrap"><table><thead><tr><th>时间</th><th>患者</th><th>牙医</th><th>诊所</th><th>状态</th></tr></thead><tbody>{data.upcoming.map((a)=><tr key={a.appointment_id}><td><strong>{dateTime(a.scheduled_start_at)}</strong></td><td><Link to={'/patients/' + a.patient_id}>{a.patient_name}</Link><small className="block">{a.patient_no}</small></td><td>{a.dentist_name}</td><td>{a.clinic_no}</td><td><Badge value={a.status} /></td></tr>)}</tbody></table></div> : <Empty title="近期没有预约" />}</Card>
        <Card className="attention-card"><div className="card-head"><div><h2>需要关注</h2><p>基于实时业务数据</p></div></div><div className="attention-list"><div><AlertTriangle size={18} /><div><strong>{data.metrics.unsettledVisits} 次就诊未结算</strong><span>完成结算后才能进入绩效口径</span></div></div><div><TrendingDown size={18} /><div><strong>{(data.metrics.cancellationRate*100).toFixed(1)}% 取消/未到率</strong><span>近 30 天授权范围内预约</span></div></div><Link to="/records" className="text-link">去查询历史记录 →</Link></div></Card>
      </div>
    </>}
  </div>;
}
