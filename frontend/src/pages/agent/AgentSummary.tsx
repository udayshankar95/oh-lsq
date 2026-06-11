import { useEffect, useState } from 'react';
import api from '../../api/client';

interface SummaryRow {
  date: string;
  assigned: number;
  worked: number;
  scheduled: number;
  connected_other: number;
  unreachable: number;
  callbacks: number;
  closed: number;
}

function fmt(d: string) {
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m)-1]} ${parseInt(day)}`;
}

function toISO(d: Date) { return d.toISOString().slice(0, 10); }

export default function AgentSummary() {
  const today = toISO(new Date());
  const thirtyDaysAgo = toISO(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo]     = useState(today);
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/agents/summary?from=${from}&to=${to}`);
      setRows(res.data.rows);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, [from, to]);

  const totals = rows.reduce((acc, r) => ({
    assigned: acc.assigned + r.assigned,
    worked: acc.worked + r.worked,
    scheduled: acc.scheduled + r.scheduled,
    connected_other: acc.connected_other + r.connected_other,
    unreachable: acc.unreachable + r.unreachable,
    callbacks: acc.callbacks + r.callbacks,
    closed: acc.closed + r.closed,
  }), { assigned: 0, worked: 0, scheduled: 0, connected_other: 0, unreachable: 0, callbacks: 0, closed: 0 });

  const downloadCSV = () => {
    const headers = ['Date','Assigned','Worked','Scheduled','Follow-up','Unreachable','Callback','Closed'];
    const csvRows = rows.map(r =>
      [r.date, r.assigned, r.worked, r.scheduled, r.connected_other, r.unreachable, r.callbacks, r.closed].join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv,' + encodeURIComponent(csv);
    a.download = `olms-summary-${from}-to-${to}.csv`;
    a.click();
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-base font-bold text-gray-900">My Summary</h1>
            <p className="text-xs text-gray-400 mt-0.5">Day-on-day call performance</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date" value={from} max={to}
                onChange={e => setFrom(e.target.value)}
                className="border border-gray-200 px-2 py-1 text-sm text-gray-700 bg-white"
              />
              <span className="text-gray-400">–</span>
              <input
                type="date" value={to} min={from} max={today}
                onChange={e => setTo(e.target.value)}
                className="border border-gray-200 px-2 py-1 text-sm text-gray-700 bg-white"
              />
            </div>
            <button
              onClick={downloadCSV}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 bg-white text-sm text-gray-600 hover:border-[#E8762C] hover:text-[#E8762C] transition-colors disabled:opacity-40"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              Download CSV
            </button>
          </div>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Leads Assigned', value: totals.assigned, color: 'text-gray-900' },
            { label: 'Calls Made', value: totals.worked, color: 'text-gray-900' },
            { label: 'Scheduled', value: totals.scheduled, color: 'text-green-600' },
            { label: 'Unreachable', value: totals.unreachable, color: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Assigned</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Worked</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-green-600 uppercase tracking-wide">Scheduled</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-blue-500 uppercase tracking-wide">Follow-up</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Callback</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-red-400 uppercase tracking-wide">Unreachable</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">No data for this period</td></tr>
              ) : rows.map(r => (
                <tr key={r.date} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-700">{fmt(r.date)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{r.assigned || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{r.worked || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-green-600 font-medium">{r.scheduled || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-blue-500">{r.connected_other || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{r.callbacks || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-red-400">{r.unreachable || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400">{r.closed || '—'}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Total</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{totals.assigned}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{totals.worked}</td>
                  <td className="px-4 py-2.5 text-right text-green-600">{totals.scheduled}</td>
                  <td className="px-4 py-2.5 text-right text-blue-500">{totals.connected_other}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{totals.callbacks}</td>
                  <td className="px-4 py-2.5 text-right text-red-400">{totals.unreachable}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400">{totals.closed}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
