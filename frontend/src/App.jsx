import React, { useState, useEffect, useCallback } from 'react';
import { fetchWorkItems, fetchWorkItem, updateStatus, fetchHealth } from './api/client';
import { useWebSocket } from './hooks/useWebSocket';
import './App.css';

const PRIORITY_COLOR = { P0: '#ff2d55', P1: '#ff9500', P2: '#ffd60a', P3: '#30d158' };
const STATUS_COLOR   = { OPEN: '#ff2d55', INVESTIGATING: '#ff9500', RESOLVED: '#30d158', CLOSED: '#636366' };
const ROOT_CAUSE_OPTIONS = [
  'Infrastructure Failure', 'Network Partition', 'Memory Leak',
  'Disk I/O Saturation', 'Database Deadlock', 'Configuration Error',
  'Dependency Timeout', 'Code Defect', 'Capacity Exhaustion', 'Security Incident'
];

// ── Badge ──────────────────────────────────────────────────────────────────
const Badge = ({ label, color }) => (
  <span style={{
    background: color + '22', color, border: `1px solid ${color}55`,
    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontFamily: 'Space Mono, monospace',
    fontWeight: 700, letterSpacing: 1
  }}>{label}</span>
);

// ── Health Bar ─────────────────────────────────────────────────────────────
const HealthBar = ({ health }) => (
  <div className="health-bar">
    {health && Object.entries(health.db || {}).map(([k, v]) => (
      <span key={k} className="health-dot" style={{ color: v ? '#30d158' : '#ff2d55' }}>
        ● {k.toUpperCase()}
      </span>
    ))}
    {health && (
      <span className="health-metric">
        {health.metrics?.signalsPerSec || 0} sig/s
      </span>
    )}
  </div>
);

