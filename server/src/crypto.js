import crypto from 'node:crypto';

// AES-256-GCM encryption for secrets at rest (API key, RTSP credentials).
// The master key is derived from the MASTER_KEY environment variable.
// If MASTER_KEY is not set, a warning is printed and a non-persistent key is
// generated (secrets will not survive a restart) so the app still boots.

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.MASTER_KEY;
  if (!raw || raw.length < 16) {
    console.warn(
      '[crypto] MASTER_KEY is missing or too short. Generating an ephemeral key. ' +
        'Stored secrets will NOT survive a restart. Set a strong MASTER_KEY in your .env.'
    );
    cachedKey = crypto.randomBytes(32);
    return cachedKey;
  }
  // Derive a stable 32-byte key from whatever string the user provides.
  cachedKey = crypto.createHash('sha256').update(raw, 'utf8').digest();
  return cachedKey;
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: v1:<iv>:<tag>:<ciphertext>  (all base64url)
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join(':');
}

export function decrypt(payload) {
  if (payload == null) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
    if (version !== 'v1') throw new Error('unknown ciphertext version');
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch (err) {
    console.error('[crypto] Failed to decrypt secret:', err.message);
    return null;
  }
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
