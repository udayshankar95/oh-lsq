import { useState, FormEvent } from 'react';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

export default function Login() {
  const { login, refreshUser } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [mode, setMode]         = useState<'google' | 'password'>('google');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      const status = (err as any)?.response?.status;
      const msg    = (err as any)?.response?.data?.error;
      if (!status) setError('Cannot reach server — is the backend running?');
      else if (status === 401) setError('Invalid email or password');
      else setError(msg || `Server error (${status})`);
    } finally { setLoading(false); }
  };

  const handleGoogleSuccess = async (res: CredentialResponse) => {
    if (!res.credential) return;
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/google', { credential: res.credential });
      sessionStorage.setItem('oh_token', data.token);
      sessionStorage.setItem('fresh_login', 'true');
      await refreshUser();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error;
      setError(msg || 'Google sign-in failed. Make sure your email is on the access list.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#E8762C] mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">OLMS</h1>
          <p className="text-sm text-gray-500 mt-1">Orange Lead Management System</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-200 shadow-sm p-8">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Sign in</h2>

          {mode === 'google' ? (
            <div className="space-y-4">
              {/* Google Sign In button */}
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError('Google sign-in failed. Try again.')}
                  useOneTap={false}
                  shape="rectangular"
                  size="large"
                  text="signin_with"
                  logo_alignment="left"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2.5">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                  </svg>
                  {error}
                </div>
              )}

              <p className="text-xs text-center text-gray-400">
                Sign in with your <span className="font-medium">@orangehealth.in</span> account
              </p>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"/></div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs text-gray-400">or</span>
                </div>
              </div>

              <button
                onClick={() => setMode('password')}
                className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors text-center"
              >
                Sign in with email & password
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@orangehealth.in" required
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 text-gray-900 placeholder-gray-400 outline-none focus:border-[#E8762C] transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 text-gray-900 placeholder-gray-400 outline-none focus:border-[#E8762C] transition-colors"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2.5">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                  </svg>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#E8762C] text-white text-sm font-semibold hover:bg-[#d4692a] disabled:opacity-60 transition-colors mt-2">
                {loading ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>Signing in...</>
                ) : 'Sign in'}
              </button>

              <button type="button" onClick={() => { setMode('google'); setError(''); }}
                className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors text-center">
                ← Back to Google sign-in
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