// ── RCA Form ───────────────────────────────────────────────────────────────
const RCAForm = ({ workItem, onSuccess, onCancel }) => {
  const [form, setForm] = useState({
    incident_start: workItem.start_time?.slice(0, 16) || '',
    incident_end:   new Date().toISOString().slice(0, 16),
    root_cause_category: '',
    fix_applied: '',
    prevention_steps: ''
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setError('');
    if (!form.root_cause_category) return setError('Select a root cause category');
    if (!form.fix_applied.trim())  return setError('Fix Applied is required');
    if (!form.prevention_steps.trim()) return setError('Prevention Steps are required');

    setLoading(true);
    try {
      await updateStatus(workItem.id, {
        status: 'CLOSED',
        rca: {
          ...form,
          incident_start: new Date(form.incident_start).toISOString(),
          incident_end:   new Date(form.incident_end).toISOString()
        }
      });
      onSuccess();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to submit RCA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rca-form">
      <h3 className="rca-title">📋 Root Cause Analysis</h3>
      <p className="rca-subtitle">Required to close incident {workItem.id?.slice(0,8)}...</p>

      <div className="form-row">
        <div className="form-group">
          <label>Incident Start</label>
          <input type="datetime-local" value={form.incident_start}
            onChange={e => set('incident_start', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Incident End</label>
          <input type="datetime-local" value={form.incident_end}
            onChange={e => set('incident_end', e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>Root Cause Category</label>
        <select value={form.root_cause_category} onChange={e => set('root_cause_category', e.target.value)}>
          <option value="">— Select category —</option>
          {ROOT_CAUSE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label>Fix Applied</label>
        <textarea rows={3} placeholder="Describe the fix that resolved the incident..."
          value={form.fix_applied} onChange={e => set('fix_applied', e.target.value)} />
      </div>

      <div className="form-group">
        <label>Prevention Steps</label>
        <textarea rows={3} placeholder="Steps to prevent recurrence..."
          value={form.prevention_steps} onChange={e => set('prevention_steps', e.target.value)} />
      </div>

      {error && <div className="error-msg">⚠ {error}</div>}

      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={loading}>
          {loading ? 'Submitting…' : 'Submit & Close Incident'}
        </button>
      </div>
    </div>
  );
};

// ── Incident Detail Panel ──────────────────────────────────────────────────
const IncidentDetail = ({ id, onClose, onRefresh }) => {
  const [detail,  setDetail]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRCA, setShowRCA] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    fetchWorkItem(id).then(d => { setDetail(d); setLoading(false); });
  }, [id]);

  const transition = async (status) => {
    setStatusLoading(true);
    try {
      await updateStatus(id, { status });
      const updated = await fetchWorkItem(id);
      setDetail(updated);
      onRefresh();
    } catch (e) {
      alert(e.response?.data?.error || 'Transition failed');
    } finally {
      setStatusLoading(false);
    }
  };

  if (loading) return <div className="detail-panel loading">Loading...</div>;
  if (!detail) return null;

  const nextActions = {
    OPEN:          [{ label: '▶ Investigate', status: 'INVESTIGATING', cls: 'btn-warn' }],
    INVESTIGATING: [{ label: '✓ Mark Resolved', status: 'RESOLVED', cls: 'btn-success' }],
    RESOLVED:      [{ label: '🔒 Close with RCA', status: 'CLOSED', cls: 'btn-primary', action: () => setShowRCA(true) }],
    CLOSED:        []
  };

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div>
          <div className="detail-component">{detail.component_id}</div>
          <div className="detail-meta">
            <Badge label={detail.priority} color={PRIORITY_COLOR[detail.priority]} />
            <Badge label={detail.status}   color={STATUS_COLOR[detail.status]} />
            <span className="signal-count">⚡ {detail.signal_count} signals</span>
          </div>
        </div>
        <button className="btn-close" onClick={onClose}>✕</button>
      </div>

      {showRCA ? (
        <RCAForm workItem={detail}
          onSuccess={() => { setShowRCA(false); fetchWorkItem(id).then(setDetail); onRefresh(); }}
          onCancel={() => setShowRCA(false)} />
      ) : (
        <>
          {/* Action Buttons */}
          <div className="action-row">
            {(nextActions[detail.status] || []).map(a => (
              <button key={a.status} className={a.cls}
                disabled={statusLoading}
                onClick={a.action || (() => transition(a.status))}>
                {a.label}
              </button>
            ))}
          </div>

          {/* RCA summary if closed */}
          {detail.rca && (
            <div className="rca-summary">
              <div className="rca-summary-title">✅ RCA Summary</div>
              <div className="rca-row"><span>Category:</span> {detail.rca.root_cause_category}</div>
              <div className="rca-row"><span>MTTR:</span> {Math.round(detail.rca.mttr_seconds / 60)} minutes</div>
              <div className="rca-row"><span>Fix:</span> {detail.rca.fix_applied}</div>
              <div className="rca-row"><span>Prevention:</span> {detail.rca.prevention_steps}</div>
            </div>
          )}

          {/* Raw signals */}
          <div className="signals-section">
            <div className="signals-title">Raw Signals ({detail.signals?.length || 0})</div>
            <div className="signals-list">
              {(detail.signals || []).slice(0, 50).map(s => (
                <div key={s.signal_id} className="signal-row">
                  <Badge label={s.severity} color={PRIORITY_COLOR[s.severity] || '#888'} />
                  <span className="signal-msg">{s.message}</span>
                  <span className="signal-time">{new Date(s.received_at).toLocaleTimeString()}</span>
                </div>
              ))}
              {!detail.signals?.length && <div className="no-signals">No raw signals yet</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [workItems,   setWorkItems]   = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [health,      setHealth]      = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [filter,      setFilter]      = useState('ALL');

  const loadWorkItems = useCallback(() => {
    fetchWorkItems().then(setWorkItems).catch(() => {});
  }, []);

  useEffect(() => {
    loadWorkItems();
    fetchHealth().then(setHealth).catch(() => {});
    const hInterval = setInterval(() => fetchHealth().then(setHealth).catch(() => {}), 5000);
    return () => clearInterval(hInterval);
  }, [loadWorkItems]);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'WORKITEMS_UPDATE') setWorkItems(msg.data);
  }, []);

  const connected = useWebSocket(handleWsMessage);

  useEffect(() => { setWsConnected(connected); }, [connected]);

  const filtered = filter === 'ALL'
    ? workItems
    : workItems.filter(w => w.status === filter || w.priority === filter);

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo">IMS</div>
          <div className="logo-sub">Incident Management System</div>
        </div>
        <div className="header-right">
          <HealthBar health={health} />
          <span className={`ws-indicator ${wsConnected ? 'live' : 'dead'}`}>
            {wsConnected ? '● LIVE' : '○ CONNECTING'}
          </span>
        </div>
      </header>

      <div className="app-body">
        {/* Sidebar: incident list */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Active Incidents</span>
            <span className="incident-count">{workItems.length}</span>
          </div>

          {/* Filter bar */}
          <div className="filter-bar">
            {['ALL','OPEN','INVESTIGATING','RESOLVED','P0','P1'].map(f => (
              <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>

          <div className="incident-list">
            {filtered.length === 0 && (
              <div className="empty-state">No incidents match filter</div>
            )}
            {filtered.map(wi => (
              <div key={wi.id}
                className={`incident-card ${selectedId === wi.id ? 'selected' : ''} priority-${wi.priority}`}
                onClick={() => setSelectedId(wi.id)}>
                <div className="card-top">
                  <span className="card-component">{wi.component_id}</span>
                  <Badge label={wi.priority} color={PRIORITY_COLOR[wi.priority]} />
                </div>
                <div className="card-bottom">
                  <Badge label={wi.status} color={STATUS_COLOR[wi.status]} />
                  <span className="card-signals">⚡ {wi.signal_count}</span>
                  <span className="card-time">{new Date(wi.updated_at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main content */}
        <main className="main-content">
          {selectedId ? (
            <IncidentDetail
              id={selectedId}
              onClose={() => setSelectedId(null)}
              onRefresh={loadWorkItems}
            />
          ) : (
            <div className="empty-main">
              <div className="empty-icon">⚡</div>
              <div className="empty-title">Select an incident</div>
              <div className="empty-sub">Click any incident from the left panel to view details, manage status, and submit RCA</div>

              {/* Stats overview */}
              <div className="stats-grid">
                {['P0','P1','P2','P3'].map(p => (
                  <div key={p} className="stat-card" style={{ borderColor: PRIORITY_COLOR[p] + '44' }}>
                    <div className="stat-num" style={{ color: PRIORITY_COLOR[p] }}>
                      {workItems.filter(w => w.priority === p).length}
                    </div>
                    <div className="stat-label">{p} Incidents</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
