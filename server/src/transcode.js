import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signInternalRef } from './hlsProxy.js';

// On-the-fly HEVC -> H.264 transcoder for the cloud HD stream.
//
// Verkada's high_res feed is H.265 (HEVC), which most browsers cannot decode in
// MSE. We run ffmpeg to transcode it to H.264 HLS on demand. ffmpeg pulls its
// input through our own internal proxy route so the streaming JWT is refreshed
// automatically. Sessions are torn down after an idle timeout.

const TX_DIR = path.join(os.tmpdir(), 'verkada-viewer-tx');
fs.mkdirSync(TX_DIR, { recursive: true });

const IDLE_MS = 30 * 1000;
// Cap output height to keep transcoding near real-time on modest hardware while
// still delivering a true HD picture. Override with TRANSCODE_MAX_HEIGHT.
const MAX_HEIGHT = Number(process.env.TRANSCODE_MAX_HEIGHT || 1080);

const sessions = new Map(); // cameraId -> { proc, dir, playlist, lastAccess, timer }

function selfBase() {
  return `http://127.0.0.1:${process.env.PORT || 8080}`;
}

function startSession(cameraId) {
  const dir = fs.mkdtempSync(path.join(TX_DIR, 'cam-'));
  const playlist = path.join(dir, 'index.m3u8');
  const k = signInternalRef(cameraId, 'high_res');
  const input = `${selfBase()}/api/internal/tx/${encodeURIComponent(
    cameraId
  )}/high_res/index.m3u8?k=${encodeURIComponent(k)}`;

  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    // Our proxied segment URLs have no file extension (…/seg/<token>?u=…), which
    // ffmpeg's HLS demuxer rejects by default. Disable the extension check and
    // whitelist the HTTP protocol chain so it will fetch them.
    '-extension_picky', '0',
    '-allowed_extensions', 'ALL',
    '-allowed_segment_extensions', 'ALL',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
    '-i', input,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-vf', `scale='trunc(oh*a/2)*2':'min(${MAX_HEIGHT},ih)'`,
    '-g', '48',
    '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
    playlist,
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let lastErr = '';
  proc.stderr.on('data', (d) => {
    lastErr = d.toString().slice(-500);
  });
  proc.on('exit', (code) => {
    const s = sessions.get(cameraId);
    if (s && s.proc === proc) {
      sessions.delete(cameraId);
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
    if (code) console.warn(`[transcode] ffmpeg for ${cameraId} exited (${code}): ${lastErr}`);
  });

  const session = { proc, dir, playlist, lastAccess: Date.now(), timer: null };
  scheduleIdleCheck(cameraId, session);
  sessions.set(cameraId, session);
  return session;
}

function scheduleIdleCheck(cameraId, session) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    if (Date.now() - session.lastAccess >= IDLE_MS) {
      try {
        session.proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      sessions.delete(cameraId);
      fs.rm(session.dir, { recursive: true, force: true }, () => {});
    } else {
      scheduleIdleCheck(cameraId, session);
    }
  }, IDLE_MS);
}

async function waitForPlaylist(session, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(session.playlist)) {
        const txt = fs.readFileSync(session.playlist, 'utf8');
        if (/\.ts(\?|$)/m.test(txt)) return true; // at least one segment written
      }
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export async function ensureTranscodeSession(cameraId) {
  let session = sessions.get(cameraId);
  if (!session || session.proc.killed) {
    session = startSession(cameraId);
  }
  session.lastAccess = Date.now();
  const ready = await waitForPlaylist(session);
  if (!ready) throw new Error('Transcode did not start (check ffmpeg / stream permissions)');
  return { dir: session.dir };
}

export function getTranscodeDir(cameraId) {
  const s = sessions.get(cameraId);
  return s ? s.dir : null;
}

export function touchTranscode(cameraId) {
  const s = sessions.get(cameraId);
  if (s) s.lastAccess = Date.now();
}
