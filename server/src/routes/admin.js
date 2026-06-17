import express from 'express';
import { nanoid } from 'nanoid';
import db, { getSetting, setSetting } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import {
  isAdminConfigured,
  setAdminPassword,
  verifyAdminPassword,
  issueSession,
  clearSession,
  requireAdmin,
  isAuthed,
} from '../auth.js';
import {
  setApiKey,
  hasApiKey,
  getOrgId,
  getBaseUrl,
  listCameras,
  clearStreamingToken,
} from '../verkada.js';
import { registerAllowedHost } from '../hlsProxy.js';
import { servePlaylist, serveCloudSegment, serveLocalSegment } from '../streamCore.js';

const router = express.Router();

// ---- status / setup / auth --------------------------------------------------
router.get('/status', (req, res) => {
  res.json({
    authed: isAuthed(req),
    adminConfigured: isAdminConfigured(),
    hasApiKey: hasApiKey(),
    orgId: getOrgId(),
  });
});

router.post('/setup', (req, res) => {
  if (isAdminConfigured()) return res.status(409).json({ error: 'already_configured' });
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  setAdminPassword(password);
  issueSession(res);
  res.json({ ok: true });
});

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!verifyAdminPassword(password || '')) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  issueSession(res);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.post('/change-password', requireAdmin, (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyAdminPassword(current || '')) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (!next || next.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  setAdminPassword(next);
  res.json({ ok: true });
});

// ---- Verkada settings -------------------------------------------------------
router.get('/settings', requireAdmin, (req, res) => {
  res.json({
    hasApiKey: hasApiKey(),
    orgId: getOrgId(),
    baseUrl: getBaseUrl(),
  });
});

router.post('/settings', requireAdmin, (req, res) => {
  const { apiKey, orgId, baseUrl } = req.body || {};
  if (typeof apiKey === 'string' && apiKey.trim()) {
    setApiKey(apiKey.trim());
    clearStreamingToken();
  }
  if (typeof orgId === 'string') setSetting('verkada_org_id', orgId.trim());
  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    setSetting('verkada_base_url', baseUrl.trim());
    registerAllowedHost(baseUrl.trim());
  }
  res.json({ ok: true, hasApiKey: hasApiKey(), orgId: getOrgId(), baseUrl: getBaseUrl() });
});

router.delete('/settings/api-key', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM settings WHERE key = 'verkada_api_key'").run();
  clearStreamingToken();
  res.json({ ok: true });
});

