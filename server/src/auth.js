import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getSetting, setSetting } from './db.js';

// Simple single-admin auth. The admin password hash lives in settings.
// On first boot, if ADMIN_PASSWORD env is set and no hash exists, it is seeded.
// Sessions are stateless HMAC-signed cookies.

const COOKIE = 'vv_session';

function sessionSecret() {
  let s = getSetting('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', s);
  }
  return s;
}

export function isAdminConfigured() {
  return !!getSetting('admin_password_hash');
}

export function setAdminPassword(password) {
  const hash = bcrypt.hashSync(password, 10);
  setSetting('admin_password_hash', hash);
}

export function verifyAdminPassword(password) {
  const hash = getSetting('admin_password_hash');
  if (!hash) return false;
  return bcrypt.compareSync(password, hash);
}

export function seedAdminFromEnv() {
  if (!isAdminConfigured() && process.env.ADMIN_PASSWORD) {
    setAdminPassword(process.env.ADMIN_PASSWORD);
    console.log('[auth] Seeded admin password from ADMIN_PASSWORD env.');
  }
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', sessionSecret())
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(data)
    .digest('base64url');
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueSession(res) {
  const token = sign({ admin: true, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === '1',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireAdmin(req, res, next) {
  const payload = verify(req.cookies?.[COOKIE]);
  if (!payload?.admin) return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function isAuthed(req) {
  return !!verify(req.cookies?.[COOKIE])?.admin;
}
