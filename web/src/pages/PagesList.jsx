import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Plus, ExternalLink, Copy, Trash2, Check, Loader2 } from 'lucide-react';

export default function PagesList() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState('');
  const navigate = useNavigate();

  const load = () =>
    api
      .get('/api/admin/pages')
      .then((d) => setPages(d.pages))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const { page } = await api.post('/api/admin/pages', { name: 'New view' });
      navigate(`/pages/${page.id}`);
    } finally {
      setCreating(false);
    }
  };

  const shareUrl = (p) => {
    const base = `${window.location.origin}/v/${p.slug}`;
    return p.require_token ? `${base}?t=${p.access_token}` : base;
  };

  const copy = async (p) => {
    await navigator.clipboard.writeText(shareUrl(p));
    setCopied(p.id);
    setTimeout(() => setCopied(''), 1500);
  };

  const remove = async (p) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await api.del(`/api/admin/pages/${p.id}`);
    load();
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pages</h1>
          <p className="text-sm text-gray-400">Build a customized live view per user or location.</p>
        </div>
        <button className="btn-primary" onClick={create} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New page
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : pages.length === 0 ? (
        <div className="card text-sm text-gray-400">No pages yet. Create your first view.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => (
            <div key={p.id} className="card flex flex-col">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="truncate text-xs text-gray-500">/v/{p.slug}</div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    p.published ? 'bg-green-500/15 text-green-300' : 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {p.published ? 'Published' : 'Draft'}
                </span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {(p.config?.slots || []).filter((s) => s.cameraId).length} cameras ·{' '}
                {p.config?.layout || 'grid-2x2'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost flex-1" onClick={() => navigate(`/pages/${p.id}`)}>
                  Edit
                </button>
                <button className="btn-ghost" onClick={() => copy(p)} title="Copy share link">
                  {copied === p.id ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                </button>
                <a
                  className="btn-ghost"
                  href={shareUrl(p)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open view"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button className="btn-danger" onClick={() => remove(p)} title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
