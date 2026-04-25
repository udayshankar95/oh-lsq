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
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Top Navbar */}
      <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-4 flex-shrink-0 z-40 shadow-xs">
        <div className="flex items-center gap-2 mr-4">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="text-sm font-bold text-gray-900 dark:text-white hidden sm:block">OH-LSQ</span>
        </div>

        <nav className="flex items-center gap-1 flex-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-base ${
                isActive
                  ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
              }`
            }
          >
            My Queue
          </NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePunch()}
            disabled={punchLoading}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-base disabled:opacity-60 ${
              user?.is_punched_in
                ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${user?.is_punched_in ? 'bg-green-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'}`} />
            {punchLoading ? '…' : user?.is_punched_in ? 'Punched In' : 'Punch In'}
          </button>

          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-base"
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>
              </svg>
            )}
          </button>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center">
              <span className="text-xs font-semibold text-brand-700 dark:text-brand-400">{user?.name?.charAt(0)}</span>
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:block">{user?.name}</span>
          </div>

          <button
            onClick={logout}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-base p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
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
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-400 flex-shrink-0">
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

      {/* ── Punch-In Welcome Modal ──────────────────────────────────────────── */}
      {showPunchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-6">
            {/* Icon */}
            <div className="flex justify-center mb-4">
              <div className="relative">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${user?.is_punched_in ? 'bg-green-100 dark:bg-green-900/30' : 'bg-brand-100 dark:bg-brand-900/40'}`}>
                  <svg className={`w-9 h-9 ${user?.is_punched_in ? 'text-green-600 dark:text-green-400' : 'text-brand-600 dark:text-brand-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.836.986V17a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                  </svg>
                </div>
                <span className="absolute -top-1 -right-1 text-xl">👋</span>
              </div>
            </div>

            <h2 className="text-lg font-bold text-gray-900 dark:text-white text-center mb-1">
              Welcome back, {user?.name?.split(' ')[0]}!
            </h2>

            {user?.is_punched_in ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-5">
                  You're already <span className="text-green-600 dark:text-green-400 font-semibold">punched in</span> and ready to receive tasks.
                </p>
                <button
                  onClick={() => setShowPunchModal(false)}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-green-600 text-white text-sm font-semibold rounded-xl transition-base hover:bg-green-700 active:scale-[0.98] shadow-sm"
                >
                  <span className="w-2 h-2 bg-white/70 rounded-full animate-pulse"/>
                  Let's Go
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-5">
                  Punch in to start receiving tasks and log your shift.
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => handlePunch(true)}
                    disabled={punchLoading}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-brand-600 text-white text-sm font-semibold rounded-xl transition-base hover:bg-brand-700 active:scale-[0.98] disabled:opacity-60 shadow-sm"
                  >
                    {punchLoading ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Punching In…
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"/>
                        Punch In Now
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowPunchModal(false)}
                    className="w-full py-2.5 px-4 text-sm font-medium text-gray-600 dark:text-gray-400 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-base"
                  >
                    Maybe Later
                  </button>
                </div>
                <p className="text-xs text-center text-gray-400 dark:text-gray-500 mt-3">
                  You can punch in at any time from the top bar
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
