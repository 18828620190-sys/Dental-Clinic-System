import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, UserRound } from 'lucide-react';
import { api, dateOnly } from '../lib/api.js';
import { useApp } from '../components/AppContext.jsx';
import { Badge, Button, Card, Empty, ErrorState, Field, FormGrid, Loading, Modal, PageHeader, Pagination, Table } from '../components/ui.jsx';

const emptyForm = { patientName:'', birthDate:'', billingAddress:'', phone:'', email:'', emergencyContactName:'', emergencyContactPhone:'', clinicId:'', allergyName:'', allergyNote:'', allergyStatus:'PENDING' };

export default function Patients() {
  const { user, notify } = useApp();
  const [items,setItems]=useState([]); const [pagination,setPagination]=useState(null); const [meta,setMeta]=useState(null);
  const [search,setSearch]=useState(''); const [status,setStatus]=useState(''); const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(true); const [error,setError]=useState(null);
  const [showCreate,setShowCreate]=useState(false); const [form,setForm]=useState(emptyForm);
  const [duplicates,setDuplicates]=useState(null); const [confirmDuplicate,setConfirmDuplicate]=useState(false);
  const [saving,setSaving]=useState(false); const canWrite=['FRONT_DESK','CLINIC_MANAGER','HQ_MANAGER'].includes(user.role);

  const load=()=>{ setLoading(true); setError(null); api('/patients?page='+page+'&pageSize=20&q='+encodeURIComponent(search)+'&status='+status).then(d=>{setItems(d.items);setPagination(d.pagination)}).catch(setError).finally(()=>setLoading(false)); };
  useEffect(load,[page,status]);
  useEffect(()=>{api('/meta').then(setMeta).catch(()=>{})},[]);
  const submitSearch=(e)=>{e.preventDefault();setPage(1);load();};
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const create=async(e)=>{ e.preventDefault(); setSaving(true); setError(null);
    try {
      const data=await api('/patients',{method:'POST',body:{patientName:form.patientName,birthDate:form.birthDate,billingAddress:form.billingAddress,phone:form.phone,email:form.email||null,emergencyContactName:form.emergencyContactName,emergencyContactPhone:form.emergencyContactPhone,clinicId:form.clinicId?Number(form.clinicId):null,confirmDuplicate,allergies:form.allergyName?[{allergyName:form.allergyName,note:form.allergyNote||null,confirmationStatus:form.allergyStatus}]:[]}});
      notify('患者档案已创建'); setShowCreate(false); setForm(emptyForm); setDuplicates(null); setConfirmDuplicate(false); load();
      window.location.href='/patients/'+data.patientId;
    } catch(err) { if(err.code==='CONFLICT'&&err.details?.duplicates){setDuplicates(err.details.duplicates);notify('发现疑似重复患者，请核实','warning')} else notify(err.message,'error'); }
    finally{setSaving(false);}
  };
  return <div>
    <PageHeader eyebrow="UC001 · PATIENT MASTER" title="患者档案" description="全连锁共享同一份患者主档案，过敏信息在接诊时显著提示。" actions={canWrite&&<Button onClick={()=>setShowCreate(true)}><Plus size={16}/>新建患者</Button>} />
    <Card className="filter-card"><form className="filters" onSubmit={submitSearch}><div className="search-field"><Search size={17}/><input placeholder="姓名、电话或患者编号" value={search} onChange={e=>setSearch(e.target.value)}/></div><select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">全部状态</option><option value="ACTIVE">有效</option><option value="INACTIVE">停用</option></select><Button type="submit" variant="secondary">查询</Button></form></Card>
    {loading?<Loading/>:error?<ErrorState error={error} onRetry={load}/>:!items.length?<Card><Empty title="没有匹配的患者" description="尝试调整姓名、电话或状态条件。"/></Card>:<Card><Table><thead><tr><th>患者</th><th>出生日期</th><th>联系方式</th><th>过敏项</th><th>预约 / 就诊</th><th>状态</th><th></th></tr></thead><tbody>{items.map(p=><tr key={p.patient_id}><td><div className="person-cell"><div className="avatar soft"><UserRound size={16}/></div><div><Link to={'/patients/'+p.patient_id}>{p.patient_name}</Link><small>{p.patient_no}</small></div></div></td><td>{dateOnly(p.birth_date)}</td><td>{p.phone}<small className="block">{p.email||'未登记邮箱'}</small></td><td>{Number(p.allergy_count)?<Badge tone="amber">{p.allergy_count} 项</Badge>:<span className="muted">无记录</span>}</td><td>{p.appointment_count} / {p.visit_count}</td><td><Badge value={p.status}/></td><td><Link className="text-link" to={'/patients/'+p.patient_id}>查看档案</Link></td></tr>)}</tbody></Table><Pagination pagination={pagination} onChange={setPage}/></Card>}
    {showCreate&&<Modal title="新建患者档案" wide onClose={()=>{setShowCreate(false);setDuplicates(null);setConfirmDuplicate(false)}} footer={<><Button variant="ghost" onClick={()=>setShowCreate(false)}>取消</Button><Button onClick={create} disabled={saving}>{saving?'保存中…':'保存患者'}</Button></>}>
      <form id="patient-form" onSubmit={create}><FormGrid columns={2}>
        <Field label="患者姓名" required><input value={form.patientName} onChange={e=>set('patientName',e.target.value)} required/></Field>
        <Field label="出生日期" required><input type="date" value={form.birthDate} onChange={e=>set('birthDate',e.target.value)} required/></Field>
        <Field label="联系电话" required><input value={form.phone} onChange={e=>set('phone',e.target.value)} required/></Field>
        <Field label="电子邮箱"><input type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></Field>
        <Field label="账单地址" required className="span-2"><input value={form.billingAddress} onChange={e=>set('billingAddress',e.target.value)} required/></Field>
        <Field label="紧急联系人" required><input value={form.emergencyContactName} onChange={e=>set('emergencyContactName',e.target.value)} required/></Field>
        <Field label="紧急联系电话" required><input value={form.emergencyContactPhone} onChange={e=>set('emergencyContactPhone',e.target.value)} required/></Field>
        <Field label="首次就诊诊所" hint="建立患者与诊所的就诊关系"><select value={form.clinicId} onChange={e=>set('clinicId',e.target.value)}><option value="">暂不关联</option>{meta?.clinics.map(c=><option key={c.clinic_id} value={c.clinic_id}>{c.clinic_no} · {c.postal_address}</option>)}</select></Field>
        <Field label="过敏项名称" hint="可稍后在档案中逐项维护"><input value={form.allergyName} onChange={e=>set('allergyName',e.target.value)}/></Field>
        <Field label="过敏备注"><input value={form.allergyNote} onChange={e=>set('allergyNote',e.target.value)}/></Field>
        <Field label="确认状态"><select value={form.allergyStatus} onChange={e=>set('allergyStatus',e.target.value)}><option value="PENDING">待确认</option><option value="CONFIRMED">已确认</option></select></Field>
      </FormGrid>{duplicates&&<div className="warning-box"><strong>发现疑似重复档案</strong>{duplicates.map(d=><span key={d.patient_id}>{d.patient_name} · {d.patient_no} · {d.phone}</span>)}<label className="check-line"><input type="checkbox" checked={confirmDuplicate} onChange={e=>setConfirmDuplicate(e.target.checked)}/> 已核实，这确实是另一位患者</label></div>}</form>
    </Modal>}
  </div>;
}
