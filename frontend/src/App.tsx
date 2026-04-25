import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Login from './pages/Login';
import AgentLayout from './layouts/AgentLayout';
import ManagerLayout from './layouts/ManagerLayout';
import AgentQueue from './pages/agent/AgentQueue';
import ManagerDashboard from './pages/manager/ManagerDashboard';
import LeadManagement from './pages/manager/LeadManagement';
import AgentMonitor from './pages/manager/AgentMonitor';
import QueueConfig from './pages/manager/QueueConfig';
import AgentGroups from './pages/manager/AgentGroups';

function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="animate-spin w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-sm font-medium">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (user.role === 'agent') {
    return (
      <Routes>
        <Route path="/" element={<AgentLayout />}>
          <Route index element={<AgentQueue />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Manager routes
  return (
    <Routes>
      <Route path="/" element={<ManagerLayout />}>
        <Route index element={<ManagerDashboard />} />
        <Route path="leads" element={<LeadManagement />} />
        <Route path="agents" element={<AgentMonitor />} />
        <Route path="queue-config" element={<QueueConfig />} />
        <Route path="groups" element={<AgentGroups />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
