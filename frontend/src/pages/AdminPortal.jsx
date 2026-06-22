import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { FaChartPie, FaUsers, FaMap, FaSignOutAlt, FaExclamationTriangle, FaChartLine, FaThermometerHalf, FaWind, FaCloudRain, FaBroadcastTower } from 'react-icons/fa';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip, Dialog, DialogContent, DialogActions, Button, TextField } from '@mui/material';
import api from '../api';
import 'leaflet/dist/leaflet.css';
import { socket, connectSocket, disconnectSocket } from '../socket';
import Timeline from '../components/Timeline';

const AdminPortal = () => {
  const [stats, setStats] = useState({ total: 0, pending: 0, in_progress: 0, resolved: 0 });
  const [requests, setRequests] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [riskHistory, setRiskHistory] = useState([]);
  const [currentRisk, setCurrentRisk] = useState(null);
  
  const [broadcasts, setBroadcasts] = useState([]);
  const [newBroadcast, setNewBroadcast] = useState({ message: '', risk_level: 'HIGH', area: '' });
  const [selectedSos, setSelectedSos] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user'));

  useEffect(() => {
    fetchData();
    fetchBroadcasts();

    const handleOnline = () => {
      setIsOnline(true);
      fetchData();
      fetchBroadcasts();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fetchBroadcasts = async () => {
    try {
      const res = await api.get('/alerts');
      setBroadcasts(res.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    connectSocket();

    socket.on('sos_created', (newSos) => {
      setRequests(prev => [newSos, ...prev]);
      api.get('/stats').then(res => setStats(res.data)).catch(e => {});
    });

    socket.on('sos_updated', (updatedSos) => {
      setRequests(prev => {
        const copy = [...prev];
        const idx = copy.findIndex(r => r.id === updatedSos.id);
        if (idx !== -1) {
          copy[idx] = updatedSos;
        } else {
          copy.unshift(updatedSos);
        }
        return copy;
      });
      api.get('/stats').then(res => setStats(res.data)).catch(e => {});
      setSelectedSos(prev => prev && prev.id === updatedSos.id ? updatedSos : prev);
    });

    return () => {
      socket.off('sos_created');
      socket.off('sos_updated');
      disconnectSocket();
    };
  }, []);

  const fetchData = async () => {
    try {
      const statsRes = await api.get('/stats');
      setStats(statsRes.data);
      const reqRes = await api.get('/sos');
      setRequests(reqRes.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (activeTab === 'risk') fetchRiskData();
  }, [activeTab]);

  const fetchRiskData = async () => {
    try {
      const [histRes, curRes] = await Promise.all([
        api.get('/risk/history?limit=30'),
        api.post('/risk', { lat: 28.61, lon: 77.23 })
      ]);
      setRiskHistory(histRes.data);
      setCurrentRisk(curRes.data);
    } catch (err) { console.error(err); }
  };

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); navigate('/'); };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'error';
      case 'in-progress': return 'warning';
      case 'resolved': return 'success';
      default: return 'default';
    }
  };

  const riskLevelColor = (level) => {
    switch (level) {
      case 'CRITICAL': return { bg: '#7f1d1d', text: '#fecaca', chip: 'error' };
      case 'HIGH': return { bg: '#fef2f2', text: '#dc2626', chip: 'error' };
      case 'MEDIUM': return { bg: '#fffbeb', text: '#d97706', chip: 'warning' };
      default: return { bg: '#f0fdf4', text: '#16a34a', chip: 'success' };
    }
  };

  const riskCounts = riskHistory.reduce((acc, r) => {
    acc[r.risk_level] = (acc[r.risk_level] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 text-white flex flex-col shrink-0 shadow-xl z-20">
        <div className="p-6 flex items-center gap-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center font-bold text-lg shadow-lg">RL</div>
          <div>
            <span className="font-bold text-xl block">ReliefLink</span>
            <span className="text-xs text-slate-400">Admin Control Center</span>
          </div>
        </div>
        
        <div className="p-4 flex-1">
          <ul className="space-y-2">
            {[
              { id: 'dashboard', icon: <FaChartPie />, label: 'Dashboard Overview' },
              { id: 'map', icon: <FaMap />, label: 'Geographic View' },
              { id: 'requests', icon: <FaUsers />, label: 'All Requests' },
              { id: 'risk', icon: <FaExclamationTriangle />, label: 'Risk Analytics' },
              { id: 'broadcasts', icon: <FaBroadcastTower />, label: 'Broadcast Alerts' },
            ].map(tab => (
              <li key={tab.id}>
                <button onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}>
                  {tab.icon} {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold">{user?.name.charAt(0)}</div>
            <div className="flex-1">
              <div className="text-sm font-medium text-white">{user?.name}</div>
              <div className="text-xs text-slate-400 capitalize">{user?.role}</div>
            </div>
          </div>
          <button onClick={handleLogout} className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-red-600 hover:text-white text-slate-300 rounded-lg transition-colors text-sm font-medium">
            <FaSignOutAlt /> Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <header className="bg-white px-8 py-5 shadow-sm border-b border-gray-200 flex justify-between items-center sticky top-0 z-10">
          <h1 className="text-2xl font-bold text-gray-800 capitalize flex items-center gap-2">
            {activeTab === 'dashboard' && <><FaChartPie className="text-blue-500" /> Overview</>}
            {activeTab === 'map' && <><FaMap className="text-blue-500" /> Live Map</>}
            {activeTab === 'requests' && <><FaUsers className="text-blue-500" /> Request Management</>}
            {activeTab === 'risk' && <><FaExclamationTriangle className="text-blue-500" /> Risk Analytics</>}
          </h1>
          <div className="text-sm font-medium text-gray-500 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></span>
            {isOnline ? 'System Online' : 'Operating Offline'} • {new Date().toLocaleTimeString()}
          </div>
        </header>

        <div className="p-8">
          
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
                  <div className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Total Incidents</div>
                  <div className="text-4xl font-black text-gray-800">{stats.total}</div>
                  <div className="mt-auto pt-4 flex items-center text-sm text-blue-600 font-medium"><FaChartLine className="mr-1"/> All time</div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border-b-4 border-red-500 flex flex-col">
                  <div className="text-sm font-bold text-red-500 uppercase tracking-wider mb-2">Pending SOS</div>
                  <div className="text-4xl font-black text-gray-800">{stats.pending}</div>
                  <div className="mt-auto pt-4 text-sm text-gray-500 font-medium">Require immediate action</div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border-b-4 border-yellow-400 flex flex-col">
                  <div className="text-sm font-bold text-yellow-600 uppercase tracking-wider mb-2">In Progress</div>
                  <div className="text-4xl font-black text-gray-800">{stats.in_progress}</div>
                  <div className="mt-auto pt-4 text-sm text-gray-500 font-medium">Volunteers dispatched</div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border-b-4 border-green-500 flex flex-col">
                  <div className="text-sm font-bold text-green-600 uppercase tracking-wider mb-2">Resolved</div>
                  <div className="text-4xl font-black text-gray-800">{stats.resolved}</div>
                  <div className="mt-auto pt-4 text-sm text-gray-500 font-medium">Successfully completed</div>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                  <h3 className="font-bold text-lg text-gray-800">Critical Ongoing Incidents</h3>
                  <button onClick={() => setActiveTab('requests')} className="text-sm text-blue-600 font-medium hover:underline">View All</button>
                </div>
                <TableContainer>
                  <Table>
                    <TableHead className="bg-gray-50">
                      <TableRow>
                        <TableCell className="font-semibold text-gray-600">ID</TableCell>
                        <TableCell className="font-semibold text-gray-600">Citizen</TableCell>
                        <TableCell className="font-semibold text-gray-600">Need</TableCell>
                        <TableCell className="font-semibold text-gray-600">Priority</TableCell>
                        <TableCell className="font-semibold text-gray-600">Status</TableCell>
                        <TableCell className="font-semibold text-gray-600">Volunteer</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {requests.filter(r => r.status !== 'resolved').slice(0, 5).map((row) => (
                        <TableRow key={row.id} hover onClick={() => setSelectedSos(row)} className="cursor-pointer">
                          <TableCell className="font-medium text-gray-900">#{row.id}</TableCell>
                          <TableCell>{row.user_name}</TableCell>
                          <TableCell className="capitalize">{(row.types || [row.type]).join(', ')}</TableCell>
                          <TableCell>
                            <Chip label={(row.priority || 'medium').toUpperCase()} size="small"
                              color={row.priority === 'critical' ? 'error' : row.priority === 'low' ? 'success' : 'warning'} variant="outlined" />
                          </TableCell>
                          <TableCell><Chip label={row.status} size="small" color={getStatusColor(row.status)} /></TableCell>
                          <TableCell>{row.volunteer_name || <span className="text-gray-400 italic">Unassigned</span>}</TableCell>
                        </TableRow>
                      ))}
                      {requests.filter(r => r.status !== 'resolved').length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-500">No ongoing incidents.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            </div>
          )}

          {activeTab === 'map' && (
            <div className="h-[calc(100vh-160px)] bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative z-0">
              <MapContainer center={[28.61, 77.23]} zoom={11} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {requests.map(req => (
                  <Marker key={req.id} position={[req.location.lat, req.location.lng]}>
                    <Popup>
                      <div className="font-bold">#{req.id} - {(req.types || [req.type]).join(', ').toUpperCase()}</div>
                      <div className="text-sm mt-1">Status: <span className="capitalize font-medium">{req.status}</span></div>
                      <div className="text-xs mt-1">Priority: <span className="capitalize font-medium">{req.priority || 'medium'}</span></div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <TableContainer>
                <Table>
                  <TableHead className="bg-gray-50">
                    <TableRow>
                      <TableCell className="font-bold text-gray-700">ID</TableCell>
                      <TableCell className="font-bold text-gray-700">Time</TableCell>
                      <TableCell className="font-bold text-gray-700">Citizen Info</TableCell>
                      <TableCell className="font-bold text-gray-700">Type</TableCell>
                      <TableCell className="font-bold text-gray-700">Priority</TableCell>
                      <TableCell className="font-bold text-gray-700">Location</TableCell>
                      <TableCell className="font-bold text-gray-700">Status</TableCell>
                      <TableCell className="font-bold text-gray-700">Assigned To</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {requests.map((row) => (
                      <TableRow key={row.id} hover onClick={() => setSelectedSos(row)} className="cursor-pointer">
                        <TableCell className="font-medium text-gray-900">#{row.id}</TableCell>
                        <TableCell className="text-sm text-gray-500">{new Date(row.timestamp).toLocaleTimeString()}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.user_name}</div>
                          <div className="text-xs text-gray-500">{row.user_phone}</div>
                        </TableCell>
                        <TableCell className="capitalize font-medium text-gray-700">{(row.types || [row.type]).join(', ')}</TableCell>
                        <TableCell>
                          <Chip label={(row.priority || 'medium').toUpperCase()} size="small"
                            color={row.priority === 'critical' ? 'error' : row.priority === 'low' ? 'success' : 'warning'} variant="outlined" />
                        </TableCell>
                        <TableCell className="text-xs font-mono text-gray-500">
                          {row.location.lat.toFixed(4)}, {row.location.lng.toFixed(4)}
                        </TableCell>
                        <TableCell>
                          <Chip label={row.status.toUpperCase()} size="small" color={getStatusColor(row.status)} className="font-bold text-xs" />
                        </TableCell>
                        <TableCell>{row.volunteer_name || <span className="text-gray-400 italic">-</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
          )}

          {activeTab === 'risk' && (
            <div className="space-y-6">
              {/* Current Risk Card */}
              {currentRisk && (
                <div className={`p-6 rounded-2xl shadow-sm border-2 ${
                  currentRisk.risk_level === 'CRITICAL' ? 'bg-red-600 border-red-700 text-white' :
                  currentRisk.risk_level === 'HIGH' ? 'bg-red-50 border-red-300' :
                  currentRisk.risk_level === 'MEDIUM' ? 'bg-yellow-50 border-yellow-300' :
                  'bg-green-50 border-green-200'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    <FaExclamationTriangle size={24} className={currentRisk.risk_level === 'CRITICAL' ? 'text-white' : ''} />
                    <div>
                      <h3 className="text-2xl font-black">{currentRisk.risk_level} — {currentRisk.risk_type}</h3>
                      <p className={`text-sm mt-1 ${currentRisk.risk_level === 'CRITICAL' ? 'text-red-100' : 'text-gray-600'}`}>{currentRisk.message}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 mt-4">
                    <div className={`p-3 rounded-xl ${currentRisk.risk_level === 'CRITICAL' ? 'bg-red-700' : 'bg-white'} text-center`}>
                      <FaThermometerHalf className="mx-auto mb-1" />
                      <div className="text-lg font-bold">{currentRisk.weather?.temp}°C</div>
                      <div className="text-xs opacity-60">Temperature</div>
                    </div>
                    <div className={`p-3 rounded-xl ${currentRisk.risk_level === 'CRITICAL' ? 'bg-red-700' : 'bg-white'} text-center`}>
                      <FaWind className="mx-auto mb-1" />
                      <div className="text-lg font-bold">{currentRisk.weather?.wind} m/s</div>
                      <div className="text-xs opacity-60">Wind Speed</div>
                    </div>
                    <div className={`p-3 rounded-xl ${currentRisk.risk_level === 'CRITICAL' ? 'bg-red-700' : 'bg-white'} text-center`}>
                      <FaCloudRain className="mx-auto mb-1" />
                      <div className="text-lg font-bold">{currentRisk.weather?.rain} mm</div>
                      <div className="text-xs opacity-60">Rainfall</div>
                    </div>
                    <div className={`p-3 rounded-xl ${currentRisk.risk_level === 'CRITICAL' ? 'bg-red-700' : 'bg-white'} text-center`}>
                      <div className="text-lg font-bold">{currentRisk.weather?.humidity}%</div>
                      <div className="text-xs opacity-60">Humidity</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Risk Distribution */}
              <div className="grid grid-cols-4 gap-4">
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(level => {
                  const s = riskLevelColor(level);
                  return (
                    <div key={level} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 text-center">
                      <div className="text-3xl font-black" style={{ color: s.text }}>{riskCounts[level] || 0}</div>
                      <div className="text-sm font-bold mt-1" style={{ color: s.text }}>{level}</div>
                      <div className="text-xs text-gray-400 mt-1">assessments</div>
                    </div>
                  );
                })}
              </div>

              {/* Risk History Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="font-bold text-lg text-gray-800">Risk Assessment History</h3>
                </div>
                <TableContainer>
                  <Table>
                    <TableHead className="bg-gray-50">
                      <TableRow>
                        <TableCell className="font-semibold">Time</TableCell>
                        <TableCell className="font-semibold">Risk Level</TableCell>
                        <TableCell className="font-semibold">Type</TableCell>
                        <TableCell className="font-semibold">Temp</TableCell>
                        <TableCell className="font-semibold">Wind</TableCell>
                        <TableCell className="font-semibold">Rain</TableCell>
                        <TableCell className="font-semibold">Weather</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {riskHistory.map(r => (
                        <TableRow key={r.id} hover>
                          <TableCell className="text-sm text-gray-500">{new Date(r.timestamp).toLocaleString()}</TableCell>
                          <TableCell>
                            <Chip label={r.risk_level} size="small" color={riskLevelColor(r.risk_level).chip} className="font-bold" />
                          </TableCell>
                          <TableCell className="font-medium">{r.risk_type}</TableCell>
                          <TableCell>{r.temperature}°C</TableCell>
                          <TableCell>{r.wind_speed} m/s</TableCell>
                          <TableCell>{r.rainfall} mm</TableCell>
                          <TableCell className="capitalize text-sm text-gray-600">{r.weather_desc}</TableCell>
                        </TableRow>
                      ))}
                      {riskHistory.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">No risk data recorded yet.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            </div>
          )}

          {activeTab === 'broadcasts' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Form panel */}
              <div className="lg:col-span-5 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <h3 className="font-black text-lg text-gray-900 mb-2">Create Critical Broadcast</h3>
                <p className="text-xs text-gray-500 font-medium mb-6">Dispatch a real-time push warning message to all citizens and volunteers.</p>
                
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newBroadcast.message.trim()) return;
                  try {
                    await api.post('/alerts', newBroadcast);
                    setNewBroadcast({ message: '', risk_level: 'HIGH', area: '' });
                    fetchBroadcasts();
                  } catch (e) { console.error(e); }
                }} className="space-y-5">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">Message Warning</label>
                    <TextField 
                      multiline 
                      rows={3} 
                      fullWidth 
                      variant="outlined" 
                      placeholder="E.g., High flood danger in Sector 4. Evacuate to Central Camp immediately." 
                      value={newBroadcast.message}
                      onChange={(e) => setNewBroadcast({ ...newBroadcast, message: e.target.value })}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '1rem' } }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">Target Area</label>
                      <TextField 
                        fullWidth 
                        variant="outlined" 
                        placeholder="E.g., Sector 4 / All Areas" 
                        value={newBroadcast.area}
                        onChange={(e) => setNewBroadcast({ ...newBroadcast, area: e.target.value })}
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '1rem' } }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">Risk Level</label>
                      <select 
                        className="w-full h-[56px] border border-gray-300 rounded-2xl px-3 text-sm font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newBroadcast.risk_level}
                        onChange={(e) => setNewBroadcast({ ...newBroadcast, risk_level: e.target.value })}
                      >
                        <option value="LOW">LOW</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="HIGH">HIGH</option>
                        <option value="CRITICAL">CRITICAL</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white font-black text-base rounded-2xl shadow-lg shadow-red-500/25 transition-all flex items-center justify-center gap-2"
                  >
                    <FaBroadcastTower /> BROADCAST ALERT WARNING
                  </button>
                </form>
              </div>

              {/* Alerts List panel */}
              <div className="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="font-black text-lg text-gray-800">Broadcast Alert History</h3>
                </div>
                <TableContainer>
                  <Table>
                    <TableHead className="bg-gray-50">
                      <TableRow>
                        <TableCell className="font-bold text-gray-700">Time</TableCell>
                        <TableCell className="font-bold text-gray-700">Risk Level</TableCell>
                        <TableCell className="font-bold text-gray-700">Target Area</TableCell>
                        <TableCell className="font-bold text-gray-700">Alert Message</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {broadcasts.map(b => (
                        <TableRow key={b.id} hover>
                          <TableCell className="text-xs text-gray-500 shrink-0 w-24">{new Date(b.timestamp).toLocaleString()}</TableCell>
                          <TableCell className="w-28">
                            <Chip label={b.risk_level} size="small" color={b.risk_level === 'CRITICAL' ? 'error' : b.risk_level === 'HIGH' ? 'error' : b.risk_level === 'MEDIUM' ? 'warning' : 'success'} className="font-bold text-xs" />
                          </TableCell>
                          <TableCell className="font-bold text-sm text-gray-900 w-32">{b.area || 'All Areas'}</TableCell>
                          <TableCell className="text-sm font-semibold text-gray-700">{b.message}</TableCell>
                        </TableRow>
                      ))}
                      {broadcasts.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400 italic">No broadcast alerts launched yet.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Timeline inspector dialog */}
      <Dialog 
        open={Boolean(selectedSos)} 
        onClose={() => setSelectedSos(null)}
        PaperProps={{ style: { borderRadius: '1.5rem', padding: '1rem', maxWidth: '500px', width: '100%' } }}
      >
        {selectedSos && (
          <>
            <div className="flex items-center gap-3 pb-3 border-b">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg bg-red-100 text-red-500`}>
                🚨
              </div>
              <div>
                <h3 className="font-black text-gray-900 text-lg">SOS Incident #{selectedSos.id}</h3>
                <p className="text-xs text-gray-500 font-medium">Reported by {selectedSos.user_name} ({selectedSos.user_phone})</p>
              </div>
            </div>
            
            <DialogContent className="pt-4 space-y-4">
              <div>
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-1">Details</span>
                <p className="text-sm font-medium bg-gray-50 p-3 rounded-xl border italic">"{selectedSos.description || 'No description provided'}"</p>
              </div>
              <div className="flex gap-4">
                <div>
                  <span className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-1">Priority</span>
                  <Chip label={selectedSos.priority.toUpperCase()} size="small" color={selectedSos.priority === 'critical' ? 'error' : selectedSos.priority === 'low' ? 'success' : 'warning'} />
                </div>
                <div>
                  <span className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-1">Status</span>
                  <Chip label={selectedSos.status.toUpperCase()} size="small" color={getStatusColor(selectedSos.status)} />
                </div>
              </div>
              
              <div className="pt-2">
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-3">Timeline Events</span>
                <Timeline timeline={selectedSos.timeline} />
              </div>
            </DialogContent>
            
            <DialogActions className="pt-2 border-t">
              <Button onClick={() => setSelectedSos(null)} variant="outlined" sx={{ borderRadius: '0.75rem', fontWeight: 'bold' }}>
                Close Inspector
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

    </div>
  );
};

export default AdminPortal;
