import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import VideoTile from '../components/VideoTile.jsx';
import LayoutGrid from '../components/LayoutGrid.jsx';
import { getLayout } from '../layouts.js';
import { Maximize, AlertTriangle, GripVertical, X, RotateCcw } from 'lucide-react';

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

  // Per-viewer drag-and-drop arrangement (stored locally, never affects the
  // saved page). `order[p]` = which configured slot index is shown at grid
  // position p.
  const [order, setOrder] = useState(null);
  const dragFrom = useRef(null);

  const orderKey = useCallback(() => {
    const cfg = page?.config || {};
    const lay = getLayout(cfg.layout);
    return `vv-order-${slug}-${lay.id}-${lay.slots}`;
  }, [page, slug]);

  useEffect(() => {
    if (!page) return;
    const lay = getLayout((page.config || {}).layout);
    const n = lay.slots;
    let next = Array.from({ length: n }, (_, i) => i);
    try {
      const saved = JSON.parse(localStorage.getItem(orderKey()) || 'null');
      if (
        Array.isArray(saved) &&
        saved.length === n &&
        saved.every((x) => Number.isInteger(x) && x >= 0 && x < n) &&
        new Set(saved).size === n
      ) {
        next = saved;
      }
    } catch {
      /* ignore */
    }
    setOrder(next);
  }, [page, orderKey]);

  const saveOrder = (next) => {
    setOrder(next);
    try {
      localStorage.setItem(orderKey(), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const resetOrder = () => {
    const lay = getLayout((page.config || {}).layout);
    try {
      localStorage.removeItem(orderKey());
    } catch {
      /* ignore */
    }
    setOrder(Array.from({ length: lay.slots }, (_, i) => i));
  };

  const onDragStart = (pos) => (e) => {
    dragFrom.current = pos;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(pos));
    } catch {
      /* ignore */
    }
  };
  const onDrop = (pos) => (e) => {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from == null || from === pos || !order) return;
    const next = [...order];
    [next[from], next[pos]] = [next[pos], next[from]];
    saveOrder(next);
  };

  // Fullscreen "spotlight" of a single camera.
  const [spotlight, setSpotlight] = useState(null);
  const overlayRef = useRef(null);

  const closeSpotlight = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setSpotlight(null);
  }, []);

  useEffect(() => {
    if (!spotlight) return;
    overlayRef.current?.requestFullscreen?.().catch(() => {});
    const onFsChange = () => {
      if (!document.fullscreenElement) setSpotlight(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setSpotlight(null);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('keydown', onKey);
    };
  }, [spotlight]);

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
  const allowRearrange = layout.slots > 1;
  const customized = order && order.some((v, i) => v !== i);

  // Quality -> resolution + on-the-fly transcode flag.
  const quality = cfg.quality || (cfg.resolution === 'high_res' ? 'hd' : 'sd');
  const res = quality === 'sd' ? 'low_res' : 'high_res';
  const transcode = quality === 'hd_h264';

  const streamUrl = (cameraId) => {
    const q = new URLSearchParams();
    if (token) q.set('t', token);
    q.set('res', res);
    if (transcode) q.set('tx', '1');
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
          <div className="ml-auto flex items-center gap-1">
            {allowRearrange && customized && (
              <button
                onClick={resetOrder}
                className="rounded-md p-2 hover:bg-white/10"
                title="Reset arrangement"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={enterFullscreen}
              className="rounded-md p-2 hover:bg-white/10"
              title="Fullscreen"
            >
              <Maximize className="h-5 w-5" />
            </button>
          </div>
        </header>
      )}

      <main className="min-h-0 flex-1 p-2 sm:p-3">
        <LayoutGrid
          layout={layout}
          renderSlot={(pos) => {
            const idx = order ? order[pos] : pos;
            const slot = (cfg.slots || [])[idx];
            const hasCam = !!slot?.cameraId;
            return (
              <div
                className="group relative h-full w-full"
                draggable={allowRearrange}
                onDragStart={allowRearrange ? onDragStart(pos) : undefined}
                onDragOver={(e) => allowRearrange && e.preventDefault()}
                onDrop={allowRearrange ? onDrop(pos) : undefined}
              >
                <VideoTile
                  src={hasCam ? streamUrl(slot.cameraId) : null}
                  label={slot?.name}
                  showLabel={cfg.showLabels !== false}
                  fit={cfg.fit || 'cover'}
                  onExpand={hasCam ? () => setSpotlight({ cameraId: slot.cameraId, name: slot.name }) : undefined}
                />
                {allowRearrange && hasCam && (
                  <div
                    className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded bg-black/45 px-1.5 py-1 text-[10px] text-white/80 opacity-0 transition-opacity group-hover:opacity-100"
                    title="Drag to rearrange"
                  >
                    <GripVertical className="h-3.5 w-3.5" /> drag
                  </div>
                )}
              </div>
            );
          }}
        />
      </main>

      {!hideChrome && cfg.footerText && (
        <footer className="px-4 py-2 text-center text-xs opacity-60">{cfg.footerText}</footer>
      )}

      {spotlight && (
        <div ref={overlayRef} className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="absolute right-3 top-3 z-10">
            <button
              onClick={closeSpotlight}
              className="rounded-md bg-white/10 p-2 text-white hover:bg-white/20"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {spotlight.name && (
            <div className="absolute left-4 top-4 z-10 rounded bg-black/50 px-2 py-1 text-sm text-white">
              {spotlight.name}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <VideoTile src={streamUrl(spotlight.cameraId)} label={spotlight.name} showLabel={false} fit="contain" />
          </div>
        </div>
      )}
    </div>
  );
}
