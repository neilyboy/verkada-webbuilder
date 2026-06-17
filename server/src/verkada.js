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

// Returns the set of camera_ids the current API key is permitted to stream,
// based on the accessibleCameras / accessibleSites in the streaming token.
export async function getStreamableScope() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Verkada API key is not configured');
  const body = await rawFetch('GET', '/cameras/v1/footage/token', {
    query: { exclude_accessible_resources: false },
    headers: { 'x-api-key': apiKey },
  });
  const sites = new Set(body.accessibleSites || []);
  const cameras = new Set(
    (body.accessibleCameras || []).map((c) =>
      typeof c === 'string' ? c : c.camera_id || c.cameraId || c.id
    )
  );
  return { jwt: body.jwt || body.token, sites, cameras, permission: body.permission || [] };
}

// True if a camera is within the API key's streaming scope.
function isStreamable(cam, scope) {
  return scope.cameras.has(cam.camera_id) || scope.sites.has(cam.site_id);
}

export async function listStreamableCameraIds() {
  try {
    const [cams, scope] = await Promise.all([listCameras(), getStreamableScope()]);
    return cams.filter((c) => isStreamable(c, scope)).map((c) => c.camera_id);
  } catch {
    return [];
  }
}

// End-to-end streaming self-test: lists cameras, checks the key's streaming
// scope, and tries to fetch a live playlist for an in-scope camera. Surfaces a
// precise hint when the org_id is wrong or the key lacks streaming permission.
export async function testStream() {
  const cams = await listCameras();
  if (!cams.length) return { ok: false, message: 'No cameras available to test.' };
  if (!getOrgId()) {
    return {
      ok: false,
      message: 'Organization ID is not set.',
      hint: 'Copy it from Verkada Command → All Products → Admin → Org Settings → Verkada API.',
    };
  }

  const scope = await getStreamableScope();
  const streamable = cams.filter((c) => isStreamable(c, scope));

  if (!streamable.length) {
    return {
      ok: false,
      message: `Your API key has streaming access to ${scope.cameras.size} camera(s) / ${scope.sites.size} site(s), but none of them match your ${cams.length} cameras.`,
      hint:
        'Re-generate the API key in Verkada Command → All Products → Admin → API & Integration → API Keys. Enable the "Streaming — Live/Historical" endpoint, and under Streaming select the sites/cameras you want to view (or "All sites"). Then paste the new key here.',
    };
  }

  const cam = streamable.find((c) => c.status === 'Live') || streamable[0];
  const url = buildStreamUrl({ cameraId: cam.camera_id, jwt: scope.jwt, resolution: 'low_res' });
  const res = await fetch(url, { headers: { accept: '*/*' } });
  if (res.ok) return { ok: true, camera: cam.name, streamable: streamable.length, total: cams.length };

  let message = res.statusText;
  try {
    message = JSON.parse(await res.text()).message || message;
  } catch {
    /* ignore */
  }
  let hint = null;
  if (res.status === 404 || /org_id/i.test(message)) {
    hint =
      'The Organization ID may be incorrect. Copy the exact value from Verkada Command → Admin → Org Settings → Verkada API.';
  } else if (res.status === 403) {
    hint =
      'The API key lacks streaming permission for this camera. Re-generate it with the "Streaming — Live/Historical" endpoint enabled for the relevant sites/cameras.';
  }
  return { ok: false, status: res.status, message, hint };
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
