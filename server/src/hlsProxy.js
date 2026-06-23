import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { getStreamingToken } from './verkada.js';

// Secure HLS proxy.
//
// The browser never sees the Verkada API key or the streaming JWT. We fetch the
// HLS playlist server-side, rewrite every segment / sub-playlist URL to point
// back at our own /seg endpoint, and sign each rewritten URL with an HMAC so
// that only URLs we generated can be replayed through the proxy. When a segment
// is requested we re-attach a fresh JWT server-side.

const ALLOWED_HOSTS = new Set(['api.verkada.com']);

function proxySecret() {
  let s = getSetting('proxy_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('proxy_secret', s);
  }
  return s;
}

function signUrl(absoluteUrl) {
  const data = Buffer.from(absoluteUrl).toString('base64url');
  const sig = crypto.createHmac('sha256', proxySecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySignedUrl(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', proxySecret()).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const url = Buffer.from(data, 'base64url').toString('utf8');
    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Sign a server-internal reference to a (cameraId, resolution) pair. Used to
// authorize the internal transcode-feed route so it cannot be abused externally
// (the token is never exposed to browsers — only ffmpeg, server-side).
export function signInternalRef(cameraId, resolution) {
  const data = `${cameraId}|${resolution}`;
  return crypto.createHmac('sha256', proxySecret()).update(data).digest('base64url');
}

export function verifyInternalRef(token, cameraId, resolution) {
  if (!token) return false;
  const expected = signInternalRef(cameraId, resolution);
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Allow the configured custom Verkada base host (e.g. for EU regions).
export function registerAllowedHost(baseUrl) {
  try {
    ALLOWED_HOSTS.add(new URL(baseUrl).hostname);
  } catch {
    /* ignore */
  }
}

function isPlaylist(contentType, body) {
  if (contentType && /mpegurl/i.test(contentType)) return true;
  return typeof body === 'string' && body.trimStart().startsWith('#EXTM3U');
}

// Rewrite all URIs in an m3u8 so they route through `${segMount}?u=...`.
function rewritePlaylist(playlistText, playlistAbsoluteUrl, segMount) {
  const lines = playlistText.split(/\r?\n/);
  const out = lines.map((line) => {
    if (line === '') return line;
    if (line.startsWith('#')) {
      // Rewrite any URI="..." attribute (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, etc.)
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        return `URI="${toProxy(uri, playlistAbsoluteUrl, segMount)}"`;
      });
    }
    // Plain URI line (segment or variant playlist).
    return toProxy(line.trim(), playlistAbsoluteUrl, segMount);
  });
  return out.join('\n');
}

function toProxy(uri, baseUrl, segMount) {
  let abs;
  try {
    abs = new URL(uri, baseUrl);
  } catch {
    return uri;
  }
  abs.searchParams.delete('jwt');
  return `${segMount}?u=${encodeURIComponent(signUrl(abs.toString()))}`;
}

async function fetchWithJwt(absoluteUrl) {
  const jwt = await getStreamingToken();
  const url = new URL(absoluteUrl);
  url.searchParams.set('jwt', jwt);
  return fetch(url, { headers: { accept: '*/*' } });
}

// Serve the master playlist for a given Verkada stream URL.
// `verkadaUrl` should already include camera_id/org_id/resolution but NOT jwt.
export async function serveMasterPlaylist(res, verkadaUrl, segMount) {
  try {
    const upstream = await fetchWithJwt(verkadaUrl);
    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(upstream.status).type('text/plain').send(txt.slice(0, 500));
    }
    const text = await upstream.text();
    const stripped = new URL(verkadaUrl);
    stripped.searchParams.delete('jwt');
    const rewritten = rewritePlaylist(text, stripped.toString(), segMount);
    res.set('Cache-Control', 'no-store');
    res.type('application/vnd.apple.mpegurl').send(rewritten);
  } catch (err) {
    console.error('[hlsProxy] master playlist error:', err.message);
    res.status(502).json({ error: 'stream_unavailable', detail: err.message });
  }
}

// Serve a proxied segment OR sub-playlist (auto-detected). `segMount` is the
// path used to rewrite any nested playlist URIs.
export async function serveSegment(req, res, segMount) {
  const parsed = verifySignedUrl(req.query.u);
  if (!parsed) return res.status(403).json({ error: 'invalid_segment_url' });
  try {
    const upstream = await fetchWithJwt(parsed.toString());
    if (!upstream.ok) {
      return res.status(upstream.status).end();
    }
    const contentType = upstream.headers.get('content-type') || '';
    // Peek for playlist content.
    if (/mpegurl/i.test(contentType) || /\.m3u8(\?|$)/i.test(parsed.pathname)) {
      const text = await upstream.text();
      if (isPlaylist(contentType, text)) {
        const stripped = new URL(parsed.toString());
        stripped.searchParams.delete('jwt');
        const rewritten = rewritePlaylist(text, stripped.toString(), segMount);
        res.set('Cache-Control', 'no-store');
        return res.type('application/vnd.apple.mpegurl').send(rewritten);
      }
      return res.type(contentType || 'application/vnd.apple.mpegurl').send(text);
    }
    // Binary media segment: stream through.
    res.set('Cache-Control', 'no-store');
    if (contentType) res.type(contentType);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.error('[hlsProxy] segment error:', err.message);
    res.status(502).end();
  }
}
