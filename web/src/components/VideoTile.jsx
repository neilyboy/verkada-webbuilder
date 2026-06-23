import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Video, VideoOff, Loader2, Maximize2 } from 'lucide-react';

// A single HLS video tile. Plays the provided .m3u8 src, with automatic error
// recovery and a status overlay. `src` may be null (empty slot).
export default function VideoTile({
  src,
  label,
  showLabel = true,
  muted = true,
  fit = 'cover',
  onExpand,
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | playing | error

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

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS).
      video.src = src;
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 15000,
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
          // A 4xx/5xx on the manifest means the stream really isn't available
          // (e.g. wrong org_id). Don't retry forever — give up after a few tries.
          const isManifest =
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
          if (netRetries++ >= 3) {
            setStatus('error');
            hls.destroy();
            return;
          }
          if (isManifest && netRetries >= 2) {
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
      {src && onExpand && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="absolute right-2 top-2 z-10 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
          title="Fullscreen this camera"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
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
