import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useState, useEffect } from 'react';
import api from '../api/client';

export default function AgentLayout() {
  const { user, logout, refreshUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [punchLoading, setPunchLoading] = useState(false);
  // Show punch-in modal if agent is not punched in on first load
  const [showPunchModal, setShowPunchModal] = useState(false);

  useEffect(() => {
    if (user && user.role === 'agent') {
      const isFreshLogin = sessionStorage.getItem('fresh_login') === 'true';
      if (isFreshLogin) {
        sessionStorage.removeItem('fresh_login'); // consume once
        setShowPunchModal(true);
      }
    }
  }, [user?.id]); // Fire once per login session

  const handlePunch = async (fromModal = false) => {
    setPunchLoading(true);
    try {
      const endpoint = user?.is_punched_in ? '/agents/punch-out' : '/agents/punch-in';
      await api.post(endpoint);
      await refreshUser();
      if (fromModal) setShowPunchModal(false);
    } catch (err: unknown) {
      console.error('Punch error:', err);
    } finally {
      setPunchLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top Navbar — dark navy, matches internal tools */}
      <header className="h-12 bg-[#0F1923] flex items-center px-4 gap-4 flex-shrink-0 z-40">
        <div className="flex items-center gap-2 mr-4">
          <div className="w-6 h-6 rounded bg-[#E8762C] flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="text-sm font-bold text-white hidden sm:block tracking-wide">OH-LSQ</span>
        </div>

        <nav className="flex items-center gap-1 flex-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-[#E8762C] border-b-2 border-[#E8762C]'
                  : 'text-gray-400 hover:text-white'
              }`
            }
          >
            My Queue
          </NavLink>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => handlePunch()}
            disabled={punchLoading}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold border transition-colors disabled:opacity-60 ${
              user?.is_punched_in
                ? 'border-green-500 text-green-400 hover:bg-green-500/10'
                : 'border-gray-600 text-gray-400 hover:border-gray-400 hover:text-white'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${user?.is_punched_in ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
            {punchLoading ? '…' : user?.is_punched_in ? 'Punched In' : 'Punch In'}
          </button>

          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#E8762C] flex items-center justify-center">
              <span className="text-xs font-bold text-white">{user?.name?.charAt(0)}</span>
            </div>
            <span className="text-sm text-gray-300 hidden sm:block">{user?.name}</span>
          </div>

          <button
            onClick={logout}
            className="text-gray-500 hover:text-white transition-colors p-1"
            title="Sign out"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      {/* Punched-out warning bar */}
      {!user?.is_punched_in && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 flex-shrink-0">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          You are punched out. Punch in to receive tasks.
          <button onClick={() => handlePunch()} disabled={punchLoading} className="ml-auto font-semibold underline hover:no-underline disabled:opacity-60">
            Punch In Now
          </button>
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Punch-In Modal */}
      {showPunchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded border border-gray-200 shadow-lg w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              Welcome back, {user?.name?.split(' ')[0]}!
            </h2>

            {user?.is_punched_in ? (
              <>
                <p className="text-sm text-gray-500 mb-5">You're already punched in and ready to receive tasks.</p>
                <button onClick={() => setShowPunchModal(false)} className="w-full py-2 px-4 bg-[#E8762C] text-white text-sm font-semibold hover:bg-[#d4692a] transition-colors">
                  Let's Go
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-5">Punch in to start receiving tasks and log your shift.</p>
                <div className="space-y-2">
                  <button onClick={() => handlePunch(true)} disabled={punchLoading} className="w-full py-2 px-4 bg-[#E8762C] text-white text-sm font-semibold hover:bg-[#d4692a] transition-colors disabled:opacity-60">
                    {punchLoading ? 'Punching In…' : 'Punch In Now'}
                  </button>
                  <button onClick={() => setShowPunchModal(false)} className="w-full py-2 px-4 text-sm text-gray-500 hover:bg-gray-50 border border-gray-200 transition-colors">
                    Maybe Later
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
