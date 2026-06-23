import axios from 'axios';

const getBaseURL = () => {
  if (import.meta.env && import.meta.env.VITE_API_BASE_URL) {
    let url = import.meta.env.VITE_API_BASE_URL;
    if (!url.endsWith('/api') && !url.endsWith('/api/')) {
      url = url.endsWith('/') ? `${url}api` : `${url}/api`;
    }
    return url;
  }
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:10000/api';
    }
  }
  return 'https://relieflink-backend.onrender.com/api';
};

const api = axios.create({
  baseURL: getBaseURL(),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