// Validate the stored key by hitting the live API.
router.post('/test', requireAdmin, async (req, res) => {
  try {
    const cams = await listCameras();
    res.json({ ok: true, count: cams.length });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---- cameras ----------------------------------------------------------------
function rowToCamera(row) {
  return {
    camera_id: row.camera_id,
    name: row.name,
    site: row.site,
    model: row.model,
    serial: row.serial,
    prefer_local: !!row.prefer_local,
    has_rtsp: !!row.rtsp_url,
    data: row.data ? JSON.parse(row.data) : null,
  };
}

router.get('/cameras', requireAdmin, async (req, res) => {
  if (req.query.refresh === '1') {
    try {
      const cams = await listCameras();
      const upsert = db.prepare(`
        INSERT INTO cameras (camera_id, name, site, model, serial, data, updated_at)
        VALUES (@camera_id, @name, @site, @model, @serial, @data, @updated_at)
        ON CONFLICT(camera_id) DO UPDATE SET
          name=excluded.name, site=excluded.site, model=excluded.model,
          serial=excluded.serial, data=excluded.data, updated_at=excluded.updated_at
      `);
      const now = Date.now();
      const tx = db.transaction((items) => {
        for (const c of items) {
          upsert.run({
            camera_id: c.camera_id || c.cameraId || c.id,
            name: c.name || c.camera_id || 'Camera',
            site: c.site || c.site_name || c.location || null,
            model: c.model || null,
            serial: c.serial || c.serial_number || null,
            data: JSON.stringify(c),
            updated_at: now,
          });
        }
      });
      tx(cams);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  const rows = db.prepare('SELECT * FROM cameras ORDER BY name').all();
  res.json({ cameras: rows.map(rowToCamera) });
});

router.post('/cameras/:id/local', requireAdmin, (req, res) => {
  const { rtspUrl, preferLocal } = req.body || {};
  const row = db.prepare('SELECT * FROM cameras WHERE camera_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'camera_not_found' });

  // rtspUrl: undefined => keep existing, '' => clear, otherwise => set encrypted
  let nextRtsp = row.rtsp_url;
  if (rtspUrl === '') nextRtsp = null;
  else if (typeof rtspUrl === 'string' && rtspUrl.trim()) nextRtsp = encrypt(rtspUrl.trim());

  const nextPrefer = preferLocal != null ? (preferLocal ? 1 : 0) : row.prefer_local;
  db.prepare('UPDATE cameras SET rtsp_url = ?, prefer_local = ? WHERE camera_id = ?').run(
    nextRtsp,
    nextPrefer,
    req.params.id
  );
  res.json({ ok: true });
});

// ---- pages ------------------------------------------------------------------
function rowToPage(row, includeToken = false) {
  const page = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    config: row.config ? JSON.parse(row.config) : {},
    require_token: !!row.require_token,
    published: !!row.published,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeToken) page.access_token = row.access_token;
  return page;
}

router.get('/pages', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all();
  res.json({ pages: rows.map((r) => rowToPage(r, true)) });
});

router.get('/pages/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ page: rowToPage(row, true) });
});

function slugify(name) {
  return (name || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'page';
}

function uniqueSlug(base) {
  let slug = base;
  let i = 1;
  while (db.prepare('SELECT 1 FROM pages WHERE slug = ?').get(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

router.post('/pages', requireAdmin, (req, res) => {
  const { name, config, slug, requireToken = true } = req.body || {};
  const id = nanoid(12);
  const finalSlug = uniqueSlug(slugify(slug || name));
  const now = Date.now();
  db.prepare(`
    INSERT INTO pages (id, slug, name, config, access_token, require_token, published, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    finalSlug,
    name || 'Untitled page',
    JSON.stringify(config || defaultConfig()),
    nanoid(20),
    requireToken ? 1 : 0,
    now,
    now
  );
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
  res.json({ page: rowToPage(row, true) });
});

router.put('/pages/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const { name, config, published, requireToken, slug } = req.body || {};
  let newSlug = row.slug;
  if (typeof slug === 'string' && slugify(slug) !== row.slug) {
    newSlug = uniqueSlug(slugify(slug));
  }
  db.prepare(`
    UPDATE pages SET name = ?, config = ?, published = ?, require_token = ?, slug = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name ?? row.name,
    config ? JSON.stringify(config) : row.config,
    published != null ? (published ? 1 : 0) : row.published,
    requireToken != null ? (requireToken ? 1 : 0) : row.require_token,
    newSlug,
    Date.now(),
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  res.json({ page: rowToPage(updated, true) });
});

router.post('/pages/:id/rotate-token', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const token = nanoid(20);
  db.prepare('UPDATE pages SET access_token = ?, updated_at = ? WHERE id = ?').run(
    token,
    Date.now(),
    req.params.id
  );
  res.json({ access_token: token });
});

router.delete('/pages/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- admin live preview (any camera) ---------------------------------------
router.get('/preview/:cameraId/index.m3u8', requireAdmin, async (req, res) => {
  const base = `/api/admin/preview/${encodeURIComponent(req.params.cameraId)}`;
  await servePlaylist(req, res, {
    cameraId: req.params.cameraId,
    resolution: req.query.res === 'high_res' ? 'high_res' : 'low_res',
    mode: req.query.mode || 'auto',
    transcode: req.query.transcode === '1',
    segMount: `${base}/seg`,
    localBase: `${base}/local`,
  });
});

router.get('/preview/:cameraId/seg', requireAdmin, (req, res) => {
  const base = `/api/admin/preview/${encodeURIComponent(req.params.cameraId)}`;
  serveCloudSegment(req, res, `${base}/seg`);
});

router.get('/preview/:cameraId/local/:file', requireAdmin, (req, res) => {
  serveLocalSegment(req, res, req.params.cameraId, req.query.transcode === '1');
});

function defaultConfig() {
  return {
    title: 'Live Cameras',
    logoUrl: '',
    headerText: '',
    footerText: '',
    theme: 'dark',
    accent: '#2563eb',
    layout: 'grid-2x2',
    resolution: 'low_res',
    refreshSeconds: 0,
    slots: [],
  };
}

export default router;
