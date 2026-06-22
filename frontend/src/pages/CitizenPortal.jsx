import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Snackbar, Alert, CircularProgress, Chip } from '@mui/material';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import api from '../api';
import { FaBreadSlice, FaBriefcaseMedical, FaLifeRing, FaHome, FaSignOutAlt, FaExclamationTriangle, FaRoute, FaPhone, FaUsers, FaMedkit, FaUtensils, FaSatelliteDish, FaCloudRain, FaThermometerHalf, FaWind, FaBroadcastTower } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { socket, connectSocket, disconnectSocket } from '../socket';
import Timeline from '../components/Timeline';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const shelterIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const userIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const volunteerMapIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-violet.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const CitizenPortal = () => {
  const [sosTypes, setSosTypes] = useState([]);
  const [priority, setPriority] = useState('medium');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState({ lat: 28.61, lng: 77.23 });
  const [locating, setLocating] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', type: 'success' });
  const [activeRequest, setActiveRequest] = useState(null);
  const [shelters, setShelters] = useState([]);
  const [selectedShelter, setSelectedShelter] = useState(null);
  const [liveTrackingActive, setLiveTrackingActive] = useState(false);
  const [locationTrail, setLocationTrail] = useState([]);
  const [riskData, setRiskData] = useState(null);
  
  const [shelterDialogOpen, setShelterDialogOpen] = useState(false);
  const [newShelterName, setNewShelterName] = useState('');
  const [newShelterCapacity, setNewShelterCapacity] = useState(50);
  const [newShelterMedical, setNewShelterMedical] = useState(false);
  const [newShelterFood, setNewShelterFood] = useState(false);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [broadcastAlerts, setBroadcastAlerts] = useState([]);
  const [nearbyVolunteers, setNearbyVolunteers] = useState([]);

  const trackingRef = useRef(null);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user'));

  const fetchAlerts = async () => {
    try {
      const res = await api.get('/alerts');
      setBroadcastAlerts(res.data);
    } catch (err) { console.error('Failed to fetch alerts', err); }
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setLocation({ lat, lng });
          setLocating(false);
          // Pass coords directly to avoid stale closure over the default location
          fetchShelters(lat, lng);
          fetchRisk(lat, lng);
        },
        () => {
          // Geolocation denied/failed — use default coords
          setLocating(false);
          fetchShelters(location.lat, location.lng);
          fetchRisk(location.lat, location.lng);
        }
      );
    } else {
      setLocating(false);
      fetchShelters(location.lat, location.lng);
      fetchRisk(location.lat, location.lng);
    }
    fetchRequests();
    fetchAlerts();

    // Refresh risk every 5 minutes using the latest location from state
    const riskInterval = setInterval(() => {
      setLocation(prev => {
        fetchRisk(prev.lat, prev.lng);
        return prev;
      });
    }, 300000);
    return () => clearInterval(riskInterval);
  }, []);

  // Handle Online/Offline Status and Local SOS syncing
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setToast({ open: true, message: '📶 Connection Restored! Syncing data...', type: 'success' });
      
      // Auto-sync offline SOS if any exists
      const offlineSos = localStorage.getItem('offline_sos');
      if (offlineSos) {
        try {
          const parsed = JSON.parse(offlineSos);
          const res = await api.post('/sos', parsed);
          setActiveRequest(res.data);
          setLiveTrackingActive(true);
          setLocationTrail([[location.lat, location.lng]]);
          setToast({ open: true, message: '✅ Offline SOS synced and broadcasted!', type: 'success' });
          localStorage.removeItem('offline_sos');
        } catch (e) {
          console.error('Offline SOS sync failed', e);
          setToast({ open: true, message: 'Failed to sync offline SOS. Retrying shortly.', type: 'error' });
        }
      }
      
      // Re-fetch data
      fetchRequests();
      fetchShelters();
      fetchAlerts();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setToast({ open: true, message: '⚠️ Connection Lost. Operating in Offline Mode.', type: 'warning' });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check for offline SOS sync if online on load
    if (navigator.onLine) {
      handleOnline();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [location]);

  // WebSockets Connection & Listener Setup
  useEffect(() => {
    connectSocket();
    
    socket.on('sos_updated', (updatedSos) => {
      if (Number(updatedSos.user_id) === Number(user?.id)) {
        if (updatedSos.status === 'resolved') {
          setLiveTrackingActive(false);
          setToast({ open: true, message: '🎉 Your SOS has been resolved! Glad you are safe.', type: 'success' });
          setActiveRequest(null);
        } else {
          setActiveRequest(prev => {
            if (updatedSos.status === 'in-progress' && (!prev || prev.status === 'pending')) {
              setToast({ open: true, message: `🚑 Help is on the way! Volunteer ${updatedSos.volunteer_name} accepted your request.`, type: 'info' });
            }
            return updatedSos;
          });
        }
      }
    });

    socket.on('broadcast_alert', (newAlert) => {
      setBroadcastAlerts(prev => [newAlert, ...prev]);
      setToast({ open: true, message: `⚠️ NEW BROADCAST: ${newAlert.message}`, type: 'error' });
      // Play a subtle emergency alert sound or vibration if supported
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    });

    socket.on('volunteer_location_broadcast', (data) => {
      setNearbyVolunteers(prev => {
        const existing = prev.findIndex(v => v.volunteer_id === data.volunteer_id);
        if (existing !== -1) {
          const updated = [...prev];
          updated[existing] = { ...updated[existing], lat: data.lat, lng: data.lng, name: data.name };
          return updated;
        }
        return prev;
      });
    });

    return () => {
      socket.off('sos_updated');
      socket.off('broadcast_alert');
      socket.off('volunteer_location_broadcast');
      disconnectSocket();
    };
  }, []);

  // Fetch nearby volunteers periodically
  useEffect(() => {
    const fetchNearbyVolunteers = async () => {
      try {
        const res = await api.get(`/volunteers/nearby?lat=${location.lat}&lng=${location.lng}`);
        setNearbyVolunteers(res.data);
      } catch (err) { console.error('Failed to fetch nearby volunteers', err); }
    };
    fetchNearbyVolunteers();
    const interval = setInterval(fetchNearbyVolunteers, 15000);
    return () => clearInterval(interval);
  }, [location]);

  useEffect(() => {
    if (liveTrackingActive && activeRequest) {
      trackingRef.current = setInterval(() => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(async (pos) => {
            const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setLocation(newLoc);
            setLocationTrail(prev => [...prev, [newLoc.lat, newLoc.lng]]);
            try { await api.post(`/sos/${activeRequest.id}/location`, newLoc); } catch (e) { console.error(e); }
          });
        }
      }, 5000);
      return () => clearInterval(trackingRef.current);
    }
    return () => { if (trackingRef.current) clearInterval(trackingRef.current); };
  }, [liveTrackingActive, activeRequest]);

  // Poll active request status periodically for reliability
  useEffect(() => {
    let pollInterval = null;
    if (activeRequest) {
      pollInterval = setInterval(() => {
        fetchRequests();
      }, 5000);
    }
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [activeRequest]);



  const fetchRequests = async () => {
    try {
      const res = await api.get('/sos');
      console.log("[CitizenPortal] res.data from /sos GET:", res.data);
      if (res.data?.length > 0) {
        const active = res.data.find(r => r.status !== 'resolved');
        console.log("[CitizenPortal] active request found:", active);
        if (active) { 
          setActiveRequest(active); 
          setLiveTrackingActive(true); 
        } else {
          setActiveRequest(null);
        }
      } else {
        setActiveRequest(null);
      }
    } catch (err) { 
      console.error("[CitizenPortal] fetchRequests error:", err); 
    }
  };

  const fetchShelters = async (lat = location.lat, lng = location.lng) => {
    try {
      const res = await api.get(`/shelters?lat=${lat}&lng=${lng}`);
      setShelters(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchRisk = async (lat = location.lat, lng = location.lng) => {
    try {
      const res = await api.post('/risk', { lat, lon: lng });
      setRiskData(res.data);
    } catch (err) { console.error('Risk fetch failed', err); }
  };

  const toggleSosType = (type) => {
    setSosTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const handleSendSOS = async () => {
    setLoading(true);
    const sosPayload = { type: sosTypes, priority, location, description: note };
    
    if (!isOnline) {
      localStorage.setItem('offline_sos', JSON.stringify(sosPayload));
      
      const mockRequest = {
        id: 'OFFLINE_TEMP',
        user_name: user?.name || 'Citizen',
        user_phone: user?.phone || '',
        type: sosTypes.join(','),
        types: sosTypes,
        priority: priority,
        location: location,
        description: note,
        status: 'pending',
        volunteer_name: null,
        timestamp: new Date().toISOString(),
        timeline: [
          {
            id: 'mock-1',
            sos_id: 'OFFLINE_TEMP',
            status: 'pending',
            timestamp: new Date().toISOString(),
            message: '🚨 Local Offline Queue — Pending Connection'
          }
        ]
      };
      
      setActiveRequest(mockRequest);
      setLiveTrackingActive(false);
      setToast({ open: true, message: '🚨 SOS queued locally. Connecting to sync...', type: 'warning' });
      setConfirmOpen(false);
      setSosTypes([]);
      setNote('');
      setPriority('medium');
      setLoading(false);
      return;
    }
    
    try {
      const res = await api.post('/sos', sosPayload);
      setToast({ open: true, message: 'SOS Request Sent Successfully!', type: 'success' });
      setActiveRequest(res.data);
      setLiveTrackingActive(true);
      setLocationTrail([[location.lat, location.lng]]);
      setConfirmOpen(false);
      setSosTypes([]);
      setNote('');
      setPriority('medium');
    } catch (err) {
      setToast({ open: true, message: 'Failed to send SOS. Please try again.', type: 'error' });
    } finally { setLoading(false); }
  };

  const handleAddShelter = async () => {
    setLoading(true);
    try {
      await api.post('/shelters', {
        name: newShelterName || 'Citizen Marked Safe Place',
        lat: location.lat,
        lng: location.lng,
        capacity: newShelterCapacity,
        has_medical: newShelterMedical,
        has_food: newShelterFood
      });
      setToast({ open: true, message: 'Safe place marked successfully!', type: 'success' });
      setShelterDialogOpen(false);
      setNewShelterName('');
      setNewShelterCapacity(50);
      setNewShelterMedical(false);
      setNewShelterFood(false);
      fetchShelters();
    } catch (err) {
      setToast({ open: true, message: 'Failed to mark safe place.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); navigate('/'); };

  const helpTypes = [
    { id: 'food', icon: <FaBreadSlice size={28} />, label: 'Food', color: '#f59e0b', gradient: 'from-amber-400 to-orange-500' },
    { id: 'medical', icon: <FaBriefcaseMedical size={28} />, label: 'Medical', color: '#ef4444', gradient: 'from-red-400 to-red-600' },
    { id: 'rescue', icon: <FaLifeRing size={28} />, label: 'Rescue', color: '#3b82f6', gradient: 'from-blue-400 to-blue-600' },
    { id: 'shelter', icon: <FaHome size={28} />, label: 'Shelter', color: '#8b5cf6', gradient: 'from-purple-400 to-purple-600' },
  ];

  const priorities = [
    { id: 'low', label: 'Low Risk', color: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0', activeBg: '#22c55e', textActive: '#fff' },
    { id: 'medium', label: 'Medium', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', activeBg: '#f59e0b', textActive: '#fff' },
    { id: 'critical', label: 'Critical!', color: '#ef4444', bg: '#fef2f2', border: '#fecaca', activeBg: '#ef4444', textActive: '#fff' },
  ];

  const openRoute = (shelter) => {
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${location.lat},${location.lng}&destination=${shelter.lat},${shelter.lng}&travelmode=walking`, '_blank');
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans pb-20">
      {/* Decorative background blobs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-purple-400/10 rounded-full blur-3xl translate-x-1/3 translate-y-1/3 pointer-events-none"></div>

      {/* Navbar */}
      <motion.nav 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="bg-white/80 backdrop-blur-md shadow-sm border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-50"
      >
        <div className="flex items-center">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-black mr-3 text-lg shadow-lg shadow-blue-500/30">
            IRL
          </div>
          <span className="font-extrabold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">
            ReliefLink
          </span>
        </div>
        <div className="flex items-center gap-5">
          {liveTrackingActive && (
            <motion.span 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-100/80 px-3 py-1.5 rounded-full border border-emerald-200 shadow-sm"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span> LIVE
            </motion.span>
          )}
          <div className="hidden sm:block text-sm font-semibold text-gray-600">
            Hi, <span className="text-gray-900">{user?.name.split(' ')[0]}</span>
          </div>
          <motion.button 
            whileHover={{ scale: 1.1, rotate: 5 }}
            whileTap={{ scale: 0.9 }}
            onClick={handleLogout} 
            className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition-colors"
          >
            <FaSignOutAlt size={18} />
          </motion.button>
        </div>
      </motion.nav>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="max-w-7xl mx-auto mt-8 px-4 sm:px-6 lg:px-8 relative z-10"
      >
        {/* Offline Mode Sticky Banner */}
        <AnimatePresence>
          {!isOnline && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-6 p-4 bg-amber-500 text-white rounded-3xl font-bold text-sm shadow-lg flex items-center justify-between gap-4 border border-amber-600 relative overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <span className="block font-black text-base uppercase">Offline Mode Active</span>
                  <span className="font-medium text-xs opacity-90">Working with cached emergency information. Your SOS is saved locally and will auto-sync when online.</span>
                </div>
              </div>
              <span className="text-xs bg-black/25 px-3 py-1.5 rounded-full shrink-0">Local Cache</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Real-time Broadcast Alerts from Admin */}
        <AnimatePresence>
          {broadcastAlerts.length > 0 && (
            <div className="mb-6 space-y-3">
              {broadcastAlerts.slice(0, 3).map((alert) => (
                <motion.div
                  key={alert.id}
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 50, opacity: 0 }}
                  className={`p-5 rounded-3xl shadow-xl flex items-center gap-4 relative overflow-hidden border-2 ${
                    alert.risk_level === 'CRITICAL' ? 'bg-red-600 border-red-700 text-white animate-pulse' :
                    alert.risk_level === 'HIGH' ? 'bg-orange-50 border-orange-300 text-orange-950' :
                    'bg-amber-50 border-amber-300 text-amber-950'
                  }`}
                >
                  <div className={`p-3 rounded-2xl ${alert.risk_level === 'CRITICAL' ? 'bg-white/20' : 'bg-white shadow-md'}`}>
                    <FaBroadcastTower size={24} className={alert.risk_level === 'CRITICAL' ? 'text-white' : 'text-red-500'} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-extrabold text-sm uppercase tracking-wide">
                        📢 Critical Broadcast {alert.area ? `— ${alert.area}` : ''}
                      </span>
                      <span className="text-[10px] opacity-60">
                        {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm font-bold leading-relaxed">{alert.message}</p>
                  </div>
                  <button
                    onClick={() => setBroadcastAlerts(prev => prev.filter(b => b.id !== alert.id))}
                    className={`text-sm font-black w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors ${alert.risk_level === 'CRITICAL' ? 'text-white' : 'text-gray-500'}`}
                  >
                    ×
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>

        {/* Risk Alert Banner - Full Width Top */}
        <AnimatePresence>
          {riskData && (
            <motion.div 
              variants={itemVariants}
              initial={{ opacity: 0, height: 0, scale: 0.9 }}
              animate={{ opacity: 1, height: 'auto', scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.9 }}
              className={`mb-8 p-5 rounded-3xl shadow-xl overflow-hidden relative ${
                riskData.risk_level === 'CRITICAL' ? 'bg-gradient-to-br from-red-600 to-rose-700 text-white shadow-red-500/30' :
                riskData.risk_level === 'HIGH' ? 'bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 text-red-900 shadow-red-500/10' :
                riskData.risk_level === 'MEDIUM' ? 'bg-gradient-to-br from-yellow-50 to-amber-50 border border-yellow-200 text-yellow-900 shadow-yellow-500/10' :
                'bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 text-emerald-900 shadow-emerald-500/10'
              }`}
            >
              {/* Decorative shimmer */}
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 rounded-full ${riskData.risk_level === 'CRITICAL' ? 'bg-white/20' : 'bg-white shadow-sm'}`}>
                      <FaExclamationTriangle className={riskData.risk_level === 'CRITICAL' ? 'text-white' : riskData.risk_level === 'HIGH' ? 'text-red-500' : riskData.risk_level === 'MEDIUM' ? 'text-yellow-500' : 'text-emerald-500'} size={20} />
                    </div>
                    <span className="font-black text-lg uppercase tracking-wider">{riskData.risk_level} RISK — {riskData.risk_type}</span>
                    <span className={`hidden sm:inline-block text-xs font-bold px-3 py-1 rounded-full ml-2 ${riskData.risk_level === 'CRITICAL' ? 'bg-black/20 backdrop-blur-sm text-white' : 'bg-white/60 backdrop-blur-sm'}`}>
                      {riskData.weather?.source === 'openweathermap' ? '🌐 Live Data' : '📡 Simulated'}
                    </span>
                  </div>
                  <p className={`text-sm font-medium leading-relaxed max-w-3xl ${riskData.risk_level === 'CRITICAL' ? 'text-red-50' : 'text-gray-700'}`}>{riskData.message}</p>
                </div>
                
                <div className="flex flex-wrap gap-2 text-xs font-semibold shrink-0">
                  <span className={`flex items-center gap-1.5 px-3 py-2 rounded-xl ${riskData.risk_level === 'CRITICAL' ? 'bg-black/10' : 'bg-white/60'}`}><FaThermometerHalf /> {riskData.weather?.temp}°C</span>
                  <span className={`flex items-center gap-1.5 px-3 py-2 rounded-xl ${riskData.risk_level === 'CRITICAL' ? 'bg-black/10' : 'bg-white/60'}`}><FaWind /> {riskData.weather?.wind} m/s</span>
                  <span className={`flex items-center gap-1.5 px-3 py-2 rounded-xl ${riskData.risk_level === 'CRITICAL' ? 'bg-black/10' : 'bg-white/60'}`}><FaCloudRain /> {riskData.weather?.rain} mm/h</span>
                  <span className={`flex items-center gap-1.5 px-3 py-2 rounded-xl capitalize ${riskData.risk_level === 'CRITICAL' ? 'bg-black/10' : 'bg-white/60'}`}>{riskData.weather?.desc}</span>
                  {riskData.sos_nearby > 0 && <span className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-red-600 bg-red-100/80`}>🚨 {riskData.sos_nearby} SOS</span>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="lg:grid lg:grid-cols-12 lg:gap-8 items-start">
          
          {/* Left Column (5/12) - Actions & Status */}
          <div className="lg:col-span-5 space-y-8 mb-8 lg:mb-0">
            {/* Status Card */}
            <motion.div variants={itemVariants} className={`p-6 rounded-3xl shadow-lg border relative overflow-hidden ${activeRequest ? (activeRequest.status === 'in-progress' ? 'bg-white border-yellow-300' : 'bg-white border-red-300') : 'bg-white border-gray-100'}`}>
              {activeRequest && (
                 <div className={`absolute top-0 left-0 w-full h-2 ${activeRequest.status === 'in-progress' ? 'bg-yellow-400' : 'bg-red-500'}`}></div>
              )}
              
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Current Status</h3>
              
              {activeRequest ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2">
                  <div className="flex items-center gap-4 mb-5">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${activeRequest.status === 'in-progress' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-500 animate-pulse'}`}>
                      {activeRequest.status === 'in-progress' ? '🚑' : '🚨'}
                    </div>
                    <div>
                      <p className={`text-xl font-black ${activeRequest.status === 'in-progress' ? 'text-yellow-600' : 'text-red-600'}`}>
                        {activeRequest.status === 'in-progress' ? 'Help is on the way!' : 'SOS Active'}
                      </p>
                      <p className="text-sm font-medium text-gray-500 mt-0.5">
                        {activeRequest.status === 'in-progress' ? 'A volunteer has been assigned.' : 'Waiting for a volunteer to respond...'}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(activeRequest.types || [activeRequest.type]).map(t => (
                        <span key={t} className="px-3 py-1 bg-white border border-gray-200 text-gray-700 rounded-full text-xs font-bold uppercase tracking-wide shadow-sm">
                          {t}
                        </span>
                      ))}
                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide shadow-sm text-white ${activeRequest.priority === 'critical' ? 'bg-red-500' : activeRequest.priority === 'low' ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                        {activeRequest.priority} Priority
                      </span>
                    </div>
                    
                    {activeRequest.volunteer_name && (
                      <div className="flex items-center justify-between border-t border-gray-200 pt-3 mt-2">
                        <p className="text-sm text-gray-600 font-medium">Assigned Volunteer:</p>
                        <p className="text-sm font-bold text-gray-900 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">{activeRequest.volunteer_name}</p>
                      </div>
                    )}
                      {activeRequest.volunteer_eta && activeRequest.volunteer_distance_km && (
                        <div className="flex flex-col gap-1 mt-3 text-sm">
                          <span className="text-gray-600">Estimated Arrival: <span className="font-medium">{activeRequest.volunteer_eta} mins</span></span>
                          <span className="text-gray-600">Distance: <span className="font-medium">{activeRequest.volunteer_distance_km} km</span></span>
                        </div>
                      )}
                      {activeRequest.resolution_requested && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="mt-4 p-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl flex flex-col gap-3 shadow-md"
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="text-xl shrink-0">🤝</span>
                            <div>
                              <p className="font-extrabold text-sm text-emerald-950">Confirm Safety & Resolution</p>
                              <p className="text-xs font-semibold text-emerald-800/90 mt-0.5">
                                Volunteer {activeRequest.volunteer_name || 'Mary'} marked this request as resolved. Are you safe and is the emergency resolved?
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex gap-2 mt-1">
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={async () => {
                                try {
                                  await api.put(`/sos/${activeRequest.id}/confirm`);
                                  setToast({ open: true, message: '🎉 Resolution confirmed. Stay safe!', type: 'success' });
                                  fetchRequests();
                                } catch (err) {
                                  setToast({ open: true, message: 'Failed to confirm resolution.', type: 'error' });
                                }
                              }}
                              className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md text-xs transition-colors"
                            >
                              Yes, I am Safe
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={async () => {
                                try {
                                  await api.put(`/sos/${activeRequest.id}/decline`);
                                  setToast({ open: true, message: '⚠️ Resolution declined. SOS request remains active.', type: 'warning' });
                                  fetchRequests();
                                } catch (err) {
                                  setToast({ open: true, message: 'Failed to decline resolution.', type: 'error' });
                                }
                              }}
                              className="flex-1 py-2.5 px-4 bg-white hover:bg-rose-50 border border-rose-200 text-rose-600 rounded-xl font-bold text-xs transition-colors"
                            >
                              No, Still Need Help
                            </motion.button>
                          </div>
                        </motion.div>
                      )}
                  </div>

                  {liveTrackingActive && (
                    <div className="mt-4 flex items-start gap-3 text-sm font-medium text-emerald-800 bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                      <FaSatelliteDish className="animate-pulse text-emerald-600 mt-0.5 text-lg" /> 
                      <p>Live location sharing is active. Volunteers can track your position in real-time until you are safe.</p>
                    </div>
                  )}

                  {nearbyVolunteers.length > 0 && activeRequest?.status === 'pending' && (
                    <div className="mt-3 flex items-start gap-3 text-sm font-medium text-blue-800 bg-blue-50 p-4 rounded-2xl border border-blue-100">
                      <FaUsers className="text-blue-600 mt-0.5 text-lg" />
                      <p>{nearbyVolunteers.length} volunteer{nearbyVolunteers.length > 1 ? 's' : ''} nearby — dispatching to closest first</p>
                    </div>
                  )}

                  {/* Timeline section */}
                  <div className="mt-6 border-t border-gray-100 pt-6">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">SOS Event Timeline</h4>
                    <Timeline timeline={activeRequest.timeline} />
                  </div>
                </motion.div>
              ) : (
                <div className="flex items-center gap-4 py-2">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center text-3xl shadow-inner">
                    ✅
                  </div>
                  <div>
                    <p className="text-xl font-black text-gray-800">You are safe.</p>
                    <p className="text-sm text-gray-500 font-medium mt-0.5">No active emergency requests.</p>
                  </div>
                </div>
              )}
            </motion.div>

            {/* SOS Form */}
            <AnimatePresence>
              {!activeRequest && (
                <motion.div 
                  variants={itemVariants}
                  className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-100 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-red-500 via-rose-400 to-red-500"></div>
                  
                  <div className="mb-6">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight">Request Help</h2>
                    <p className="text-sm text-gray-500 font-medium mt-1">Select the type of emergency and priority level</p>
                  </div>

                  {/* Multi-Type Select */}
                  <div className="mb-6">
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider">
                      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px]">1</span>
                      What do you need?
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {helpTypes.map(type => {
                        const selected = sosTypes.includes(type.id);
                        return (
                          <motion.button 
                            key={type.id} 
                            onClick={() => toggleSosType(type.id)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className={`relative flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-300 overflow-hidden ${selected ? 'shadow-md ring-2 ring-offset-1' : 'border border-gray-200 bg-gray-50 hover:bg-gray-100'}`}
                            style={selected ? { ringColor: type.color } : {}}
                          >
                            {selected && (
                               <div className={`absolute inset-0 opacity-10 bg-gradient-to-br ${type.gradient}`}></div>
                            )}
                            <div className={`mb-2 rounded-full p-2.5 ${selected ? 'text-white shadow-sm' : 'text-gray-400 bg-white'}`}
                                 style={selected ? { background: `linear-gradient(135deg, ${type.color}, ${type.color}dd)` } : {}}>
                              {type.icon}
                            </div>
                            <span className={`text-sm font-bold ${selected ? 'text-gray-900' : 'text-gray-500'}`}>{type.label}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Priority Select */}
                  <div className="mb-6">
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider">
                      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px]">2</span>
                      Severity Level
                    </label>
                    <div className="flex gap-2 bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                      {priorities.map(p => {
                        const isSelected = priority === p.id;
                        return (
                          <motion.button 
                            key={p.id} 
                            onClick={() => setPriority(p.id)}
                            whileTap={{ scale: 0.95 }}
                            className={`flex-1 py-2.5 px-2 rounded-xl font-bold text-xs transition-all duration-300 relative z-10 ${isSelected ? 'shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                            style={isSelected ? { backgroundColor: p.activeBg, color: p.textActive } : {}}
                          >
                            {p.label}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="mb-6">
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider">
                      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px]">3</span>
                      Additional Details <span className="text-gray-400 font-normal normal-case">(Optional)</span>
                    </label>
                    <TextField 
                      multiline 
                      rows={2} 
                      variant="outlined" 
                      fullWidth 
                      placeholder="E.g., 2 children with us, need insulin..." 
                      value={note} 
                      onChange={(e) => setNote(e.target.value)}
                      sx={{ 
                        '& .MuiOutlinedInput-root': { 
                          borderRadius: '1rem',
                          backgroundColor: '#f8fafc',
                          fontSize: '0.875rem',
                          '& fieldset': { borderColor: '#e2e8f0' },
                          '&:hover fieldset': { borderColor: '#cbd5e1' },
                          '&.Mui-focused fieldset': { borderColor: '#ef4444', borderWidth: '2px' }
                        } 
                      }} 
                    />
                  </div>

                  {/* Location Info */}
                  <div className="mb-6 bg-blue-50/50 border border-blue-100 p-3 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm shadow-sm">📍</div>
                      <div>
                        <p className="font-bold text-blue-900 text-xs">GPS Auto-Detected</p>
                        <p className="text-[11px] font-medium text-blue-600/80">
                          {locating ? 'Detecting...' : `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
                        </p>
                      </div>
                    </div>
                    {!locating && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-md">High Accuracy</span>
                    )}
                  </div>

                  <motion.button 
                    whileHover={sosTypes.length > 0 ? { scale: 1.02 } : {}}
                    whileTap={sosTypes.length > 0 ? { scale: 0.98 } : {}}
                    onClick={() => setConfirmOpen(true)} 
                    disabled={sosTypes.length === 0}
                    className={`relative w-full py-4 rounded-2xl text-lg font-black text-white overflow-hidden transition-all duration-300 ${sosTypes.length > 0 ? 'shadow-[0_10px_30px_-10px_rgba(239,68,68,0.6)] hover:shadow-[0_15px_40px_-10px_rgba(239,68,68,0.7)]' : 'bg-gray-200 cursor-not-allowed text-gray-400'}`}
                  >
                    {sosTypes.length > 0 && (
                      <div className="absolute inset-0 bg-gradient-to-r from-red-500 via-rose-500 to-red-600"></div>
                    )}
                    <div className="relative flex items-center justify-center gap-2">
                      <FaExclamationTriangle size={20} className={sosTypes.length > 0 ? 'animate-bounce' : ''} />
                      BROADCAST SOS
                      {sosTypes.length > 0 && (
                        <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded-full backdrop-blur-sm">
                          {sosTypes.length} Selected
                        </span>
                      )}
                    </div>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column (7/12) - Map & Shelters */}
          <div className="lg:col-span-7 h-full flex flex-col">
            <motion.div variants={itemVariants} className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden flex flex-col h-full">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-100 text-indigo-600 rounded-xl shadow-sm">
                    <FaHome size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-gray-900 text-lg leading-tight">Safe Places & Shelters</h3>
                    <p className="text-xs text-gray-500 font-medium">Find refuge and resources nearby</p>
                  </div>
                </div>
                <motion.button 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShelterDialogOpen(true)}
                  className="text-xs font-bold bg-gray-900 text-white px-4 py-2.5 rounded-xl hover:bg-gray-800 transition-colors shadow-md flex items-center gap-1.5"
                >
                  <span>+</span> Mark Safe Place
                </motion.button>
              </div>

              {/* Map - Taller for Desktop */}
              <div className="h-[350px] lg:h-[450px] w-full relative z-0 border-b border-gray-100 shrink-0">
                <MapContainer center={[location.lat, location.lng]} zoom={13} style={{ height: '100%', width: '100%', zIndex: 0 }}>
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
                  <Marker position={[location.lat, location.lng]} icon={userIcon}>
                    <Popup className="font-sans font-bold">📍 Your Location</Popup>
                  </Marker>
                  {shelters.map(s => (
                    <Marker key={s.id} position={[s.lat, s.lng]} icon={shelterIcon}>
                      <Popup className="font-sans">
                        <strong className="text-sm">{s.name}</strong><br />
                        {s.distance_km != null && <span className="text-gray-500 text-xs">{s.distance_km} km away<br /></span>}
                        <div className="mt-1 font-bold text-xs">Capacity: {s.available_spots}/{s.capacity}</div>
                      </Popup>
                    </Marker>
                  ))}
                  {/* Nearby Volunteers */}
                  {nearbyVolunteers.map(vol => (
                    <Marker key={`vol-${vol.volunteer_id}`} position={[vol.lat, vol.lng]} icon={volunteerMapIcon}>
                      <Popup className="font-sans">
                        <strong className="text-sm">🟢 {vol.name || 'Volunteer'}</strong><br />
                        <span className="text-gray-500 text-xs">{vol.distance_km} km away</span>
                      </Popup>
                    </Marker>
                  ))}
                  {locationTrail.length > 1 && <Polyline positions={locationTrail} color="#3b82f6" weight={4} opacity={0.7} dashArray="10, 10" />}
                  {selectedShelter && <Polyline positions={[[location.lat, location.lng], [selectedShelter.lat, selectedShelter.lng]]} color="#10b981" weight={4} opacity={0.8} />}
                  <MapUpdater center={[location.lat, location.lng]} />
                </MapContainer>
                
                {/* Map overlay gradient */}
                <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_20px_rgba(0,0,0,0.05)] z-[400]"></div>
              </div>

              {/* Shelter List */}
              <div className="divide-y divide-gray-100 overflow-y-auto bg-gray-50/50 flex-1 min-h-[250px]">
                {shelters.length === 0 ? (
                   <div className="p-10 text-center flex flex-col items-center justify-center h-full">
                     <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-2xl">🗺️</div>
                     <p className="text-gray-600 font-bold">No safe places marked nearby.</p>
                     <p className="text-sm text-gray-400 mt-1">Be the first to mark a safe place if you know one.</p>
                   </div>
                ) : (
                  shelters.map((s, i) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      key={s.id} 
                      className={`p-5 hover:bg-indigo-50/50 transition-all cursor-pointer relative ${selectedShelter?.id === s.id ? 'bg-indigo-50/80' : ''}`}
                      onClick={() => setSelectedShelter(s)}
                    >
                      {selectedShelter?.id === s.id && (
                        <motion.div layoutId="shelter-indicator" className="absolute left-0 top-0 bottom-0 w-1.5 bg-indigo-500" />
                      )}
                      
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {i === 0 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-black tracking-widest uppercase shadow-sm">Nearest</span>}
                            <h4 className="font-bold text-gray-900 text-base">{s.name}</h4>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2.5">
                            {s.distance_km != null && (
                              <span className="text-xs bg-white border border-gray-200 text-gray-700 px-2.5 py-1 rounded-lg font-bold shadow-sm flex items-center gap-1">
                                📍 {s.distance_km} km
                              </span>
                            )}
                            <span className={`text-xs px-2.5 py-1 rounded-lg font-bold shadow-sm flex items-center gap-1 border ${s.available_spots > 50 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : s.available_spots > 10 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                              <FaUsers size={12} /> {s.available_spots}/{s.capacity} spots
                            </span>
                            {s.has_medical && <span className="text-xs bg-rose-50 text-rose-600 border border-rose-100 px-2.5 py-1 rounded-lg font-bold shadow-sm flex items-center gap-1"><FaMedkit size={12} /> Medical</span>}
                            {s.has_food && <span className="text-xs bg-orange-50 text-orange-600 border border-orange-100 px-2.5 py-1 rounded-lg font-bold shadow-sm flex items-center gap-1"><FaUtensils size={12} /> Food</span>}
                          </div>
                        </div>
                        <motion.button 
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={(e) => { e.stopPropagation(); openRoute(s); }}
                          className="px-4 py-2.5 bg-indigo-600 text-white text-xs font-black rounded-xl hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-600/20 flex items-center gap-1.5 shrink-0"
                        >
                          <FaRoute size={14} /> Nav
                        </motion.button>
                      </div>
                      {s.contact_phone && (
                        <div className="mt-3.5 pt-3 border-t border-gray-100 flex items-center gap-1.5 text-xs font-bold text-gray-500">
                          <FaPhone size={10} className="text-gray-400" /> {s.contact_phone}
                        </div>
                      )}
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Confirmation Dialog */}
      <Dialog 
        open={confirmOpen} 
        onClose={() => setConfirmOpen(false)} 
        PaperProps={{ 
          style: { borderRadius: '1.5rem', padding: '1rem', maxWidth: '400px' } 
        }}
      >
        <div className="text-center pb-2 pt-4">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 animate-bounce">
            🚨
          </div>
          <h2 className="text-2xl font-black text-gray-900">Confirm SOS</h2>
        </div>
        <DialogContent className="text-center">
          <p className="text-gray-600 font-medium mb-4">
            You are sending a <span className="font-bold text-gray-900 uppercase">{priority}</span> priority alert for:
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            {sosTypes.map(t => (
               <span key={t} className="bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded-full text-sm font-bold capitalize">
                 {t}
               </span>
            ))}
          </div>
          <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-xl border border-gray-100">
            Emergency services will be notified with your exact location. Live location tracking will begin immediately.
          </p>
        </DialogContent>
        <DialogActions className="p-4 pt-0 justify-center gap-3">
          <Button onClick={() => setConfirmOpen(false)} sx={{ color: '#64748b', fontWeight: 'bold', borderRadius: '0.75rem', px: 3, py: 1.5 }}>
            Cancel
          </Button>
          <Button 
            onClick={handleSendSOS} 
            variant="contained" 
            disabled={loading} 
            sx={{ backgroundColor: '#ef4444', fontWeight: 'bold', borderRadius: '0.75rem', px: 4, py: 1.5, boxShadow: '0 4px 14px 0 rgba(239, 68, 68, 0.39)', '&:hover': { backgroundColor: '#dc2626' } }} 
            disableElevation
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : 'YES, SEND SOS'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Shelter Dialog */}
      <Dialog 
        open={shelterDialogOpen} 
        onClose={() => setShelterDialogOpen(false)} 
        PaperProps={{ style: { borderRadius: '1.5rem', padding: '1rem', maxWidth: '400px', width: '100%' } }}
      >
        <div className="flex items-center gap-3 pb-2 pt-4 px-6 border-b border-gray-100">
          <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center text-xl">
            <FaHome />
          </div>
          <h2 className="text-xl font-black text-gray-900">Mark Safe Place</h2>
        </div>
        <DialogContent className="mt-4">
          <p className="mb-6 text-sm font-medium text-gray-500">
            Help others by marking a secure location with available resources.
          </p>
          <div className="space-y-4">
            <TextField 
              autoFocus 
              label="Location Name" 
              fullWidth 
              variant="outlined" 
              value={newShelterName} 
              onChange={(e) => setNewShelterName(e.target.value)} 
              placeholder="e.g. Community Hall, School..." 
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '1rem' } }}
            />
            <TextField 
              type="number" 
              label="Estimated Capacity (People)" 
              fullWidth 
              variant="outlined" 
              value={newShelterCapacity} 
              onChange={(e) => setNewShelterCapacity(Number(e.target.value))} 
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '1rem' } }}
            />
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 mt-2">
              <p className="text-sm font-bold text-gray-700 mb-3">Available Resources:</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" checked={newShelterMedical} onChange={(e) => setNewShelterMedical(e.target.checked)} /> 
                  <span className="text-sm font-bold text-gray-700 flex items-center gap-1"><FaMedkit className="text-rose-500"/> Medical</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" checked={newShelterFood} onChange={(e) => setNewShelterFood(e.target.checked)} /> 
                  <span className="text-sm font-bold text-gray-700 flex items-center gap-1"><FaUtensils className="text-orange-500"/> Food/Water</span>
                </label>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogActions className="p-6 pt-4 border-t border-gray-100">
          <Button onClick={() => setShelterDialogOpen(false)} sx={{ color: '#64748b', fontWeight: 'bold', borderRadius: '0.75rem' }}>
            Cancel
          </Button>
          <Button 
            onClick={handleAddShelter} 
            variant="contained" 
            disabled={loading} 
            sx={{ backgroundColor: '#4f46e5', fontWeight: 'bold', borderRadius: '0.75rem', px: 3, '&:hover': { backgroundColor: '#4338ca' } }} 
            disableElevation
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : 'Save Location'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar 
        open={toast.open} 
        autoHideDuration={4000} 
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          severity={toast.type} 
          variant="filled" 
          sx={{ width: '100%', borderRadius: '1rem', fontWeight: 'bold', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </div>
  );
};

function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => { map.setView(center); }, [center, map]);
  return null;
}

export default CitizenPortal;
