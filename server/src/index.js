import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import adminRouter from './routes/admin.js';
import publicRouter from './routes/public.js';
import { seedAdminFromEnv } from './auth.js';
import { getBaseUrl } from './verkada.js';
import { registerAllowedHost } from './hlsProxy.js';
import { detectFfmpeg, ffmpegAvailable } from './rtsp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Seed admin + register allowed streaming host.
seedAdminFromEnv();
registerAllowedHost(getBaseUrl());
detectFfmpeg().then((ok) =>
  console.log(`[startup] ffmpeg ${ok ? 'available' : 'NOT found'} (local RTSP ${ok ? 'enabled' : 'disabled'})`)
);

app.get('/api/health', (req, res) =>
  res.json({ ok: true, ffmpeg: ffmpegAvailable() })
);

app.use('/api/admin', adminRouter);
app.use('/api/public', publicRouter);

// ---- serve built frontend ---------------------------------------------------
const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback for non-API routes.
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) =>
    res
      .type('text/plain')
      .send('Frontend not built yet. Run "npm run build" in /web (or use Docker).')
  );
}

app.listen(PORT, () => {
  console.log(`[startup] Verkada viewer listening on http://0.0.0.0:${PORT}`);
});
