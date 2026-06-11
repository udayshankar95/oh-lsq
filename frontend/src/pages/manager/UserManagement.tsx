import { useEffect, useState } from 'react';
import api from '../../api/client';

interface User { id: number; name: string; email: string; role: string; is_punched_in: boolean; created_at: string; }
interface AllowedUser { id: number; name: string; email: string; role: string; added_at: string; }

export default function UserManagement() {
  const [users, setUsers]         = useState<User[]>([]);
  const [allowed, setAllowed]     = useState<AllowedUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [newEmail, setNewEmail]   = useState('');
  const [newName, setNewName]     = useState('');
  const [newRole, setNewRole]     = useState<'agent' | 'manager'>('agent');
  const [adding, setAdding]       = useState(false);
  const [addError, setAddError]   = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/manager/users');
      setUsers(res.data.users);
      setAllowed(res.data.allowed_users);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleAddAllowed = async () => {
    if (!newEmail || !newName) return;
    setAdding(true); setAddError('');
    try {
      await api.post('/manager/users/allowed', { email: newEmail, name: newName, role: newRole });
      setNewEmail(''); setNewName(''); setNewRole('agent');
      await load();
    } catch (e: any) {
      setAddError(e?.response?.data?.error || 'Failed to add');
    } finally { setAdding(false); }
  };

  const handleRemoveAllowed = async (id: number) => {
    await api.delete(`/manager/users/allowed/${id}`);
    await load();
  };

  const handleChangeRole = async (id: number, role: string) => {
    await api.put(`/manager/users/${id}/role`, { role });
    await load();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-base font-bold text-gray-900">User Management</h1>
        <p className="text-xs text-gray-400 mt-0.5">Control who can access OLMS and their role</p>
      </div>

      {/* Add to access list */}
      <div className="bg-white border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Grant Access</h2>
        <p className="text-xs text-gray-400 mb-4">Add an email to the access list. When this person logs in (or when Google SSO is enabled), they'll automatically get the assigned role.</p>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-gray-500 mb-1">Full Name</label>
            <input
              type="text" placeholder="Anjali Rao" value={newName}
              onChange={e => setNewName(e.target.value)}
              className="w-full border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#E8762C] transition-colors"
            />
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              type="email" placeholder="name@orangehealth.in" value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="w-full border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#E8762C] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select value={newRole} onChange={e => setNewRole(e.target.value as 'agent' | 'manager')}
              className="border border-gray-200 px-3 py-2 text-sm text-gray-900 bg-white outline-none focus:border-[#E8762C]">
              <option value="agent">Agent</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <button
            onClick={handleAddAllowed} disabled={adding || !newEmail || !newName}
            className="px-4 py-2 bg-[#E8762C] text-white text-sm font-semibold hover:bg-[#d4692a] transition-colors disabled:opacity-50"
          >{adding ? 'Adding…' : '+ Add'}</button>
        </div>
        {addError && <p className="text-xs text-red-500 mt-2">{addError}</p>}
      </div>

      {/* Access list */}
      {allowed.length > 0 && (
        <div className="bg-white border border-gray-200 mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Access List ({allowed.length})</h2>
            <p className="text-xs text-gray-400">Users pre-approved to access OLMS</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Added</th>
                <th/>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allowed.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{u.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium border ${u.role === 'manager' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{new Date(u.added_at).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => handleRemoveAllowed(u.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Active users */}
      <div className="bg-white border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Active Users ({users.length})</h2>
          <p className="text-xs text-gray-400">Users who have logged in to OLMS</p>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Change Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{u.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium border ${u.role === 'manager' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {u.is_punched_in
                      ? <span className="flex items-center gap-1 text-xs text-green-600"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"/>Active</span>
                      : <span className="text-xs text-gray-400">Offline</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={u.role}
                      onChange={e => handleChangeRole(u.id, e.target.value)}
                      className="border border-gray-200 px-2 py-1 text-xs bg-white outline-none focus:border-[#E8762C]"
                    >
                      <option value="agent">Agent</option>
                      <option value="manager">Manager</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
