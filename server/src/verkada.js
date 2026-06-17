import { getSetting, setSetting } from './db.js';
import { encrypt, decrypt } from './crypto.js';

// Verkada Command API client.
// The top-level API key is stored encrypted in settings. We expose helpers to
// list cameras and to mint a short-lived streaming JWT (cached ~25 min).

const DEFAULT_BASE = process.env.VERKADA_BASE_URL || 'https://api.verkada.com';

export function getBaseUrl() {
  return getSetting('verkada_base_url') || DEFAULT_BASE;
}

export function getApiKey() {
  const enc = getSetting('verkada_api_key');
  return enc ? decrypt(enc) : null;
}

export function setApiKey(apiKey) {
  setSetting('verkada_api_key', encrypt(apiKey));
}

export function hasApiKey() {
  return !!getSetting('verkada_api_key');
}

export function getOrgId() {
  return getSetting('verkada_org_id') || null;
}

async function apiFetch(pathname, { query } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Verkada API key is not configured');
  const url = new URL(pathname, getBaseUrl());
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'x-api-key': apiKey },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.message || body?.error || res.statusText;
    const err = new Error(`Verkada API ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// List all cameras (handles pagination).
export async function listCameras() {
  const cameras = [];
  let pageToken = null;
  do {
    const body = await apiFetch('/cameras/v1/devices', {
      query: { page_size: 200, page_token: pageToken },
    });
    const batch = body.cameras || body.devices || [];
    cameras.push(...batch);
    pageToken = body.next_page_token || null;
  } while (pageToken);
  return cameras;
}

// Streaming JWT cache (token is valid 30 minutes; we refresh at ~25).
let jwtCache = { token: null, expiresAt: 0 };

export async function getStreamingToken() {
  const now = Date.now();
  if (jwtCache.token && now < jwtCache.expiresAt) return jwtCache.token;
  const body = await apiFetch('/cameras/v1/footage/token', {
    query: { exclude_accessible_resources: true },
  });
  const token = body.jwt || body.token;
  if (!token) throw new Error('Verkada did not return a streaming token');
  jwtCache = { token, expiresAt: now + 25 * 60 * 1000 };
  return token;
}

export function clearStreamingToken() {
  jwtCache = { token: null, expiresAt: 0 };
}

// Build the cloud HLS master playlist URL for a camera.
export function buildStreamUrl({ cameraId, jwt, resolution = 'low_res' }) {
  const orgId = getOrgId();
  const url = new URL('/stream/cameras/v1/footage/stream/stream.m3u8', getBaseUrl());
  if (orgId) url.searchParams.set('org_id', orgId);
  url.searchParams.set('camera_id', cameraId);
  url.searchParams.set('start_time', '0');
  url.searchParams.set('end_time', '0');
  url.searchParams.set('resolution', resolution);
  url.searchParams.set('type', 'stream');
  url.searchParams.set('jwt', jwt);
  return url.toString();
}
