import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { Video, VideoOff, Loader2, Maximize2, Camera, Clock } from 'lucide-react';

// A single HLS video tile. Plays the provided .m3u8 src, with automatic error
// recovery and a status overlay. `src` may be null (empty slot).
export default function VideoTile({
  src,
  label,
  showLabel = true,
  muted = true,
  fit = 'cover',
  onExpand,
  showSnapshot = false,
  showTimestamp = false,
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | playing | error
  const [clock, setClock] = useState('');
  const [flash, setFlash] = useState(false);

  // Live timestamp overlay
  useEffect(() => {
    if (!showTimestamp) {
      setClock('');
      return;
    }
    const tick = () => {
      const now = new Date();
      setClock(
        now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
          ' ' +
          now.toLocaleTimeString('en-US', { hour12: false })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [showTimestamp]);

  const takeSnapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const name = (label || 'camera').replace(/[^a-z0-9_-]/gi, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${name}_${ts}.png`;
    a.click();
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
  }, [label]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    let cancelled = false;

    const onPlaying = () => !cancelled && setStatus('playing');
    video.addEventListener('playing', onPlaying);

    // Pre-flight: poll the manifest URL until it returns 200 (not 503).
    const MAX_PREFLIGHT = 20;
    let preflightCount = 0;

    const startPlayback = () => {
      if (cancelled) return;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        video.play().catch(() => {});
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          lowLatencyMode: true,
          liveSyncDurationCount: 1,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 4,
          fragLoadingTimeOut: 20000,
        });
        hlsRef.current = hls;
        let netRetries = 0;
        let mediaRetries = 0;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (netRetries++ >= 5) {
              setStatus('error');
              hls.destroy();
              return;
            }
            setTimeout(() => !cancelled && hls.startLoad(), 1500);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (mediaRetries++ >= 2) {
              setStatus('error');
              hls.destroy();
              return;
            }
            hls.recoverMediaError();
          } else {
            setStatus('error');
            hls.destroy();
          }
        });
      } else {
        setStatus('error');
      }
    };

    (async () => {
      while (!cancelled && preflightCount < MAX_PREFLIGHT) {
        try {
          const r = await fetch(src, { method: 'GET' });
          if (r.status === 200) {
            startPlayback();
            return;
          }
        } catch {
          /* network error, keep trying */
        }
        preflightCount++;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setStatus('error');
    })();

    return () => {
      cancelled = true;
      video.removeEventListener('playing', onPlaying);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  return (
    <div className="group relative h-full w-full overflow-hidden rounded-lg bg-black">
      {/* Hover toolbar */}
      {src && status === 'playing' && (onExpand || showSnapshot) && (
        <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {showSnapshot && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                takeSnapshot();
              }}
              className="rounded-md bg-black/50 p-1.5 text-white hover:bg-black/70"
              title="Snapshot"
            >
              <Camera className="h-4 w-4" />
            </button>
          )}
          {onExpand && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExpand();
              }}
              className="rounded-md bg-black/50 p-1.5 text-white hover:bg-black/70"
              title="Fullscreen this camera"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Timestamp overlay */}
      {src && showTimestamp && clock && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white">
          {clock}
        </div>
      )}

      {/* Snapshot flash effect */}
      {flash && (
        <div className="pointer-events-none absolute inset-0 z-20 bg-white animate-pulse" />
      )}

      {src ? (
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          autoPlay
          className="h-full w-full"
          style={{ objectFit: fit }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-600">
          <Video className="h-8 w-8" />
        </div>
      )}

      {src && status !== 'playing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-gray-300">
          {status === 'error' ? (
            <div className="flex flex-col items-center gap-1 text-red-400">
              <VideoOff className="h-7 w-7" />
              <span className="text-xs">Stream unavailable</span>
            </div>
          ) : (
            <Loader2 className="h-7 w-7 animate-spin" />
          )}
        </div>
      )}

      {showLabel && label && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-1.5 text-sm font-medium text-white">
          {label}
        </div>
      )}
    </div>
  );
}
