import { useEffect, useState } from 'react';
import api from '../../api/client';
import { DashboardMetrics } from '../../types';

const STATE_COLORS: Record<string, string> = {
  NEW: 'bg-gray-300 dark:bg-gray-600',
  ATTEMPTING: 'bg-amber-400',
  CONNECTED: 'bg-blue-400',
  SCHEDULED: 'bg-green-400',
  CALLBACK_SCHEDULED: 'bg-purple-400',
  UNREACHABLE: 'bg-red-400',
  CANCELLED: 'bg-gray-300 dark:bg-gray-600',
};

const STATE_TEXT: Record<string, string> = {
  NEW: 'text-gray-600 dark:text-gray-400',
  ATTEMPTING: 'text-amber-700 dark:text-amber-400',
  CONNECTED: 'text-blue-700 dark:text-blue-400',
  SCHEDULED: 'text-green-700 dark:text-green-400',
  CALLBACK_SCHEDULED: 'text-purple-700 dark:text-purple-400',
  UNREACHABLE: 'text-red-700 dark:text-red-400',
  CANCELLED: 'text-gray-500 dark:text-gray-500',
};

function StatCard({ label, value, sub, alert }: { label: string; value: number | string; sub?: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 shadow-xs ${
      alert
        ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
    }`}>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${alert ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>{label}</p>
      <p className={`text-3xl font-bold ${alert ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function ManagerDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = async () => {
    try {
      const res = await api.get('/manager/dashboard');
      setMetrics(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <svg className="animate-spin w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      </div>
    );
  }

  if (!metrics) return null;

  const conversionRate = metrics.calls.today > 0
    ? ((metrics.calls.conversions / metrics.calls.today) * 100).toFixed(1)
    : '0.0';

  const connectionRate = metrics.calls.today > 0
    ? ((metrics.calls.connections / metrics.calls.today) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">Real-time operational overview</p>
        </div>
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-base"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Refresh
        </button>
      </div>

      {(metrics.queue.overdue_callbacks > 0 || metrics.queue.waiting_over_24h > 0) && (
        <div className="mb-5 flex flex-wrap gap-3">
          {metrics.queue.overdue_callbacks > 0 && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm font-medium px-4 py-2.5 rounded-lg">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/>
              {metrics.queue.overdue_callbacks} overdue callback{metrics.queue.overdue_callbacks !== 1 ? 's' : ''}
            </div>
          )}
          {metrics.queue.waiting_over_24h > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm font-medium px-4 py-2.5 rounded-lg">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>
              {metrics.queue.waiting_over_24h} lead{metrics.queue.waiting_over_24h !== 1 ? 's' : ''} waiting &gt;24h
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Leads" value={metrics.leads.active} sub={`${metrics.leads.total} total`} />
        <StatCard label="Scheduled Today" value={metrics.leads.scheduled_today} sub="Conversions" />
        <StatCard label="Calls Today" value={metrics.calls.today} sub={`${connectionRate}% connection rate`} />
        <StatCard label="Conversion Rate" value={`${conversionRate}%`} sub={`${metrics.calls.conversions} scheduled`} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Agents Active" value={metrics.agents.active} sub="Punched in now" />
        <StatCard label="Queue Pending" value={metrics.queue.pending} sub="Awaiting assignment" />
        <StatCard label="Overdue Callbacks" value={metrics.queue.overdue_callbacks} alert={metrics.queue.overdue_callbacks > 0} />
        <StatCard label="Unreachable" value={metrics.leads.unreachable} sub="3 attempts exhausted" />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Lead Pipeline</h2>
        <div className="space-y-2.5">
          {metrics.state_breakdown.map(({ state, count }) => {
            const pct = metrics.leads.total > 0 ? (count / metrics.leads.total) * 100 : 0;
            return (
              <div key={state} className="flex items-center gap-3">
                <span className={`text-xs font-medium w-36 ${STATE_TEXT[state] || 'text-gray-600 dark:text-gray-400'}`}>
                  {state.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${STATE_COLORS[state] || 'bg-gray-300'}`}
                    style={{ width: `${Math.max(pct, 0.5)}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-8 text-right">{count}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 w-10 text-right">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
