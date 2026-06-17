import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';
import { decrypt } from './crypto.js';
import { buildStreamUrl } from './verkada.js';
import { serveMasterPlaylist, serveSegment } from './hlsProxy.js';
import {
  ffmpegAvailable,
  ensureLocalSession,
  getSessionDir,
  serveLocalFile,
} from './rtsp.js';

// Shared streaming helpers used by both admin preview and public viewer routes.

export function getCameraRow(cameraId) {
  return db.prepare('SELECT * FROM cameras WHERE camera_id = ?').get(cameraId);
}

// Decide whether to serve the local (RTSP) or cloud (Verkada HLS) feed.
export function resolveMode(cameraRow, requested) {
  if (requested === 'cloud') return 'cloud';
  const canLocal = cameraRow && cameraRow.rtsp_url && ffmpegAvailable();
  if (requested === 'local') return canLocal ? 'local' : 'cloud';
  // auto
  if (canLocal && cameraRow.prefer_local) return 'local';
  return 'cloud';
}

// Serve the master playlist for a camera.
// opts: { cameraId, resolution, mode, segMount, localBase, transcode }
export async function servePlaylist(req, res, opts) {
  const { cameraId, resolution = 'low_res', mode = 'auto', segMount, localBase, transcode = false } = opts;
  const row = getCameraRow(cameraId);
  const chosen = resolveMode(row, mode);

  if (chosen === 'local') {
    try {
      const rtspUrl = decrypt(row.rtsp_url);
      await ensureLocalSession(cameraId, rtspUrl, transcode);
      // Rewrite ffmpeg playlist so .ts segments route through localBase.
      const dir = getSessionDir(cameraId, transcode);
      const text = fs.readFileSync(path.join(dir, 'index.m3u8'), 'utf8');
      const rewritten = text
        .split(/\r?\n/)
        .map((line) =>
          line && !line.startsWith('#') ? `${localBase}/${line.trim()}` : line
        )
        .join('\n');
      res.set('Cache-Control', 'no-store');
      return res.type('application/vnd.apple.mpegurl').send(rewritten);
    } catch (err) {
      console.error('[stream] local failed, falling back to cloud:', err.message);
      // fall through to cloud
    }
  }

  const verkadaUrl = buildStreamUrl({ cameraId, jwt: 'placeholder', resolution });
  const stripped = new URL(verkadaUrl);
  stripped.searchParams.delete('jwt');
  return serveMasterPlaylist(res, stripped.toString(), segMount);
}

export function serveCloudSegment(req, res, segMount) {
  return serveSegment(req, res, segMount);
}

export function serveLocalSegment(req, res, cameraId, transcode = false) {
  const dir = getSessionDir(cameraId, transcode);
  if (!dir) return res.status(404).end();
  return serveLocalFile(dir, req.params.file, res);
}
