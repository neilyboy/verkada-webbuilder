import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { Video, VideoOff, Loader2, Maximize2, Camera, Clock, Activity } from 'lucide-react';

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
  showStats = false,
  onStatusChange,
  hidden = false,
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | playing | error
  const [clock, setClock] = useState('');
  const [flash, setFlash] = useState(false);
  const [stats, setStats] = useState(null);

  const updateStatus = useCallback((s) => {
    setStatus(s);
    if (onStatusChange) onStatusChange(s);
  }, [onStatusChange]);

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
      updateStatus('idle');
      return;
    }
    updateStatus('loading');
    let cancelled = false;

    const onPlaying = () => !cancelled && updateStatus('playing');
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
              updateStatus('error');
              hls.destroy();
              return;
            }
            setTimeout(() => !cancelled && hls.startLoad(), 1500);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (mediaRetries++ >= 2) {
              updateStatus('error');
              hls.destroy();
              return;
            }
            hls.recoverMediaError();
          } else {
            updateStatus('error');
            hls.destroy();
          }
        });
      } else {
        updateStatus('error');
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
      if (!cancelled) updateStatus('error');
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

  // Separate stats tracking effect — runs independently of stream init.
  // This allows toggling stats on/off without restarting the stream.
  useEffect(() => {
    if (!showStats || !src || status !== 'playing') {
      setStats(null);
      return;
    }

    let frameCount = 0;
    let lastFrames = 0;
    let lastTime = performance.now();
    let lastBytes = 0;
    let rafId = null;
    let intervalId = null;

    const video = videoRef.current;
    if (!video) return;

    // Frame counting via requestVideoFrameCallback (Chromium/Edge/Chrome)
    const onVFrame = () => {
      frameCount++;
      rafId = video.requestVideoFrameCallback?.(onVFrame);
    };
    if (video.requestVideoFrameCallback) {
      rafId = video.requestVideoFrameCallback(onVFrame);
    }

    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const now = performance.now();
      const dt = (now - lastTime) / 1000;

      // FPS: prefer requestVideoFrameCallback count, fall back to getVideoPlaybackQuality
      let fps = '?';
      if (dt > 0) {
        if (frameCount > 0) {
          fps = Math.round(frameCount / dt);
          frameCount = 0;
        } else {
          const q = v.getVideoPlaybackQuality?.();
          if (q) {
            fps = Math.round((q.totalVideoFrames - lastFrames) / dt);
            lastFrames = q.totalVideoFrames;
          }
        }
      }
      lastTime = now;

      // Bitrate: try hls.js bandwidth estimate, then level bitrate, then decoded bytes
      let bitrate = '?';
      const hls = hlsRef.current;
      if (hls) {
        if (hls.bandwidthEstimate > 0) {
          bitrate = Math.round(hls.bandwidthEstimate / 1000);
        } else {
          const lvl = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : (hls.levels[hls.loadLevel] || null);
          if (lvl?.bitrate) bitrate = Math.round(lvl.bitrate / 1000);
        }
      }
      // Fallback: use webkitVideoDecodedByteCount (Chromium) for approximate bitrate
      if (bitrate === '?' && v.webkitVideoDecodedByteCount != null) {
        const deltaBytes = v.webkitVideoDecodedByteCount - lastBytes;
        if (deltaBytes > 0 && dt > 0) {
          bitrate = Math.round((deltaBytes * 8) / dt / 1000);
        }
        lastBytes = v.webkitVideoDecodedByteCount;
      }

      setStats({
        w: v.videoWidth,
        h: v.videoHeight,
        bitrate,
        fps,
      });
    };

    // Initial tick after a short delay to let buffers fill
    const startDelay = setTimeout(tick, 1000);
    intervalId = setInterval(tick, 2000);

    return () => {
      clearTimeout(startDelay);
      clearInterval(intervalId);
      if (rafId && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(rafId);
    };
  }, [showStats, src, status]);

  return (
    <div className={`group relative h-full w-full overflow-hidden rounded-lg bg-black${hidden ? " pointer-events-none opacity-0 absolute -z-10" : ""}`}>
      {/* Expand button (top-right, grid view only) */}
      {src && !hidden && status === 'playing' && onExpand && (
        <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
        </div>
      )}

      {/* Snapshot button (bottom-left, always visible when snapshot mode is on) */}
      {src && !hidden && status === 'playing' && showSnapshot && (
        <div className="absolute left-2 bottom-8 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              takeSnapshot();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600/80 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-blue-600"
            title="Take snapshot"
          >
            <Camera className="h-4 w-4" />
            Capture
          </button>
        </div>
      )}

      {/* Timestamp + stats overlay (bottom-right, stacked) */}
      {src && (showTimestamp || (showStats && stats)) && (
        <div className="pointer-events-none absolute right-2 bottom-8 z-10 flex flex-col items-end gap-1">
          {showTimestamp && clock && (
            <div className="rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white">
              {clock}
            </div>
          )}
          {showStats && stats && (
            <div className="rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-green-400">
              {stats.w}x{stats.h} · {stats.bitrate !== '?' ? `${stats.bitrate}kbps` : '?'} · {stats.fps !== '?' ? `${stats.fps}fps` : '?'} · {hidden ? 'prebuf' : 'live'}
            </div>
          )}
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

      {src && !hidden && status !== 'playing' && (
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
