import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import VideoTile from '../components/VideoTile.jsx';
import LayoutGrid from '../components/LayoutGrid.jsx';
import { getLayout } from '../layouts.js';
import { Maximize, AlertTriangle } from 'lucide-react';

export default function Viewer() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') || '';
  const hideChrome = params.get('chrome') === '0' || params.get('kiosk') === '1';

  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const url = `/api/public/pages/${encodeURIComponent(slug)}${
      token ? `?t=${encodeURIComponent(token)}` : ''
    }`;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => setPage(d.page))
      .catch((e) => setError(e.message));
  }, [slug, token]);

  const enterFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-gray-400">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <div className="text-lg font-semibold text-gray-200">Unable to load this view</div>
        <div className="text-sm">
          {error === 'token_required'
            ? 'An access token is required. Check your link.'
            : error === 'not_found'
            ? 'This page does not exist or is not published.'
            : error}
        </div>
      </div>
    );
  }

  if (!page) {
    return <div className="flex h-full w-full items-center justify-center text-gray-500">Loading…</div>;
  }

  const cfg = page.config || {};
  const layout = getLayout(cfg.layout);
  const light = cfg.theme === 'light';
  const res = cfg.resolution === 'high_res' ? 'high_res' : 'low_res';

  const streamUrl = (cameraId) => {
    const q = new URLSearchParams();
    if (token) q.set('t', token);
    q.set('res', res);
    return `/api/public/pages/${encodeURIComponent(slug)}/cam/${encodeURIComponent(
      cameraId
    )}/index.m3u8?${q.toString()}`;
  };

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ background: light ? '#f3f4f6' : '#0b0f1a', color: light ? '#111827' : '#e5e7eb' }}
    >
      {!hideChrome && (cfg.logoUrl || cfg.title || cfg.headerText) && (
        <header
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: `2px solid ${cfg.accent || '#2563eb'}` }}
        >
          {cfg.logoUrl && <img src={cfg.logoUrl} alt="" className="h-8 w-auto object-contain" />}
          <div className="min-w-0">
            {cfg.title && <div className="truncate text-lg font-bold">{cfg.title}</div>}
            {cfg.headerText && (
              <div className="truncate text-xs opacity-70">{cfg.headerText}</div>
            )}
          </div>
          <button
            onClick={enterFullscreen}
            className="ml-auto rounded-md p-2 hover:bg-white/10"
            title="Fullscreen"
          >
            <Maximize className="h-5 w-5" />
          </button>
        </header>
      )}

      <main className="min-h-0 flex-1 p-2 sm:p-3">
        <LayoutGrid
          layout={layout}
          renderSlot={(i) => {
            const slot = (cfg.slots || [])[i];
            return (
              <VideoTile
                src={slot?.cameraId ? streamUrl(slot.cameraId) : null}
                label={slot?.name}
                showLabel={cfg.showLabels !== false}
                fit={cfg.fit || 'cover'}
              />
            );
          }}
        />
      </main>

      {!hideChrome && cfg.footerText && (
        <footer className="px-4 py-2 text-center text-xs opacity-60">{cfg.footerText}</footer>
      )}
    </div>
  );
}
