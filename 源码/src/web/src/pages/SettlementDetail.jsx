import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Printer, RefreshCcw } from 'lucide-react';
import { api, dateTime, money } from '../lib/api.js';
import { useApp } from '../components/AppContext.jsx';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, Table } from '../components/ui.jsx';

export default function SettlementDetail(){
  const {id}=useParams(); const {notify}=useApp(); const [data,setData]=useState(null); const [error,setError]=useState(null);
  const load=()=>api('/settlements/'+id).then(setData).catch(setError); useEffect(load,[id]);
  if(error)return <ErrorState error={error} onRetry={load}/>; if(!data)return <Loading/>;
  const s=data.settlement; const active=data.versions.find(v=>v.status==='ACTIVE');
  const voidIt=async()=>{const reason=window.prompt('请输入作废原因，作废后历史版本仍会保留');if(!reason)return;try{await api('/settlements/'+id+'/void',{method:'POST',body:{reason}});notify('结算单已作废');load()}catch(e){notify(e.message,'error')}};
  const regenerate=async()=>{try{const r=await api('/settlements/visits/'+s.visit_id,{method:'POST',body:{}});notify('已重新生成结算单');window.location.href='/settlements/'+r.settlementId}catch(e){notify(e.message,'error')}};
  return <div><div className="back-line"><Link to="/settlements"><ArrowLeft size={15}/> 返回结算列表</Link></div><PageHeader eyebrow={s.settlement_no} title="结算单详情" description={s.patient_name+' · '+s.clinic_no+' · '+s.dentist_name} actions={<div className="page-actions"><Button variant="secondary" onClick={()=>window.print()}><Printer size={15}/>打印</Button>{s.status==='ACTIVE'&&<Button variant="danger" onClick={voidIt}><Ban size={15}/>作废</Button>}{!active&&<Button onClick={regenerate}><RefreshCcw size={15}/>重新生成</Button>}</div>}/>
  <div className="invoice-grid"><Card className="invoice"><div className="invoice-head"><div><div className="eyebrow">ADC 牙科连锁</div><h2>诊疗结算单</h2><span>{s.settlement_no} · 版本 {s.version_no}</span></div><Badge value={s.status}/></div><div className="invoice-meta"><div><span>患者</span><strong>{s.patient_name}</strong><small>{s.patient_no}</small></div><div><span>就诊</span><strong>{s.visit_no}</strong><small>{s.appointment_no}</small></div><div><span>诊所</span><strong>{s.clinic_no}</strong><small>{s.postal_address}</small></div><div><span>结算时间</span><strong>{dateTime(s.settlement_date)}</strong><small>生成人：{s.generated_by_name}</small></div></div><Table><thead><tr><th>治疗项目</th><th>数量</th><th>单位价格</th><th>小计</th></tr></thead><tbody>{data.details.map(d=><tr key={d.settlement_detail_id}><td>{d.treatment_name_snapshot}</td><td>{d.unit_quantity_snapshot}</td><td>{money(d.unit_price_snapshot)}</td><td>{money(d.subtotal)}</td></tr>)}</tbody></Table><div className="invoice-total"><span>结算总额</span><strong>{money(s.total_amount)}</strong></div>{s.status==='VOID'&&<div className="void-stamp">已作废<br/><small>{s.void_reason}</small></div>}</Card><Card><div className="card-head"><div><h2>版本历史</h2><p>作废与重新生成均保留快照</p></div></div>{data.versions.length?<div className="version-list">{data.versions.map(v=><div key={v.settlement_id} className={v.status==='ACTIVE'?'active':''}><div><strong>版本 {v.version_no}</strong><span>{v.settlement_no}</span></div><div><Badge value={v.status}/><b>{money(v.total_amount)}</b></div><small>{dateTime(v.activated_at)}{v.voided_at?' · 作废于 '+dateTime(v.voided_at):''}</small></div>)}</div>:<Empty/>}</Card></div>
  </div>;
}
