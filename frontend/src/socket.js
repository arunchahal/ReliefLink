import { io } from 'socket.io-client';

const getBaseURL = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (import.meta.env.DEV) {
    return 'http://127.0.0.1:5001';
  }
  return 'https://relieflink-backend.onrender.com';
};

const SOCKET_URL = getBaseURL();

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  transports: ['polling']
});

// Reconnection and error handling
socket.on('disconnect', (reason) => {
  console.warn('Socket disconnected:', reason);
  // Attempt manual reconnect after a short delay
  setTimeout(() => {
    if (!socket.connected) socket.connect();
  }, 1000);
});

socket.on('reconnect_attempt', (attempt) => {
  console.info(`Reconnection attempt ${attempt}`);
});

// Safe emit wrapper to avoid sending when ws is undefined
export const safeEmit = (event, data) => {
  if (!socket.connected) {
    // Connect first, then emit once connected
    socket.connect();
    socket.once('connect', () => {
      socket.emit(event, data);
    });
  } else {
    socket.emit(event, data);
  }
};

// Global error handling for Socket.IO client
socket.on('connect_error', (err) => {
  console.error('Socket.io connection error:', err);
});
socket.on('error', (err) => {
  console.error('Socket.io error:', err);
});

export const connectSocket = () => {
  const token = localStorage.getItem('token');
  if (token && !socket.connected) {
    socket.auth = { token };
    socket.connect();
  }
};

export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};
