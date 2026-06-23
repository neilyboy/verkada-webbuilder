import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import VideoTile from '../components/VideoTile.jsx';
import LayoutGrid from '../components/LayoutGrid.jsx';
import { LAYOUT_LIST, getLayout } from '../layouts.js';
import {
  ArrowLeft,
  Save,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';

export default function PageBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [requireToken, setRequireToken] = useState(true);
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    api.get(`/api/admin/pages/${id}`).then(({ page }) => {
      setPage(page);
      setName(page.name);
      setSlug(page.slug);
      setRequireToken(page.require_token);
      setPublished(page.published);
      setCfg({ slots: [], ...page.config });
    });
    api.get('/api/admin/cameras').then((d) => setCameras(d.cameras));
  }, [id]);

  const layout = useMemo(() => (cfg ? getLayout(cfg.layout) : null), [cfg]);

  // Keep slots array sized to the layout.
  useEffect(() => {
    if (!cfg || !layout) return;
    const slots = [...(cfg.slots || [])];
    if (slots.length !== layout.slots) {
      slots.length = layout.slots;
      for (let i = 0; i < layout.slots; i++) if (!slots[i]) slots[i] = { cameraId: '', label: '' };
      setCfg((c) => ({ ...c, slots }));
    }
  }, [layout, cfg]);

  const update = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const updateSlot = (i, patch) =>
    setCfg((c) => {
      const slots = [...c.slots];
      slots[i] = { ...slots[i], ...patch };
      return { ...c, slots };
    });

  const camName = useCallback(
    (camId) => cameras.find((c) => c.camera_id === camId)?.name || '',
    [cameras]
  );

  const save = async () => {
    setSaving(true);
    try {
      const { page: updated } = await api.put(`/api/admin/pages/${id}`, {
        name,
        slug,
        config: cfg,
        requireToken,
        published,
      });
      setPage(updated);
      setSlug(updated.slug);
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async () => {
    const { access_token } = await api.post(`/api/admin/pages/${id}/rotate-token`);
    setPage((p) => ({ ...p, access_token }));
  };

  const shareUrl = page
    ? `${window.location.origin}/v/${page.slug}${
        requireToken ? `?t=${page.access_token}` : ''
      }`
    : '';

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const quality = cfg?.quality || (cfg?.resolution === 'high_res' ? 'hd' : 'sd');
  const previewUrl = (camId) => {
    if (!camId) return null;
    const res = quality === 'sd' ? 'low_res' : 'high_res';
    const tx = quality === 'hd_h264' ? '&tx=1' : '';
    return `/api/admin/preview/${encodeURIComponent(camId)}/index.m3u8?res=${res}&mode=auto${tx}`;
  };

  const setQuality = (q) =>
    update({ quality: q, resolution: q === 'sd' ? 'low_res' : 'high_res' });

  if (!page || !cfg || !layout) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button className="btn-ghost" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" /> Pages
        </button>
        <input
          className="input max-w-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Page name"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published
        </label>
        <button className="btn-ghost ml-auto" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          Preview
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* config panel */}
        <div className="w-80 shrink-0 space-y-4 overflow-auto border-r border-white/10 p-4">
          <Section title="Layout">
            <div className="grid grid-cols-2 gap-2">
              {LAYOUT_LIST.map((l) => (
                <button
                  key={l.id}
                  onClick={() => update({ layout: l.id })}
                  className={`rounded-lg border p-2 text-xs ${
                    cfg.layout === l.id
                      ? 'border-blue-500 bg-blue-500/10 text-white'
                      : 'border-white/10 text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <LayoutThumb layout={l} />
                  <div className="mt-1">{l.name}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Cameras">
            <div className="space-y-2">
              {cfg.slots.map((slot, i) => (
                <div key={i} className="rounded-lg border border-white/10 p-2">
                  <div className="mb-1 text-xs font-medium text-gray-400">Slot {i + 1}</div>
                  <select
                    className="input mb-2"
                    value={slot.cameraId || ''}
                    onChange={(e) => updateSlot(i, { cameraId: e.target.value })}
                  >
                    <option value="">— Empty —</option>
                    {cameras.map((c) => (
                      <option key={c.camera_id} value={c.camera_id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder={slot.cameraId ? camName(slot.cameraId) : 'Custom label (optional)'}
                    value={slot.label || ''}
                    onChange={(e) => updateSlot(i, { label: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Quality">
            <select className="input" value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="sd">SD — H.264, plays everywhere</option>
              <option value="hd">HD — native H.265 (Safari only)</option>
              <option value="hd_h264">HD (transcoded) — H.264, plays everywhere</option>
            </select>
            {quality === 'hd' && (
              <p className="mt-1 text-xs text-amber-400/80">
                Native H.265 won't play in Chrome/Firefox. Use “HD (transcoded)” for broad support.
              </p>
            )}
            {quality === 'hd_h264' && (
              <p className="mt-1 text-xs text-gray-500">
                Server transcodes HEVC→H.264 on the fly (needs ffmpeg). CPU-intensive — best for a
                few simultaneous HD streams.
              </p>
            )}
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cfg.showLabels !== false}
                onChange={(e) => update({ showLabels: e.target.checked })}
              />
              Show camera labels
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cfg.fit === 'contain'}
                onChange={(e) => update({ fit: e.target.checked ? 'contain' : 'cover' })}
              />
              Fit whole frame (letterbox)
            </label>
          </Section>

          <Section title="Branding">
            <label className="label">Title</label>
            <input className="input mb-2" value={cfg.title || ''} onChange={(e) => update({ title: e.target.value })} />
            <label className="label">Logo URL</label>
            <input className="input mb-2" value={cfg.logoUrl || ''} onChange={(e) => update({ logoUrl: e.target.value })} placeholder="https://…/logo.png" />
            <label className="label">Header text</label>
            <input className="input mb-2" value={cfg.headerText || ''} onChange={(e) => update({ headerText: e.target.value })} />
            <label className="label">Footer text</label>
            <input className="input mb-2" value={cfg.footerText || ''} onChange={(e) => update({ footerText: e.target.value })} />
            <div className="flex items-center gap-3">
              <div>
                <label className="label">Theme</label>
                <select className="input w-auto" value={cfg.theme || 'dark'} onChange={(e) => update({ theme: e.target.value })}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div>
                <label className="label">Accent</label>
                <input type="color" className="h-9 w-12 rounded bg-transparent" value={cfg.accent || '#2563eb'} onChange={(e) => update({ accent: e.target.value })} />
              </div>
            </div>
          </Section>

          <Section title="Sharing & access">
            <label className="label">URL slug</label>
            <input className="input mb-2" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={requireToken} onChange={(e) => setRequireToken(e.target.checked)} />
              Require access token
            </label>
            <div className="flex items-center gap-2">
              <input className="input text-xs" readOnly value={shareUrl} />
              <button className="btn-ghost shrink-0" onClick={copy}>
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <a className="btn-ghost flex-1" href={shareUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Open
              </a>
              {requireToken && (
                <button className="btn-ghost" onClick={rotateToken} title="Rotate token (invalidates old links)">
                  <RefreshCw className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              For a Raspberry Pi / TV kiosk, append <code>&kiosk=1</code> to hide the header.
            </p>
            <p className="mt-1 text-xs text-gray-500">Save the page after changing the slug.</p>
          </Section>
        </div>

        {/* live preview */}
        <div className="min-w-0 flex-1 p-4">
          {showPreview ? (
            <div
              className="h-full w-full rounded-xl p-3"
              style={{ background: cfg.theme === 'light' ? '#e5e7eb' : '#05070d' }}
            >
              <LayoutGrid
                layout={layout}
                renderSlot={(i) => {
                  const slot = cfg.slots[i] || {};
                  return (
                    <VideoTile
                      src={previewUrl(slot.cameraId)}
                      label={slot.label || camName(slot.cameraId)}
                      showLabel={cfg.showLabels !== false}
                      fit={cfg.fit || 'cover'}
                    />
                  );
                }}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-gray-600">
              Preview hidden
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>
      {children}
    </div>
  );
}

// Tiny visual representation of a layout for the picker buttons.
function LayoutThumb({ layout }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: layout.columns,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: layout.areas.join(' '),
        gap: 2,
        height: 36,
      }}
    >
      {layout.order.map((area) => (
        <div key={area} style={{ gridArea: area }} className="rounded-sm bg-gray-500/40" />
      ))}
    </div>
  );
}
