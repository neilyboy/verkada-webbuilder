import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Optional local RTSP -> HLS transcoder.
//
// When a camera has a local RTSP source configured, viewers on the LAN can pull
// the high-quality feed straight from the camera (no Verkada cloud bandwidth).
// RTSP is not browser-playable, so we run ffmpeg on demand to repackage it into
// HLS. Sessions are reference-counted and torn down after an idle timeout.

const HLS_DIR = path.join(os.tmpdir(), 'verkada-viewer-hls');
fs.mkdirSync(HLS_DIR, { recursive: true });

const IDLE_MS = 30 * 1000;
const sessions = new Map(); // key -> { proc, dir, lastAccess, timer }

let ffmpegOk = false;
export function ffmpegAvailable() {
  return ffmpegOk;
}
export function detectFfmpeg() {
  return new Promise((resolve) => {
    try {
      const r = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      r.on('error', () => {
        ffmpegOk = false;
        resolve(false);
      });
      r.on('exit', (code) => {
        ffmpegOk = code === 0;
        resolve(ffmpegOk);
      });
    } catch {
      ffmpegOk = false;
      resolve(false);
    }
  });
}

function sessionKey(cameraId, transcode) {
  return `${cameraId}:${transcode ? 'h264' : 'copy'}`;
}

function startSession(key, rtspUrl, transcode) {
  const dir = fs.mkdtempSync(path.join(HLS_DIR, 'cam-'));
  const playlist = path.join(dir, 'index.m3u8');

  const videoArgs = transcode
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'copy'];

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-an',
    ...videoArgs,
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+omit_endlist',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
    playlist,
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', () => {}); // discard; enable for debugging
  proc.on('exit', (code) => {
    const s = sessions.get(key);
    if (s && s.proc === proc) {
      sessions.delete(key);
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
    if (code) console.warn(`[rtsp] ffmpeg for ${key} exited with code ${code}`);
  });

  const session = { proc, dir, playlist, lastAccess: Date.now(), timer: null };
  scheduleIdleCheck(key, session);
  sessions.set(key, session);
  return session;
}

function scheduleIdleCheck(key, session) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    if (Date.now() - session.lastAccess >= IDLE_MS) {
      try {
        session.proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      sessions.delete(key);
      fs.rm(session.dir, { recursive: true, force: true }, () => {});
    } else {
      scheduleIdleCheck(key, session);
    }
  }, IDLE_MS);
}

async function waitForPlaylist(session, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(session.playlist)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Ensure a session exists and return the directory + playlist file name.
export async function ensureLocalSession(cameraId, rtspUrl, transcode = false) {
  const key = sessionKey(cameraId, transcode);
  let session = sessions.get(key);
  if (!session || session.proc.killed) {
    session = startSession(key, rtspUrl, transcode);
  }
  session.lastAccess = Date.now();
  const ready = await waitForPlaylist(session);
  if (!ready) throw new Error('Local stream did not start (check RTSP URL / ffmpeg)');
  return { dir: session.dir };
}

export function touchLocalSession(cameraId, transcode = false) {
  const s = sessions.get(sessionKey(cameraId, transcode));
  if (s) s.lastAccess = Date.now();
}

export function getSessionDir(cameraId, transcode = false) {
  const s = sessions.get(sessionKey(cameraId, transcode));
  return s ? s.dir : null;
}

export function serveLocalFile(dir, file, res) {
  // Prevent path traversal.
  const safe = path.basename(file);
  const full = path.join(dir, safe);
  if (!full.startsWith(dir)) return res.status(403).end();
  if (!fs.existsSync(full)) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  if (safe.endsWith('.m3u8')) res.type('application/vnd.apple.mpegurl');
  else if (safe.endsWith('.ts')) res.type('video/mp2t');
  fs.createReadStream(full).pipe(res);
}
