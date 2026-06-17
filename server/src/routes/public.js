import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { servePlaylist, serveCloudSegment, serveLocalSegment } from '../streamCore.js';

const router = express.Router();

function getPage(slug) {
  return db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
}

function tokenOk(page, t) {
  if (!page.require_token) return true;
  if (!t || !page.access_token) return false;
  const a = Buffer.from(String(t));
  const b = Buffer.from(page.access_token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function slotCameraIds(config) {
  return (config.slots || []).map((s) => s.cameraId).filter(Boolean);
}

// Sanitized page metadata for the viewer (no secrets).
router.get('/pages/:slug', (req, res) => {
  const page = getPage(req.params.slug);
  if (!page || !page.published) return res.status(404).json({ error: 'not_found' });
  if (!tokenOk(page, req.query.t)) return res.status(401).json({ error: 'token_required' });

  const config = page.config ? JSON.parse(page.config) : {};
  const camRows = db.prepare('SELECT camera_id, name, site FROM cameras').all();
  const camMap = Object.fromEntries(camRows.map((c) => [c.camera_id, c]));
  const slots = (config.slots || []).map((s) => ({
    ...s,
    name: s.label || camMap[s.cameraId]?.name || 'Camera',
  }));

  res.json({
    page: {
      name: page.name,
      slug: page.slug,
      config: { ...config, slots },
    },
  });
});

function ensureCameraAllowed(req, res, next) {
  const page = getPage(req.params.slug);
  if (!page || !page.published) return res.status(404).json({ error: 'not_found' });
  if (!tokenOk(page, req.query.t)) return res.status(401).json({ error: 'token_required' });
  const config = page.config ? JSON.parse(page.config) : {};
  if (!slotCameraIds(config).includes(req.params.cameraId)) {
    return res.status(403).json({ error: 'camera_not_in_page' });
  }
  req._page = page;
  req._config = config;
  next();
}

// Master playlist for a camera on a published page.
router.get('/pages/:slug/cam/:cameraId/index.m3u8', ensureCameraAllowed, async (req, res) => {
  const base = `/api/public/pages/${encodeURIComponent(req.params.slug)}/cam/${encodeURIComponent(
    req.params.cameraId
  )}`;
  await servePlaylist(req, res, {
    cameraId: req.params.cameraId,
    resolution: req.query.res === 'high_res' ? 'high_res' : req._config.resolution || 'low_res',
    mode: req.query.mode || 'auto',
    transcode: req.query.transcode === '1',
    segMount: `${base}/seg`,
    localBase: `${base}/local`,
  });
});

// Cloud segment proxy (HMAC-signed URLs, validated inside serveSegment).
router.get('/pages/:slug/cam/:cameraId/seg', (req, res) => {
  const base = `/api/public/pages/${encodeURIComponent(req.params.slug)}/cam/${encodeURIComponent(
    req.params.cameraId
  )}`;
  serveCloudSegment(req, res, `${base}/seg`);
});

// Local (RTSP->HLS) segment files.
router.get('/pages/:slug/cam/:cameraId/local/:file', (req, res) => {
  serveLocalSegment(req, res, req.params.cameraId, req.query.transcode === '1');
});

export default router;
