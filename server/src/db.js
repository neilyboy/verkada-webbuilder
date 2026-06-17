import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS cameras (
    camera_id   TEXT PRIMARY KEY,
    name        TEXT,
    site        TEXT,
    model       TEXT,
    serial      TEXT,
    data        TEXT,            -- raw JSON from Verkada
    rtsp_url    TEXT,            -- encrypted, optional local RTSP source
    prefer_local INTEGER DEFAULT 0,
    updated_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS pages (
    id           TEXT PRIMARY KEY,
    slug         TEXT UNIQUE,
    name         TEXT,
    config       TEXT,           -- JSON: layout, slots, theme, logo, text, resolution
    access_token TEXT,           -- token required to view (kept out of the URL path)
    require_token INTEGER DEFAULT 1,
    published    INTEGER DEFAULT 0,
    created_at   INTEGER,
    updated_at   INTEGER
  );
`);

// ---- settings helpers -------------------------------------------------------
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const delSettingStmt = db.prepare('DELETE FROM settings WHERE key = ?');

export function getSetting(key) {
  const row = getSettingStmt.get(key);
  return row ? row.value : null;
}
export function setSetting(key, value) {
  setSettingStmt.run(key, value);
}
export function deleteSetting(key) {
  delSettingStmt.run(key);
}

export default db;
