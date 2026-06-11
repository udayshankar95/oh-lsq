import { useEffect, useState, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../../api/client';
import { Lead, LeadState, AgentStat } from '../../types';

const OMS_BASE = 'https://oms.orangehealth.in/request';
const maskPhone = (p: string | undefined | null) => p ? '••••• ' + p.slice(-4) : '—';

const STATE_BADGE: Record<LeadState, { bg: string; text: string; label: string }> = {
  NEW:                { bg: 'bg-gray-100',  text: 'text-gray-500',  label: 'New' },
  ATTEMPTING:         { bg: 'bg-orange-50', text: 'text-[#E8762C]', label: 'Attempting' },
  CONNECTED:          { bg: 'bg-blue-50',   text: 'text-blue-600',  label: 'Connected' },
  SCHEDULED:          { bg: 'bg-green-50',  text: 'text-green-600', label: 'Scheduled' },
  CALLBACK_SCHEDULED: { bg: 'bg-gray-100',  text: 'text-gray-600',  label: 'Callback Due' },
  UNREACHABLE:        { bg: 'bg-red-50',    text: 'text-red-500',   label: 'Unreachable' },
  CANCELLED:          { bg: 'bg-gray-50',   text: 'text-gray-400',  label: 'Cancelled' },
  SYSTEM_DUPLICATE:   { bg: 'bg-gray-100',  text: 'text-gray-400',  label: 'Duplicate' },
};

const SOURCE_BADGE: Record<string, string> = {
  B2C_OMT:  'bg-blue-50 text-blue-600',
  D2C:      'bg-purple-50 text-purple-600',
  D2C_CHAT: 'bg-teal-50 text-teal-600',
};

const CHIPS = [
  { id: 'all',         label: 'All',          stateFilter: '',                     attemptFilter: undefined },
  { id: 'open',        label: 'Open',         stateFilter: 'NEW',                  attemptFilter: undefined },
  { id: 'attempt1',    label: '1st Call',     stateFilter: 'ATTEMPTING',           attemptFilter: 0 },
  { id: 'attempt2',    label: '2nd Call',     stateFilter: 'ATTEMPTING',           attemptFilter: 1 },
  { id: 'attempt3',    label: '3rd Call',     stateFilter: 'ATTEMPTING',           attemptFilter: 2 },
  { id: 'unpaid',      label: 'Unpaid',       stateFilter: 'CONNECTED',            attemptFilter: undefined },
  { id: 'followup',    label: 'Follow-ups',   stateFilter: 'CALLBACK_SCHEDULED',   attemptFilter: undefined },
  { id: 'scheduled',   label: 'Scheduled',    stateFilter: 'SCHEDULED',            attemptFilter: undefined },
  { id: 'unreachable', label: 'Unreachable',  stateFilter: 'UNREACHABLE',          attemptFilter: undefined },
];

export default function LeadManagement() {
  const [leads, setLeads]             = useState<Lead[]>([]);
  const [agents, setAgents]           = useState<AgentStat[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [activeChip, setActiveChip]   = useState('all');
  const [page, setPage]               = useState(1);
  const [total, setTotal]             = useState(0);
  const [reassignLeadId, setReassignLeadId] = useState<number | null>(null);
  const [reassignAgentId, setReassignAgentId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const LIMIT = 20;

  const chip = CHIPS.find(c => c.id === activeChip)!;

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (chip.stateFilter) params.set('state', chip.stateFilter);
      if (chip.attemptFilter !== undefined) params.set('attempt_count', String(chip.attemptFilter));
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      const res = await api.get(`/leads?${params}`);
      setLeads(res.data.data);
      setTotal(res.data.pagination.total);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search, activeChip, page]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { api.get('/manager/agents').then(res => setAgents(res.data)); }, []);

  const handleReassign = async () => {
    if (!reassignLeadId || !reassignAgentId) return;
    setReassigning(true);
    try {
      await api.post(`/manager/leads/${reassignLeadId}/reassign`, { agent_id: parseInt(reassignAgentId) });
      setReassignLeadId(null); setReassignAgentId('');
      fetchLeads();
    } catch (e) { console.error(e); }
    finally { setReassigning(false); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-base font-bold text-gray-900">Lead Management</h1>
          <p className="text-xs text-gray-400 mt-0.5">{total} leads</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input type="text" placeholder="Search patient, phone, request ID..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 outline-none focus:border-[#E8762C] bg-white text-gray-900 placeholder-gray-400 transition-colors"
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {CHIPS.map(c => (
          <button key={c.id} onClick={() => { setActiveChip(c.id); setPage(1); }}
            className={`px-3 py-1 text-xs font-medium border transition-colors ${
              activeChip === c.id
                ? 'bg-[#E8762C] text-white border-[#E8762C]'
                : 'bg-white text-gray-500 border-gray-200 hover:border-[#E8762C] hover:text-[#E8762C]'
            }`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Patient</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Request</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Doctor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Attempts</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Agent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Created</th>
                <th/>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">Loading…</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">No leads found</td></tr>
              ) : leads.map(lead => {
                const badge = STATE_BADGE[lead.state] || STATE_BADGE.NEW;
                const src = (lead as any).lead_source as string || 'B2C_OMT';
                return (
                  <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{lead.patient_name}</p>
                      <p className="text-xs text-gray-400 font-mono">{maskPhone(lead.patient_phone)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <a href={`${OMS_BASE}/${lead.request_id}`} target="_blank" rel="noopener noreferrer"
                        className="text-[#E8762C] font-mono text-xs hover:underline flex items-center gap-1">
                        {lead.request_id}
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                        </svg>
                      </a>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {lead.order_value ? <span className="text-xs text-gray-400">₹{Number(lead.order_value).toLocaleString()}</span> : null}
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 ${SOURCE_BADGE[src] || SOURCE_BADGE.B2C_OMT}`}>{src.replace(/_/g, ' ')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-700">{lead.doctor_name}</p>
                      <p className="text-xs text-gray-400">{lead.partner_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {Array.from({ length: lead.max_attempts || 3 }).map((_, i) => (
                          <div key={i} className={`w-2 h-2 rounded-full ${i < (lead.attempt_count || 0) ? 'bg-[#E8762C]' : 'bg-gray-200'}`}/>
                        ))}
                        <span className="text-xs text-gray-400 ml-1">{lead.attempt_count}/{lead.max_attempts || 3}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {lead.assigned_agent || <span className="text-gray-300">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {format(parseISO(lead.created_at), 'MMM d, h:mm a')}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => { setReassignLeadId(lead.id); setReassignAgentId(''); }}
                        className="text-xs text-[#E8762C] hover:underline font-medium">Reassign</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">Showing {((page-1)*LIMIT)+1}–{Math.min(page*LIMIT,total)} of {total}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                className="px-3 py-1 text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50 text-gray-700">Previous</button>
              <button onClick={() => setPage(p => p+1)} disabled={page*LIMIT>=total}
                className="px-3 py-1 text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50 text-gray-700">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Reassign modal */}
      {reassignLeadId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Reassign Lead</h3>
            <select value={reassignAgentId} onChange={e => setReassignAgentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 mb-4 outline-none focus:border-[#E8762C] bg-white text-gray-900">
              <option value="">Select agent…</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name} {a.is_punched_in ? '● Active' : '○ Offline'}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setReassignLeadId(null)}
                className="flex-1 px-4 py-2 text-sm border border-gray-200 hover:bg-gray-50 text-gray-700">Cancel</button>
              <button onClick={handleReassign} disabled={!reassignAgentId || reassigning}
                className="flex-1 px-4 py-2 text-sm font-semibold bg-[#E8762C] text-white hover:bg-[#d4692a] disabled:opacity-50 transition-colors">
                {reassigning ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
