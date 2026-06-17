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

// Low-level request helper. Handles URL/query building and error parsing.
async function rawFetch(method, pathname, { query, headers } = {}) {
  const url = new URL(pathname, getBaseUrl());
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    method,
    headers: { accept: 'application/json', ...headers },
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

// Short-lived API token (valid 30 min). Exchanged from the top-level API key
// via POST /token, then sent as the `x-verkada-auth` header on standard
// endpoints. Cached and refreshed at ~29 minutes.
let apiTokenCache = { token: null, expiresAt: 0 };

export async function getApiToken() {
  const now = Date.now();
  if (apiTokenCache.token && now < apiTokenCache.expiresAt) return apiTokenCache.token;
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Verkada API key is not configured');
  const body = await rawFetch('POST', '/token', { headers: { 'x-api-key': apiKey } });
  const token = body.token;
  if (!token) throw new Error('Verkada did not return an API token from /token');
  apiTokenCache = { token, expiresAt: now + 29 * 60 * 1000 };
  return token;
}

export function clearApiToken() {
  apiTokenCache = { token: null, expiresAt: 0 };
}

// Authenticated request to a standard endpoint using the `x-verkada-auth`
// API token. Retries once if the token is rejected (expired/invalid).
async function apiFetch(pathname, { query } = {}) {
  let token = await getApiToken();
  try {
    return await rawFetch('GET', pathname, { query, headers: { 'x-verkada-auth': token } });
  } catch (err) {
    if (err.status === 401) {
      clearApiToken();
      token = await getApiToken();
      return rawFetch('GET', pathname, { query, headers: { 'x-verkada-auth': token } });
    }
    throw err;
  }
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
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Verkada API key is not configured');
  // The Get Streaming Token endpoint authenticates with the top-level API key
  // directly (x-api-key), NOT the x-verkada-auth API token.
  const body = await rawFetch('GET', '/cameras/v1/footage/token', {
    query: { exclude_accessible_resources: true },
    headers: { 'x-api-key': apiKey },
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
