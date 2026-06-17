import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import VideoTile from '../components/VideoTile.jsx';
import { RefreshCw, Loader2, Settings2, X, Wifi } from 'lucide-react';

export default function Cameras() {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    api
      .get(`/api/admin/cameras${refresh ? '?refresh=1' : ''}`)
      .then((d) => setCameras(d.cameras))
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cameras</h1>
          <p className="text-sm text-gray-400">{cameras.length} cameras cached</p>
        </div>
        <button className="btn-primary" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync from Verkada
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : cameras.length === 0 ? (
        <div className="card text-sm text-gray-400">
          No cameras yet. Make sure your API key is set in Settings, then click “Sync from Verkada”.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((c) => (
            <div key={c.camera_id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="truncate text-xs text-gray-500">
                    {c.site || c.model || c.camera_id}
                  </div>
                </div>
                {c.has_rtsp && (
                  <span
                    className="flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-300"
                    title="Local RTSP configured"
                  >
                    <Wifi className="h-3 w-3" /> local
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => setPreview(c)}>
                  Preview
                </button>
                <button className="btn-ghost" onClick={() => setEditing(c)} title="Local source">
                  <Settings2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && <PreviewModal camera={preview} onClose={() => setPreview(null)} />}
      {editing && (
        <LocalModal
          camera={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PreviewModal({ camera, onClose }) {
  const [res, setRes] = useState('low_res');
  const [mode, setMode] = useState('auto');
  const url = `/api/admin/preview/${encodeURIComponent(
    camera.camera_id
  )}/index.m3u8?res=${res}&mode=${mode}`;
  return (
    <Modal onClose={onClose} title={camera.name} wide>
      <div className="aspect-video w-full">
        <VideoTile src={url} label={camera.name} fit="contain" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-400">Quality:</span>
        <select className="input w-auto" value={res} onChange={(e) => setRes(e.target.value)}>
          <option value="low_res">Low (save bandwidth)</option>
          <option value="high_res">High</option>
        </select>
        <span className="text-gray-400">Source:</span>
        <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="auto">Auto</option>
          <option value="cloud">Cloud</option>
          <option value="local">Local RTSP</option>
        </select>
      </div>
    </Modal>
  );
}

function LocalModal({ camera, onClose, onSaved }) {
  const [rtspUrl, setRtspUrl] = useState('');
  const [preferLocal, setPreferLocal] = useState(camera.prefer_local);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async (clear = false) => {
    setBusy(true);
    setMsg('');
    try {
      await api.post(`/api/admin/cameras/${encodeURIComponent(camera.camera_id)}/local`, {
        rtspUrl: clear ? '' : rtspUrl || undefined,
        preferLocal,
      });
      onSaved();
    } catch (e) {
      setMsg(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={`Local source — ${camera.name}`}>
      <p className="mb-3 text-sm text-gray-400">
        Optional. Enable RTSP for this camera in Verkada Command (Site Admin), then paste the RTSP
        URL here. LAN viewers will stream HQ directly from the camera (no cloud bandwidth). The
        server transcodes RTSP to browser-friendly HLS with ffmpeg.
      </p>
      <label className="label">RTSP URL {camera.has_rtsp && '(stored — leave blank to keep)'}</label>
      <input
        className="input mb-3"
        placeholder="rtsp://user:pass@192.168.1.50:8554/..."
        value={rtspUrl}
        onChange={(e) => setRtspUrl(e.target.value)}
      />
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={preferLocal}
          onChange={(e) => setPreferLocal(e.target.checked)}
        />
        Prefer local (use RTSP automatically when available)
      </label>
      {msg && <div className="mb-3 text-sm text-red-400">{msg}</div>}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => save(false)} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
        {camera.has_rtsp && (
          <button className="btn-danger" onClick={() => save(true)} disabled={busy}>
            Remove RTSP
          </button>
        )}
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <button className="rounded p-1 hover:bg-white/10" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
