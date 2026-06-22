import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import { FaMapMarkedAlt, FaCheck, FaTimes, FaSpinner, FaSignOutAlt, FaBreadSlice, FaBriefcaseMedical, FaTruck, FaLifeRing, FaHome, FaSatelliteDish, FaBroadcastTower, FaClock } from 'react-icons/fa';
import { Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@mui/material';
import api from '../api';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { socket, connectSocket, disconnectSocket, safeEmit } from '../socket';
import Timeline from '../components/Timeline';

const volunteerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const VolunteerPortal = () => {
  const [requests, setRequests] = useState([]);
  const [resources, setResources] = useState({ food_kits: 0, medical_kits: 0, vehicles: 0 });
  const [mapCenter, setMapCenter] = useState([30.8775, 76.8740]);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [locationTrails, setLocationTrails] = useState({});
  const [volunteerLocation, setVolunteerLocation] = useState(null);
  
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [broadcastAlerts, setBroadcastAlerts] = useState([]);
  const [dispatchRing, setDispatchRing] = useState(null);
  const [dispatchCountdown, setDispatchCountdown] = useState(0);
  const countdownRef = useRef(null);

  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user'));

  const typeIcons = {
    food: <FaBreadSlice className="text-yellow-600" />,
    medical: <FaBriefcaseMedical className="text-red-500" />,
    rescue: <FaLifeRing className="text-blue-500" />,
    shelter: <FaHome className="text-purple-500" />,
  };

  const priorityStyles = {
    critical: { bg: '#fef2f2', color: '#ef4444', border: '#fecaca', label: '🔴 CRITICAL' },
    medium: { bg: '#fffbeb', color: '#f59e0b', border: '#fde68a', label: '🟡 MEDIUM' },
    low: { bg: '#f0fdf4', color: '#22c55e', border: '#bbf7d0', label: '🟢 LOW' },
  };

  const fetchRequests = async () => {
    try {
      const res = await api.get('/sos');
      const sorted = res.data.sort((a, b) => {
        if (a.status === 'resolved' && b.status !== 'resolved') return 1;
        if (a.status !== 'resolved' && b.status === 'resolved') return -1;
        // Critical priority first
        const pOrder = { critical: 0, medium: 1, low: 2 };
        if (a.status !== 'resolved' && b.status !== 'resolved') {
          const pa = pOrder[a.priority] ?? 1;
          const pb = pOrder[b.priority] ?? 1;
          if (pa !== pb) return pa - pb;
        }
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      setRequests(sorted);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await api.get('/alerts');
      setBroadcastAlerts(res.data);
    } catch (err) { console.error('Alert fetch failed', err); }
  };

  useEffect(() => {
    fetchRequests();
    fetchAlerts();

    const pollInterval = setInterval(() => {
      fetchRequests();
      fetchAlerts();
    }, 8000);

    const handleOnline = () => {
      setIsOnline(true);
      fetchRequests();
      fetchAlerts();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // WebSockets Connections and Live Listener
  useEffect(() => {
    connectSocket();

    socket.on('sos_created', (newSos) => {
      setRequests(prev => {
        if (prev.some(r => r.id === newSos.id)) return prev;
        const updated = [newSos, ...prev];
        return updated.sort((a, b) => {
          if (a.status === 'resolved' && b.status !== 'resolved') return 1;
          if (a.status !== 'resolved' && b.status === 'resolved') return -1;
          const pOrder = { critical: 0, medium: 1, low: 2 };
          if (a.status !== 'resolved' && b.status !== 'resolved') {
            const pa = pOrder[a.priority] ?? 1;
            const pb = pOrder[b.priority] ?? 1;
            if (pa !== pb) return pa - pb;
          }
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
      });
    });

    socket.on('sos_updated', (updatedSos) => {
      setRequests(prev => {
        const idx = prev.findIndex(r => r.id === updatedSos.id);
        if (idx === -1) return [updatedSos, ...prev];
        const copy = [...prev];
        copy[idx] = updatedSos;
        return copy.sort((a, b) => {
          if (a.status === 'resolved' && b.status !== 'resolved') return 1;
          if (a.status !== 'resolved' && b.status === 'resolved') return -1;
          const pOrder = { critical: 0, medium: 1, low: 2 };
          if (a.status !== 'resolved' && b.status !== 'resolved') {
            const pa = pOrder[a.priority] ?? 1;
            const pb = pOrder[b.priority] ?? 1;
            if (pa !== pb) return pa - pb;
          }
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
      });
    });

    socket.on('location_updated', (data) => {
      if (data.sos_id) {
        setLocationTrails(prev => {
          const existing = prev[data.sos_id] || [];
          return {
            ...prev,
            [data.sos_id]: [...existing, [data.lat, data.lng]]
          };
        });
      }
    });

    socket.on('broadcast_alert', (newAlert) => {
      setBroadcastAlerts(prev => [newAlert, ...prev]);
    });

    socket.on('sos_dispatch_ring', (data) => {
      if (data.volunteer_target_id === user?.id) {
        setDispatchRing(data);
        setDispatchCountdown(data.deadline_seconds || 20);
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
          setDispatchCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownRef.current);
              setDispatchRing(null);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    });

    socket.on('sos_dispatch_timeout', (data) => {
      if (data.volunteer_target_id === user?.id) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        setDispatchRing(null);
        setDispatchCountdown(0);
      }
    });

    return () => {
      socket.off('sos_created');
      socket.off('sos_updated');
      socket.off('location_updated');
      socket.off('broadcast_alert');
      socket.off('sos_dispatch_ring');
      socket.off('sos_dispatch_timeout');
      disconnectSocket();
    };
  }, []);

  // Track volunteer's own live location & emit to server
  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setVolunteerLocation(loc);
          setMapCenter(prev => {
            // If the map center is still set to the default Chandigarh coords, snap to current location
            if (prev[0] === 30.8775 && prev[1] === 76.8740) {
              return [loc.lat, loc.lng];
            }
            return prev;
          });
          if (socket.connected) {
            safeEmit('volunteer_location_update', {
              volunteer_id: user?.id,
              lat: loc.lat,
              lng: loc.lng,
              name: user?.name || ''
            });
          }
        },
        (err) => console.error('Error tracking volunteer location', err),
        { enableHighAccuracy: true, maximumAge: 0 }
      );
      const emitInterval = setInterval(() => {
        setVolunteerLocation(prev => {
          if (prev && socket.connected) {
            safeEmit('volunteer_location_update', {
              volunteer_id: user?.id,
              lat: prev.lat,
              lng: prev.lng,
              name: user?.name || ''
            });
          }
          return prev;
        });
      }, 10000);
      return () => {
        navigator.geolocation.clearWatch(watchId);
        clearInterval(emitInterval);
      };
    }
  }, []);

  // Fetch location trails for in-progress requests assigned to this volunteer
  useEffect(() => {
    const fetchTrails = async () => {
      const myActive = requests.filter(r => r.status === 'in-progress' && r.assigned_volunteer === user.id);
      const trails = {};
      for (const req of myActive) {
        try {
          const res = await api.get(`/sos/${req.id}/location`);
          if (res.data.length > 0) trails[req.id] = res.data.map(l => [l.lat, l.lng]);
        } catch (e) { /* ignore */ }
      }
      setLocationTrails(trails);
    };
    if (requests.length > 0) fetchTrails();
  }, [requests]);

  const handleAccept = async (id) => {
    try {
      const payload = {};
      if (volunteerLocation) {
        payload.volunteer_lat = volunteerLocation.lat;
        payload.volunteer_lng = volunteerLocation.lng;
      }
      await api.put(`/sos/${id}/accept`, payload);
      fetchRequests();
    } catch (err) {
      console.error(err);
    }
  };

  const handleStatusUpdate = async (id, status) => {
    try { await api.put(`/sos/${id}/status`, { status }); fetchRequests(); } catch (err) { console.error(err); }
  };

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); navigate('/'); };

  const handleDispatchAccept = async (sosId) => {
    try {
      const payload = {};
      if (volunteerLocation) {
        payload.volunteer_lat = volunteerLocation.lat;
        payload.volunteer_lng = volunteerLocation.lng;
      }
      await api.put(`/sos/${sosId}/accept`, payload);
      if (countdownRef.current) clearInterval(countdownRef.current);
      setDispatchRing(null);
      setDispatchCountdown(0);
      fetchRequests();
    } catch (err) {
      console.error("Accept failed, clearing overlay anyway:", err);
      if (countdownRef.current) clearInterval(countdownRef.current);
      setDispatchRing(null);
      setDispatchCountdown(0);
      fetchRequests();
    }
  };

  const handleDispatchDecline = async (sosId) => {
    try {
      await api.post(`/sos/${sosId}/decline_dispatch`);
      if (countdownRef.current) clearInterval(countdownRef.current);
      setDispatchRing(null);
      setDispatchCountdown(0);
    } catch (err) {
      console.error("Decline failed, clearing overlay anyway:", err);
      if (countdownRef.current) clearInterval(countdownRef.current);
      setDispatchRing(null);
      setDispatchCountdown(0);
      fetchRequests();
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'error';
      case 'in-progress': return 'warning';
      case 'resolved': return 'success';
      default: return 'default';
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <style>{`
        @keyframes dispatchFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dispatchPulse { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.1); opacity: 1; } }
        @keyframes dispatchBounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }
      `}</style>
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b px-6 py-3 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold text-sm">IRL</div>
          <span className="font-bold text-xl text-gray-800">Volunteer Dashboard</span>
          <button onClick={() => setResourceOpen(true)} className="ml-6 px-4 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors border border-blue-200">
            Manage Resources
          </button>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-600 border-r pr-4">{user?.name}</span>
          <button onClick={handleLogout} className="text-gray-500 hover:text-gray-800 flex items-center gap-2 text-sm font-medium">
            <FaSignOutAlt /> Logout
          </button>
        </div>
      </nav>

      {/* Split Screen Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Map View (Left) */}
        <div className="w-1/2 h-full relative z-0 border-r border-gray-200 shadow-inner">
          <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            
            {volunteerLocation && (
              <Marker position={[volunteerLocation.lat, volunteerLocation.lng]} icon={volunteerIcon}>
                <Popup><strong>📍 Your Live Location</strong></Popup>
              </Marker>
            )}

            {requests.filter(r => r.status !== 'resolved').map(req => (
              <Marker key={req.id} position={[req.location.lat, req.location.lng]}>
                <Popup>
                  <div className="font-semibold">{req.user_name}</div>
                  <div className="capitalize text-sm">{(req.types || [req.type]).join(', ')}</div>
                  <div className="text-xs mt-1" style={{ color: (priorityStyles[req.priority] || priorityStyles.medium).color }}>
                    {(priorityStyles[req.priority] || priorityStyles.medium).label}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{new Date(req.timestamp).toLocaleTimeString()}</div>
                </Popup>
              </Marker>
            ))}
            {/* Live location trails for citizens */}
            {Object.entries(locationTrails).map(([sosId, trail]) => (
              trail.length > 1 && <Polyline key={`trail-${sosId}`} positions={trail} color="#3b82f6" weight={3} dashArray="8" />
            ))}
            
            {/* Draw direct line from Volunteer to assigned in-progress Citizen */}
            {volunteerLocation && requests.filter(r => r.status === 'in-progress' && r.assigned_volunteer === user.id).map(req => (
              <Polyline key={`nav-${req.id}`} positions={[[volunteerLocation.lat, volunteerLocation.lng], [req.location.lat, req.location.lng]]} color="#22c55e" weight={4} dashArray="10" />
            ))}

            <MapUpdater center={mapCenter} />
          </MapContainer>
        </div>

        {/* Request List (Right) */}
        <div className="w-1/2 h-full overflow-y-auto bg-gray-50 p-6">
          {/* Offline mode indicator */}
          {!isOnline && (
            <div className="mb-4 p-3 bg-amber-500 text-white rounded-xl text-xs font-bold shadow flex items-center justify-between border border-amber-600">
              <span>⚠️ Running in Offline Mode (Using Cached Data)</span>
              <span className="bg-black/20 px-2 py-0.5 rounded text-[10px]">Local Cache</span>
            </div>
          )}

          {/* Broadcast alerts banner list */}
          {broadcastAlerts.length > 0 && (
            <div className="mb-4 space-y-2">
              {broadcastAlerts.slice(0, 2).map(alert => (
                <div key={alert.id} className={`p-4 rounded-xl shadow-sm border flex items-center justify-between gap-4 ${
                  alert.risk_level === 'CRITICAL' ? 'bg-red-600 border-red-700 text-white animate-pulse' :
                  alert.risk_level === 'HIGH' ? 'bg-orange-50 border-orange-200 text-orange-950' :
                  'bg-amber-50 border-amber-200 text-amber-950'
                }`}>
                  <div className="flex-1">
                    <div className="font-extrabold text-[11px] uppercase tracking-wider opacity-90">📢 Broadcast Alert {alert.area ? `— ${alert.area}` : ''}</div>
                    <div className="text-xs font-bold leading-relaxed mt-1">{alert.message}</div>
                  </div>
                  <button onClick={() => setBroadcastAlerts(prev => prev.filter(a => a.id !== alert.id))} className="text-sm font-black opacity-80 hover:opacity-100">×</button>
                </div>
              ))}
            </div>
          )}

          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Active Requests
          </h2>
          
          <div className="space-y-4">
            {requests.map(req => {
              const pStyle = priorityStyles[req.priority] || priorityStyles.medium;
              return (
              <div key={req.id} className={`p-5 bg-white rounded-xl shadow-sm border-l-4 hover:shadow-md transition-shadow ${req.status === 'pending' ? (req.priority === 'critical' ? 'border-red-600' : 'border-red-400') : req.status === 'in-progress' ? 'border-yellow-400' : 'border-green-400 opacity-70'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{req.user_name || 'Citizen'} <span className="text-sm font-normal text-gray-500">#{req.id}</span></h3>
                    <p className="text-sm text-gray-600 mt-0.5">{req.user_phone}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Chip label={req.status.replace('-', ' ').toUpperCase()} size="small" color={getStatusColor(req.status)} className="font-bold" />
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: pStyle.bg, color: pStyle.color, border: `1px solid ${pStyle.border}` }}>
                      {pStyle.label}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {(req.types || [req.type]).map(t => (
                    <div key={t} className="px-3 py-1 bg-gray-100 rounded-md text-sm font-medium capitalize flex items-center gap-2 text-gray-700">
                      {typeIcons[t] || null} {t}
                    </div>
                  ))}
                  <button onClick={() => setMapCenter([req.location.lat, req.location.lng])}
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1 ml-auto">
                    📍 Show on Map
                  </button>
                </div>

                {req.status === 'in-progress' && req.assigned_volunteer === user.id && locationTrails[req.id] && (
                  <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200 mb-3">
                    <FaSatelliteDish className="animate-pulse" /> Live tracking active — {locationTrails[req.id].length} location updates received
                  </div>
                )}

                {req.description && (
                  <p className="text-sm text-gray-600 mb-4 bg-gray-50 p-3 rounded border border-gray-100 italic">"{req.description}"</p>
                )}

                {req.timeline && req.timeline.length > 0 && (
                  <div className="mb-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Event Timeline</h4>
                    <Timeline timeline={req.timeline} />
                  </div>
                )}

                {/* Actions */}
                <div className="mt-4 pt-4 border-t border-gray-100 flex gap-3">
                  {req.status === 'pending' && (
                    <>
                      <Button variant="contained" onClick={() => handleAccept(req.id)} style={{ backgroundColor: '#3b82f6' }} disableElevation className="flex-1 font-bold">
                        Accept Request
                      </Button>
                      <Button variant="outlined" color="inherit" className="flex-1 text-gray-600">
                        Ignore
                      </Button>
                    </>
                  )}
                  {req.status === 'in-progress' && req.assigned_volunteer === user.id && (
                    <>
                      {req.resolution_requested ? (
                        <div className="flex-1 text-center py-2.5 px-4 bg-amber-50 text-amber-800 font-extrabold rounded-xl border border-amber-200 animate-pulse text-xs uppercase tracking-wider flex items-center justify-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                          Awaiting Citizen Confirmation
                        </div>
                      ) : (
                        <Button variant="contained" color="success" onClick={() => handleStatusUpdate(req.id, 'resolved')} disableElevation className="flex-1 font-bold">
                          <FaCheck className="mr-2" /> Mark Resolved
                        </Button>
                      )}
                      <Button variant="outlined" color="primary" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${req.location.lat},${req.location.lng}`, '_blank')} className="flex-1 font-bold">
                        <FaMapMarkedAlt className="mr-2" /> Navigate
                      </Button>
                    </>
                  )}
                  {req.status === 'in-progress' && req.assigned_volunteer !== user.id && (
                    <div className="text-sm text-gray-500 italic">Being handled by another volunteer.</div>
                  )}
                </div>
              </div>
            );})}
            {requests.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-lg">No active requests right now.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resource Modal */}

      {/* Dispatch Ring Overlay */}
      {dispatchRing && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'dispatchFadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)',
            borderRadius: '2rem', padding: '2.5rem', maxWidth: '420px', width: '90%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3)',
            position: 'relative', overflow: 'hidden'
          }}>
            <div style={{
              position: 'absolute', top: '-50%', left: '-50%', width: '200%', height: '200%',
              background: 'radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)',
              animation: 'dispatchPulse 1.5s ease-in-out infinite'
            }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem', animation: 'dispatchBounce 0.6s ease-in-out infinite alternate' }}>🚨</div>
                <h2 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>INCOMING SOS</h2>
                <p style={{ color: 'rgba(199,210,254,0.8)', fontSize: '0.8rem', marginTop: '0.25rem', fontWeight: 600 }}>Emergency assistance needed nearby</p>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '1.25rem', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.1)', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ color: '#c7d2fe', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Citizen</span>
                  <span style={{ background: dispatchRing.priority === 'critical' ? '#ef4444' : dispatchRing.priority === 'medium' ? '#f59e0b' : '#22c55e', color: '#fff', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }}>{dispatchRing.priority}</span>
                </div>
                <p style={{ color: '#fff', fontWeight: 800, fontSize: '1.1rem', margin: '0 0 0.5rem 0' }}>{dispatchRing.citizen_name}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {(dispatchRing.types || []).map(t => (
                    <span key={t} style={{ background: 'rgba(255,255,255,0.12)', color: '#e0e7ff', padding: '0.3rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'capitalize' }}>{t}</span>
                  ))}
                </div>
                {dispatchRing.description && (
                  <p style={{ color: 'rgba(199,210,254,0.7)', fontSize: '0.75rem', marginTop: '0.75rem', fontStyle: 'italic' }}>"{dispatchRing.description}"</p>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '1rem', padding: '0.6rem 1.2rem', textAlign: 'center' }}>
                  <span style={{ color: '#6ee7b7', fontSize: '1.25rem', fontWeight: 900, display: 'block' }}>{dispatchRing.distance_km} km</span>
                  <span style={{ color: 'rgba(167,243,208,0.7)', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase' }}>Distance</span>
                </div>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'rgba(199,210,254,0.6)', fontSize: '0.7rem', fontWeight: 700 }}>Respond before timeout</span>
                  <span style={{ color: dispatchCountdown <= 5 ? '#ef4444' : '#fbbf24', fontSize: '1.1rem', fontWeight: 900, fontFamily: 'monospace' }}>{dispatchCountdown}s</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '999px', height: '6px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: '999px', width: `${(dispatchCountdown / (dispatchRing.deadline_seconds || 20)) * 100}%`, background: dispatchCountdown <= 5 ? 'linear-gradient(90deg, #ef4444, #f87171)' : 'linear-gradient(90deg, #fbbf24, #f59e0b)', transition: 'width 1s linear' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => handleDispatchAccept(dispatchRing.sos_id)} style={{ flex: 1, padding: '1rem', borderRadius: '1rem', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', fontWeight: 900, fontSize: '0.9rem', letterSpacing: '0.02em', boxShadow: '0 4px 15px rgba(34,197,94,0.4)', transition: 'transform 0.15s, box-shadow 0.15s' }}>✓ Accept</button>
                <button onClick={() => handleDispatchDecline(dispatchRing.sos_id)} style={{ flex: 1, padding: '1rem', borderRadius: '1rem', border: '2px solid rgba(255,255,255,0.2)', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)', fontWeight: 800, fontSize: '0.9rem', transition: 'transform 0.15s, background 0.15s' }}>✗ Decline</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={resourceOpen} onClose={() => setResourceOpen(false)}>
        <DialogTitle className="font-bold border-b">Manage Your Resources</DialogTitle>
        <DialogContent className="pt-6 pb-2 min-w-[350px]">
          <div className="space-y-4 pt-2">
            <TextField label="Food Kits" type="number" fullWidth defaultValue={20} InputProps={{ startAdornment: <FaBreadSlice className="mr-3 text-gray-400" /> }} />
            <TextField label="Medical Kits" type="number" fullWidth defaultValue={10} InputProps={{ startAdornment: <FaBriefcaseMedical className="mr-3 text-gray-400" /> }} />
            <TextField label="Vehicles/Boats" type="number" fullWidth defaultValue={2} InputProps={{ startAdornment: <FaTruck className="mr-3 text-gray-400" /> }} />
          </div>
        </DialogContent>
        <DialogActions className="p-4 border-t">
          <Button onClick={() => setResourceOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => setResourceOpen(false)} style={{ backgroundColor: '#22c55e' }} disableElevation>Update Inventory</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => { map.setView(center); }, [center, map]);
  return null;
}

export default VolunteerPortal;
