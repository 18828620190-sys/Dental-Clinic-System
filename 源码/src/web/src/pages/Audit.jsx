import React, { useEffect, useState } from 'react';
import { api, dateTime } from '../lib/api.js';
import { Badge, Card, Empty, ErrorState, Loading, PageHeader, Pagination, Table } from '../components/ui.jsx';

export default function Audit(){
  const [items,setItems]=useState([]); const [pagination,setPagination]=useState(null); const [page,setPage]=useState(1); const [actionType,setActionType]=useState(''); const [loading,setLoading]=useState(true); const [error,setError]=useState(null);
  const load=()=>{setLoading(true);api('/audit?page='+page+'&pageSize=30&actionType='+actionType).then(d=>{setItems(d.items);setPagination(d.pagination)}).catch(setError).finally(()=>setLoading(false))}; useEffect(load,[page,actionType]);
  return <div><PageHeader eyebrow="AUDITABILITY" title="审计日志" description="关键业务变更、查询、导出与登录行为均以追加方式记录。" />
  <Card className="filter-card"><div className="filters"><select value={actionType} onChange={e=>{setPage(1);setActionType(e.target.value)}}><option value="">全部动作</option>{['CREATE','UPDATE','CANCEL','RESCHEDULE','ATTEND','NO_SHOW','CREATE_SCHEDULE','VERIFY_COST','REJECT_COST','CREATE_SETTLEMENT','VOID_SETTLEMENT','REGENERATE_SETTLEMENT','CONFIRM_PERFORMANCE_SNAPSHOT','QUERY','EXPORT','LOGIN'].map(a=><option key={a} value={a}>{a}</option>)}</select></div></Card>
  {loading?<Loading/>:error?<ErrorState error={error} onRetry={load}/>:!items.length?<Card><Empty title="暂无审计记录"/></Card>:<Card><Table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>状态变化</th><th>原因 / 详情</th></tr></thead><tbody>{items.map(log=><tr key={log.log_id}><td>{dateTime(log.occurred_at)}</td><td>{log.actor_name||'系统'}<small className="block">{log.role_code||''}</small></td><td><Badge tone="blue">{log.action_type}</Badge></td><td>{log.entity_type}<small className="block">#{log.entity_id||'—'}</small></td><td>{log.before_status||'—'} → {log.after_status||'—'}</td><td className="truncate-cell" title={JSON.stringify(log.details_json)}>{log.reason||JSON.stringify(log.details_json)||'—'}</td></tr>)}</tbody></Table><Pagination pagination={pagination} onChange={setPage}/></Card>}
  </div>;
}
