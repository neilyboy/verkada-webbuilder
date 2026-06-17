# Verkada Website Viewer

A self-hosted, Dockerized web app that lets you build **customizable, per-user live
camera pages** backed by the Verkada Command API. Insert your API key once, list your
cameras, then visually build pages (multiple video tiles in different layouts, custom
title/logo/text) and share a unique link per user, location, or display.

Designed to be delivered to browsers, phones, and lightweight kiosk devices
(e.g. a Raspberry Pi on a TV in the service center).

## Highlights

- **Secure by design** — your Verkada API key is encrypted at rest (AES-256-GCM) and is
  *never* sent to the browser. The server **proxies the HLS stream**, so the streaming
  JWT never leaves the server and each published page is locked to only its assigned
  cameras.
- **Page builder** — pick a layout (single, 2×2, 3×3, 1-big-+-3, big-top-+-3, etc.),
  drop a camera into each slot, add a title, logo, header/footer text, theme and accent.
- **Bandwidth aware** — default `low_res` cloud streaming to save bandwidth, with an
  optional `high_res` toggle.
- **Optional local HQ streaming** — configure a camera's RTSP URL and the server pulls
  the high-quality feed directly over your LAN (no Verkada cloud bandwidth), transcoding
  it to browser-friendly HLS with `ffmpeg`.
- **Kiosk friendly** — append `&kiosk=1` to a share link to hide chrome for a clean
  full-screen display.

## Architecture

```
Browser / Pi  ──HLS──>  This app (Node/Express)  ──HLS (cloud)──>  api.verkada.com
                              │
                              └──RTSP (LAN, optional)──>  Verkada camera :8554  ──ffmpeg──> HLS
```

- **Backend:** Node.js + Express + SQLite (`better-sqlite3`).
- **Frontend:** React + Vite + Tailwind + HLS.js (built and served by the backend).
- **Single container.** SQLite DB and secrets persist in the `/data` volume.

### How streaming works (and why it's safe)

1. List cameras: `GET /cameras/v1/devices` with the `x-api-key` header.
2. Mint a 30-minute streaming JWT: `GET /cameras/v1/footage/token` (cached server-side).
3. The server fetches the Verkada HLS playlist, **rewrites every segment URL** to point
   back at its own signed proxy endpoint, and re-attaches the JWT server-side for each
   segment. The browser only ever sees same-origin URLs.

## Quick start (Docker — recommended)

```bash
cp .env.example .env
# edit .env and set a strong MASTER_KEY (openssl rand -base64 32)

docker compose up -d --build
```

Open `http://<server-ip>:8080`:

1. Create the admin password (first run).
2. Go to **Settings** → paste your **Verkada API key** and **Organization ID**, Save,
   then **Test connection**.
3. Go to **Cameras** → **Sync from Verkada** to pull your camera list.
4. Go to **Pages** → **New page** → choose a layout, assign cameras, brand it, set
   **Published**, **Save**, and copy the share link.

> **Keep `MASTER_KEY` safe and stable.** It encrypts your stored API key. If you change
> or lose it, you'll need to re-enter the API key.

For production deployment (HTTPS reverse proxy, updates, backups, kiosk, troubleshooting),
see **[DEPLOY.md](./DEPLOY.md)**.

## Local development

```bash
npm run install:all
# terminal 1 — API on :8080
MASTER_KEY=dev-secret npm run dev:server
# terminal 2 — Vite dev server on :5173 (proxies /api to :8080)
npm run dev:web
```

Visit `http://localhost:5173`.

## Verkada setup notes

- **API key + Org ID:** Create an API key in Verkada Command (Settings → API). Camera
  read + streaming permissions are required. The Org ID is also in Command.
- **Cloud streaming** works anywhere and is the default. `low_res` saves bandwidth.
- **Local RTSP (optional, HQ, low cloud bandwidth):**
  1. In Command, open a camera → **Settings → Device → enable RTSP**, set a username/password.
  2. Copy the camera's RTSP URL (replace `[PASSWORD]`).
  3. In this app: **Cameras → ⚙ (Local source)** → paste the RTSP URL and tick
     *Prefer local*.
  - RTSP only works from the camera's local network (RFC1918). The **server** must be
    able to reach the camera's LAN. If using the default Docker bridge can't reach it,
    set `network_mode: host` in `docker-compose.yml`.
  - Note: port-4100 "local streaming" is a feature of the Verkada Command player and is
    **not** exposed by the public API; RTSP is the API-supported local path.

## Raspberry Pi / TV kiosk

Use a share link with `&kiosk=1` and launch Chromium in kiosk mode:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  "http://<server-ip>:8080/v/<slug>?t=<token>&kiosk=1"
```

> A **Pi Zero W** is very underpowered for in-browser HLS decode. For a single camera on
> a TV, a Pi Zero 2 W / Pi 3+ is recommended, or play the camera's RTSP feed directly with
> `mpv`/`ffmpeg` in fullscreen for the lightest footprint.

## Security checklist

- Set a strong, persistent `MASTER_KEY`.
- Put the app behind HTTPS (reverse proxy) and set `TRUST_PROXY=1`.
- Use *Require access token* on pages; rotate the token to revoke old links.
- The API key and RTSP credentials are encrypted at rest and never returned to clients.

## Project layout

```
server/   Node/Express API, HLS proxy, RTSP transcoder, SQLite
web/      React + Vite + Tailwind admin console, page builder, public viewer
Dockerfile, docker-compose.yml
```

## API surface (admin, cookie-authenticated)

- `POST /api/admin/setup|login|logout|change-password`
- `GET|POST /api/admin/settings`, `POST /api/admin/test`
- `GET /api/admin/cameras[?refresh=1]`, `POST /api/admin/cameras/:id/local`
- `GET|POST|PUT|DELETE /api/admin/pages[...]`, `POST /api/admin/pages/:id/rotate-token`
- `GET /api/admin/preview/:cameraId/index.m3u8` (live preview)

Public (per published page):

- `GET /api/public/pages/:slug`
- `GET /api/public/pages/:slug/cam/:cameraId/index.m3u8`
```
