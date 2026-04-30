import axios from 'axios';

// In dev, Vite proxies /api → localhost:3001.
// In production, VITE_API_BASE_URL points to the deployed backend (e.g. https://oh-lsq-backend.onrender.com).
const baseURL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('oh_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem('oh_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
