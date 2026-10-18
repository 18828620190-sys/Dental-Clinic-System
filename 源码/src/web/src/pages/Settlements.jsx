import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ReceiptText } from 'lucide-react';
import { api, dateTime, money } from '../lib/api.js';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, Pagination, Table } from '../components/ui.jsx';

export default function Settlements(){
  const [items,setItems]=useState([]); const [pagination,setPagination]=useState(null); const [meta,setMeta]=useState(null); const [filters,setFilters]=useState({q:'',clinicId:'',status:'',from:'',to:''}); const [page,setPage]=useState(1); const [loading,setLoading]=useState(true); const [error,setError]=useState(null);
  const load=()=>{setLoading(true);const qs=new URLSearchParams({page,pageSize:20,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v))});api('/settlements?'+qs).then(d=>{setItems(d.items);setPagination(d.pagination)}).catch(setError).finally(()=>setLoading(false))};
  useEffect(()=>{api('/meta').then(setMeta).catch(()=>{})},[]); useEffect(load,[page,filters]);
  const total=items.filter(i=>i.status==='ACTIVE').reduce((s,i)=>s+Number(i.total_amount),0);
  return <div><PageHeader eyebrow="UC008 / UC010" title="结算单" description="一次就诊最多一张有效结算单；作废后保留历史版本并允许重新生成。" actions={<div className="page-kpi"><span>本页有效金额</span><strong>{money(total)}</strong></div>}/>
  <Card className="filter-card"><div className="filters"><div className="search-field"><Search size={17}/><input value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value})} onKeyDown={e=>e.key==='Enter'&&load()} placeholder="结算单号、患者、就诊号"/></div><select value={filters.clinicId} onChange={e=>setFilters({...filters,clinicId:e.target.value})}><option value="">全部诊所</option>{meta?.clinics.map(c=><option key={c.clinic_id} value={c.clinic_id}>{c.clinic_no}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">全部状态</option><option value="ACTIVE">有效</option><option value="VOID">已作废</option></select><input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/><Button variant="secondary" onClick={load}>查询</Button></div></Card>
  {loading?<Loading/>:error?<ErrorState error={error} onRetry={load}/>:!items.length?<Card><Empty title="没有匹配的结算单"/></Card>:<Card><Table><thead><tr><th>结算单</th><th>患者 / 就诊</th><th>牙医 / 诊所</th><th>结算时间</th><th>金额</th><th>状态</th><th></th></tr></thead><tbody>{items.map(s=><tr key={s.settlement_id}><td><strong>{s.settlement_no}</strong><small className="block">版本 {s.version_no}</small></td><td>{s.patient_name}<small className="block">{s.visit_no} · {s.appointment_no}</small></td><td>{s.dentist_name}<small className="block">{s.clinic_no}</small></td><td>{dateTime(s.settlement_date)}</td><td className="money-cell">{money(s.total_amount)}</td><td><Badge value={s.status}/></td><td><Link className="text-link" to={'/settlements/'+s.settlement_id}><ReceiptText size={14}/> 查看</Link></td></tr>)}</tbody></Table><Pagination pagination={pagination} onChange={setPage}/></Card>}
  </div>;
}
