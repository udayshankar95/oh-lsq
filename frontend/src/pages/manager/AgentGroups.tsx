import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';

interface AgentGroup {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
  created_by_name: string | null;
  created_at: string;
}

interface GroupMember {
  id: number;
  name: string;
  email: string;
  city: string;
  is_punched_in: boolean;
}

interface GroupDetail extends AgentGroup {
  members: GroupMember[];
}

interface Agent {
  id: number;
  name: string;
  email: string;
  is_punched_in: boolean;
}

export default function AgentGroups() {
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [groupDetail, setGroupDetail] = useState<Record<number, GroupDetail>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);

  // Create group modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Add member modal
  const [addMemberGroupId, setAddMemberGroupId] = useState<number | null>(null);
  const [addMemberAgentId, setAddMemberAgentId] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      const [groupsRes, agentsRes] = await Promise.all([
        api.get('/manager/groups'),
        api.get('/manager/agents'),
      ]);
      setGroups(groupsRes.data);
      setAllAgents(agentsRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const fetchDetail = async (groupId: number) => {
    setDetailLoading(groupId);
    try {
      const res = await api.get(`/manager/groups/${groupId}`);
      setGroupDetail(prev => ({ ...prev, [groupId]: res.data }));
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(null);
    }
  };

  const toggleExpand = async (groupId: number) => {
    if (expandedId === groupId) {
      setExpandedId(null);
    } else {
      setExpandedId(groupId);
      if (!groupDetail[groupId]) {
        await fetchDetail(groupId);
      }
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post('/manager/groups', { name: newName.trim(), description: newDesc.trim() || undefined });
      setNewName(''); setNewDesc('');
      setShowCreate(false);
      await fetchGroups();
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (groupId: number, groupName: string) => {
    if (!confirm(`Delete group "${groupName}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/manager/groups/${groupId}`);
      if (expandedId === groupId) setExpandedId(null);
      await fetchGroups();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddMember = async () => {
    if (!addMemberGroupId || !addMemberAgentId) return;
    setAddingMember(true);
    try {
      await api.post(`/manager/groups/${addMemberGroupId}/members`, { agent_id: parseInt(addMemberAgentId) });
      setAddMemberGroupId(null);
      setAddMemberAgentId('');
      // Refresh detail for this group
      await fetchDetail(addMemberGroupId);
      await fetchGroups();
    } catch (e) {
      console.error(e);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (groupId: number, agentId: number) => {
    try {
      await api.delete(`/manager/groups/${groupId}/members/${agentId}`);
      setGroupDetail(prev => ({
        ...prev,
        [groupId]: {
          ...prev[groupId],
          members: prev[groupId].members.filter(m => m.id !== agentId),
        },
      }));
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, member_count: g.member_count - 1 } : g));
    } catch (e) {
      console.error(e);
    }
  };

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

  const detail = expandedId ? groupDetail[expandedId] : null;
  const memberIdsInGroup = detail?.members.map(m => m.id) ?? [];
  const eligibleAgents = allAgents.filter(a => !memberIdsInGroup.includes(a.id));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Agent Groups</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            {groups.length} group{groups.length !== 1 ? 's' : ''} · Organize agents into teams
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-base shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
          New Group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center">
          <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </div>
          <p className="font-semibold text-gray-700 dark:text-gray-300">No groups yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Create a group to organize agents into teams, shifts, or specialties</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-base">
            Create First Group
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => (
            <div key={group.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              {/* Group header row */}
              <div className="flex items-center gap-4 px-5 py-4">
                <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{group.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      {group.member_count} member{group.member_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {group.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">{group.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setAddMemberGroupId(group.id); setAddMemberAgentId(''); if (!groupDetail[group.id]) fetchDetail(group.id); }}
                    className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium px-2.5 py-1.5 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-base"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>
                    </svg>
                    Add
                  </button>
                  <button
                    onClick={() => toggleExpand(group.id)}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-base"
                  >
                    {detailLoading === group.id ? (
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    ) : (
                      <svg className={`w-3.5 h-3.5 transition-transform ${expandedId === group.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                      </svg>
                    )}
                    {expandedId === group.id ? 'Hide' : 'View'}
                  </button>
                  <button
                    onClick={() => handleDelete(group.id, group.name)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-base"
                    title="Delete group"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Members panel */}
              {expandedId === group.id && groupDetail[group.id] && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-5 pb-4 pt-3">
                  {groupDetail[group.id].members.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500 py-2">No members yet. Click "Add" to assign agents to this group.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {groupDetail[group.id].members.map(member => (
                        <div key={member.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                          <div className="relative flex-shrink-0">
                            <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center">
                              <span className="text-xs font-semibold text-brand-700 dark:text-brand-400">{member.name.charAt(0)}</span>
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 ${member.is_punched_in ? 'bg-green-400' : 'bg-gray-300 dark:bg-gray-600'}`}/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{member.name}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{member.email}</p>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(group.id, member.id)}
                            className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-base flex-shrink-0"
                            title="Remove from group"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Create Group Modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Create New Group</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Group Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Morning Shift, Team A"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white dark:bg-gray-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-base"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="e.g. Agents working 7AM–2PM"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white dark:bg-gray-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-base"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setShowCreate(false); setNewName(''); setNewDesc(''); }}
                className="flex-1 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-base"
              >Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="flex-1 py-2.5 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-base"
              >{creating ? 'Creating…' : 'Create Group'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Member Modal ────────────────────────────────────────────────── */}
      {addMemberGroupId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Add Agent to Group</h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
              {groups.find(g => g.id === addMemberGroupId)?.name}
            </p>
            <select
              value={addMemberAgentId}
              onChange={e => setAddMemberAgentId(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white dark:bg-gray-800 outline-none focus:border-brand-500 transition-base mb-4"
            >
              <option value="">Select an agent…</option>
              {eligibleAgents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.is_punched_in ? '● Active' : '○ Offline'}
                </option>
              ))}
            </select>
            {eligibleAgents.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">All agents are already in this group.</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setAddMemberGroupId(null); setAddMemberAgentId(''); }}
                className="flex-1 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-base"
              >Cancel</button>
              <button
                onClick={handleAddMember}
                disabled={!addMemberAgentId || addingMember}
                className="flex-1 py-2.5 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-base"
              >{addingMember ? 'Adding…' : 'Add to Group'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
