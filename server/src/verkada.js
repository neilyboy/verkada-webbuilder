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

// Probe whether a single camera can actually be streamed right now. The token's
// accessibleSites/accessibleCameras fields are NOT reliable indicators, so we
// verify by fetching the live playlist (returns 200 when streamable, 403 when
// the key lacks permission for that camera's site).
async function probeCamera(cameraId, jwt) {
  try {
    const url = buildStreamUrl({ cameraId, jwt, resolution: 'low_res' });
    const res = await fetch(url, { headers: { accept: '*/*' } });
    return { status: res.status, ok: res.ok };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

// Cached list of camera_ids that are actually streamable (probed live).
let streamableCache = { ids: null, at: 0 };
const STREAMABLE_TTL = 10 * 60 * 1000;

export function clearStreamableCache() {
  streamableCache = { ids: null, at: 0 };
}

export async function listStreamableCameraIds({ force = false } = {}) {
  if (!force && streamableCache.ids && Date.now() - streamableCache.at < STREAMABLE_TTL) {
    return streamableCache.ids;
  }
  try {
    if (!getApiKey() || !getOrgId()) return [];
    const [cams, jwt] = await Promise.all([listCameras(), getStreamingToken()]);
    const results = await Promise.all(
      cams.map(async (c) => ((await probeCamera(c.camera_id, jwt)).ok ? c.camera_id : null))
    );
    const ids = results.filter(Boolean);
    streamableCache = { ids, at: Date.now() };
    return ids;
  } catch {
    return [];
  }
}

// End-to-end streaming self-test. Probes cameras to find which actually stream
// and surfaces a precise hint when nothing works.
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

  const ids = await listStreamableCameraIds({ force: true });
  if (ids.length) {
    const first = cams.find((c) => ids.includes(c.camera_id));
    return { ok: true, camera: first?.name, streamable: ids.length, total: cams.length };
  }

  // Nothing streamed — fetch one to get a representative error/status.
  const jwt = await getStreamingToken();
  const cam = cams.find((c) => c.status === 'Live') || cams[0];
  const res = await fetch(buildStreamUrl({ cameraId: cam.camera_id, jwt, resolution: 'low_res' }), {
    headers: { accept: '*/*' },
  });
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
      'The API key lacks streaming permission for these cameras. Re-generate it with the "Streaming — Live/Historical" endpoint enabled for the sites/cameras you want to view.';
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
