import { useEffect, useState, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../../api/client';
import { Lead, LeadState, AgentStat } from '../../types';

const OMS_BASE = 'https://oms.orangehealth.in/request';

const STATE_BADGE: Record<LeadState, string> = {
  NEW: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  ATTEMPTING: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  CONNECTED: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  SCHEDULED: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  CALLBACK_SCHEDULED: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800',
  UNREACHABLE: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  CANCELLED: 'bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700',
};

const ALL_STATES: LeadState[] = ['NEW', 'ATTEMPTING', 'CONNECTED', 'SCHEDULED', 'CALLBACK_SCHEDULED', 'UNREACHABLE', 'CANCELLED'];

export default function LeadManagement() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [agents, setAgents] = useState<AgentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reassignLeadId, setReassignLeadId] = useState<number | null>(null);
  const [reassignAgentId, setReassignAgentId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const LIMIT = 20;

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (stateFilter) params.set('state', stateFilter);
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      const res = await api.get(`/leads?${params}`);
      setLeads(res.data.data);
      setTotal(res.data.pagination.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, stateFilter, page]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  useEffect(() => {
    api.get('/manager/agents').then(res => setAgents(res.data));
  }, []);

  const handleReassign = async () => {
    if (!reassignLeadId || !reassignAgentId) return;
    setReassigning(true);
    try {
      await api.post(`/manager/leads/${reassignLeadId}/reassign`, { agent_id: parseInt(reassignAgentId) });
      setReassignLeadId(null);
      setReassignAgentId('');
      fetchLeads();
    } catch (e) {
      console.error(e);
    } finally {
      setReassigning(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Lead Management</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">{total} leads total</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="text"
            placeholder="Search patient, phone, request ID..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-base bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>
        <select
          value={stateFilter}
          onChange={e => { setStateFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:border-brand-500 transition-base bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">All States</option>
          {ALL_STATES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Patient</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Request</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Doctor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">State</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Attempts</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Agent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Created</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Loading...</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">No leads found</td></tr>
              ) : leads.map(lead => (
                <tr key={lead.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-base">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-white">{lead.patient_name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{lead.patient_phone}</p>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`${OMS_BASE}/${lead.request_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 dark:text-brand-400 font-mono text-xs hover:underline flex items-center gap-1"
                    >
                      {lead.request_id}
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                      </svg>
                    </a>
                    {lead.order_value ? <p className="text-xs text-gray-400 dark:text-gray-500">&#8377;{lead.order_value.toLocaleString()}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-gray-700 dark:text-gray-300">{lead.doctor_name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{lead.partner_name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATE_BADGE[lead.state]}`}>
                      {lead.state.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: lead.max_attempts || 3 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full ${i < (lead.attempt_count || 0) ? 'bg-brand-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                        />
                      ))}
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">{lead.attempt_count}/{lead.max_attempts || 3}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {lead.assigned_agent || <span className="text-gray-300 dark:text-gray-600">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500">
                    {format(parseISO(lead.created_at), 'MMM d, h:mm a')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { setReassignLeadId(lead.id); setReassignAgentId(''); }}
                      className="text-xs text-brand-600 dark:text-brand-400 hover:underline font-medium"
                    >
                      Reassign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
            <p className="text-xs text-gray-400 dark:text-gray-500">Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-base"
              >Previous</button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * LIMIT >= total}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-base"
              >Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Reassign modal */}
      {reassignLeadId && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Reassign Lead</h3>
            <select
              value={reassignAgentId}
              onChange={e => setReassignAgentId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg mb-4 outline-none focus:border-brand-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="">Select agent...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.is_punched_in ? '● Active' : '○ Offline'}
                </option>
              ))}
            </select>
            <div className="flex gap-3">
              <button
                onClick={() => setReassignLeadId(null)}
                className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-base"
              >Cancel</button>
              <button
                onClick={handleReassign}
                disabled={!reassignAgentId || reassigning}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-base"
              >{reassigning ? 'Reassigning...' : 'Reassign'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
