import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Login from './Login.jsx';
import Settings from './Settings.jsx';
import Cameras from './Cameras.jsx';
import PagesList from './PagesList.jsx';
import PageBuilder from './PageBuilder.jsx';
import { LayoutGrid, Settings as SettingsIcon, Camera, LogOut, Loader2 } from 'lucide-react';

export default function AdminApp() {
  const [status, setStatus] = useState(null);
  const navigate = useNavigate();

  const refresh = () => api.get('/api/admin/status').then(setStatus).catch(() => setStatus({}));
  useEffect(() => {
    refresh();
  }, []);

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!status.authed) {
    return <Login status={status} onAuthed={refresh} />;
  }

  const logout = async () => {
    await api.post('/api/admin/logout');
    refresh();
    navigate('/');
  };

  const navItem = ({ isActive }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
      isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'
    }`;

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col gap-1 border-r border-white/10 bg-black/20 p-3">
        <div className="mb-4 px-2 text-lg font-bold tracking-tight">Verkada Viewer</div>
        <NavLink to="/" end className={navItem}>
          <LayoutGrid className="h-4 w-4" /> Pages
        </NavLink>
        <NavLink to="/cameras" className={navItem}>
          <Camera className="h-4 w-4" /> Cameras
        </NavLink>
        <NavLink to="/settings" className={navItem}>
          <SettingsIcon className="h-4 w-4" /> Settings
        </NavLink>
        <div className="mt-auto">
          {!status.hasApiKey && (
            <div className="mb-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
              No API key set. Add one in Settings.
            </div>
          )}
          <button onClick={logout} className="btn-ghost w-full">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<PagesList />} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/settings" element={<Settings onChange={refresh} />} />
          <Route path="/pages/:id" element={<PageBuilder />} />
        </Routes>
      </main>
    </div>
  );
}
