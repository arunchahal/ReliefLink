import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import CitizenPortal from './pages/CitizenPortal';
import VolunteerPortal from './pages/VolunteerPortal';
import AdminPortal from './pages/AdminPortal';

// Basic Protected Route wrapper
const ProtectedRoute = ({ children, allowedRole }) => {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user'));

  if (!token || !user) {
    return <Navigate to="/" replace />;
  }

  if (allowedRole && user.role !== allowedRole) {
    // If logged in but wrong role, redirect to their own portal
    if (user.role === 'citizen') return <Navigate to="/citizen" replace />;
    if (user.role === 'volunteer') return <Navigate to="/volunteer" replace />;
    if (user.role === 'admin') return <Navigate to="/admin" replace />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        
        <Route 
          path="/citizen" 
          element={
            <ProtectedRoute allowedRole="citizen">
              <CitizenPortal />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/volunteer" 
          element={
            <ProtectedRoute allowedRole="volunteer">
              <VolunteerPortal />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/admin" 
          element={
            <ProtectedRoute allowedRole="admin">
              <AdminPortal />
            </ProtectedRoute>
          } 
        />
        
        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
