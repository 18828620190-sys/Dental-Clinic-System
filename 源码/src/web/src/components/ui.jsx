import React from 'react';
import { X, Loader2, Inbox } from 'lucide-react';
import { statusText, statusTone } from '../lib/api.js';

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  return <button className={'btn btn-' + variant + ' btn-' + size + ' ' + className} {...props}>{children}</button>;
}

export function Badge({ value, children, tone }) {
  return <span className={'badge badge-' + (tone || statusTone(value))}>{children || statusText[value] || value || '—'}</span>;
}

export function Card({ children, className = '', ...props }) {
  return <section className={'card ' + className} {...props}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="page-header">
    <div>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function Modal({ title, children, onClose, wide = false, footer }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div className={'modal ' + (wide ? 'modal-wide' : '')}>
      <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>;
}

export function Field({ label, hint, required, children, className = '' }) {
  return <label className={'field ' + className}><span>{label}{required && <em>*</em>}{hint && <small>{hint}</small>}</span>{children}</label>;
}

export function FormGrid({ children, columns = 2 }) {
  return <div className="form-grid" style={{ '--cols': columns }}>{children}</div>;
}

export function Loading({ label = '正在加载数据…' }) {
  return <div className="state-block"><Loader2 className="spin" size={24} /><span>{label}</span></div>;
}

export function Empty({ title = '暂无数据', description }) {
  return <div className="state-block"><Inbox size={28} /><strong>{title}</strong>{description && <span>{description}</span>}</div>;
}

export function ErrorState({ error, onRetry }) {
  return <div className="state-block state-error"><strong>加载失败</strong><span>{error?.message || String(error)}</span>{onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>重试</Button>}</div>;
}

export function Pagination({ pagination, onChange }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return <div className="pagination">
    <span>共 {pagination.total} 条，第 {pagination.page} / {pagination.totalPages} 页</span>
    <div><Button size="sm" variant="ghost" disabled={pagination.page <= 1} onClick={() => onChange(pagination.page - 1)}>上一页</Button><Button size="sm" variant="ghost" disabled={pagination.page >= pagination.totalPages} onClick={() => onChange(pagination.page + 1)}>下一页</Button></div>
  </div>;
}

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs">{tabs.map((tab) => <button key={tab.value} className={value === tab.value ? 'active' : ''} onClick={() => onChange(tab.value)}>{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}</button>)}</div>;
}

export function Table({ children, className = '' }) {
  return <div className={'table-wrap ' + className}><table>{children}</table></div>;
}
