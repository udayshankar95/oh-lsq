import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';
import api from '../api/client';

const navItems = [
  {
    to: '/',
    end: true,
    label: 'Workable Leads',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
    ),
  },
  {
    to: '/summary',
    end: false,
    label: 'My Summary',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
      </svg>
    ),
  },
];

export default function AgentLayout() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [punchLoading, setPunchLoading] = useState(false);
  const [showPunchModal, setShowPunchModal] = useState(false);

  useEffect(() => {
    if (user && user.role === 'agent') {
      const isFreshLogin = sessionStorage.getItem('fresh_login') === 'true';
      if (isFreshLogin) {
        sessionStorage.removeItem('fresh_login');
        setShowPunchModal(true);
      }
    }
  }, [user?.id]);

  const handlePunch = async (fromModal = false) => {
    setPunchLoading(true);
    try {
      const endpoint = user?.is_punched_in ? '/agents/punch-out' : '/agents/punch-in';
      await api.post(endpoint);
      await refreshUser();
      if (fromModal) setShowPunchModal(false);
    } catch (err) {
      console.error('Punch error:', err);
    } finally {
      setPunchLoading(false);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-52 bg-[#0F1923] flex flex-col flex-shrink-0 h-full">
        {/* Logo */}
        <div className="h-12 px-4 flex items-center gap-2.5 border-b border-white/10">
          <div className="w-6 h-6 rounded bg-[#E8762C] flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold text-white tracking-wide">OLMS</p>
            <p className="text-[10px] text-gray-500 leading-tight">Agent View</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors border-l-2 ${
                  isActive
                    ? 'border-[#E8762C] text-white bg-white/5'
                    : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Punch In/Out + User */}
        <div className="border-t border-white/10 p-3 space-y-2">
          <button
            onClick={() => handlePunch()}
            disabled={punchLoading}
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-60 ${
              user?.is_punched_in
                ? 'border-green-500 text-green-400 hover:bg-green-500/10'
                : 'border-[#E8762C] text-[#E8762C] hover:bg-[#E8762C]/10'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${user?.is_punched_in ? 'bg-green-500 animate-pulse' : 'bg-[#E8762C]'}`}/>
            {punchLoading ? '…' : user?.is_punched_in ? '● Punched In' : 'Punch In'}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#E8762C] flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">{user?.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user?.name}</p>
            </div>
            <button onClick={logout} className="text-gray-500 hover:text-white transition-colors p-1" title="Sign out">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Punched-out warning */}
        {!user?.is_punched_in && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 flex-shrink-0">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            You are punched out — punch in from the sidebar to receive tasks.
          </div>
        )}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {/* Punch-In Modal */}
      {showPunchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white border border-gray-200 shadow-lg w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Welcome back, {user?.name?.split(' ')[0]}!</h2>
            {user?.is_punched_in ? (
              <>
                <p className="text-sm text-gray-500 mb-5">You're already punched in and ready.</p>
                <button onClick={() => setShowPunchModal(false)} className="w-full py-2 px-4 bg-[#E8762C] text-white text-sm font-semibold hover:bg-[#d4692a] transition-colors">Let's Go</button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-5">Punch in to start receiving tasks.</p>
                <div className="space-y-2">
                  <button onClick={() => handlePunch(true)} disabled={punchLoading} className="w-full py-2 px-4 bg-[#E8762C] text-white text-sm font-semibold hover:bg-[#d4692a] transition-colors disabled:opacity-60">
                    {punchLoading ? 'Punching In…' : 'Punch In Now'}
                  </button>
                  <button onClick={() => setShowPunchModal(false)} className="w-full py-2 px-4 text-sm text-gray-500 hover:bg-gray-50 border border-gray-200 transition-colors">Maybe Later</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
