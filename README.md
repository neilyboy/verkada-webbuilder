# Verkada Website Viewer

A self-hosted, Dockerized web app that lets you build **customizable, per-user live
camera pages** backed by the Verkada Command API. Insert your API key once, list your
cameras, then visually build pages (multiple video tiles in different layouts, custom
title/logo/text) and share a unique link per user, location, or display.

Designed to be delivered to browsers, phones, and lightweight kiosk devices
(e.g. a Raspberry Pi on a TV in the service center).

---

## Table of Contents

- [Highlights](#highlights)
- [Features](#features)
  - [Viewer Experience](#viewer-experience)
  - [Page Builder](#page-builder)
  - [Streaming & Transcoding](#streaming--transcoding)
  - [Security](#security)
- [Architecture](#architecture)
- [Quick Start (Docker)](#quick-start-docker--recommended)
- [Local Development](#local-development)
- [Verkada Setup Notes](#verkada-setup-notes)
- [Raspberry Pi / TV Kiosk](#raspberry-pi--tv-kiosk)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Security Checklist](#security-checklist)
- [Project Layout](#project-layout)
- [API Surface](#api-surface)

---

## Highlights

- **Secure by design** — your Verkada API key is encrypted at rest (AES-256-GCM) and is
  *never* sent to the browser. The server **proxies the HLS stream**, so the streaming
  JWT never leaves the server and each published page is locked to only its assigned
  cameras.
- **Page builder** — pick a layout (single, 2×2, 3×3, 1-big-+-3, big-top-+-3, 3-wide,
  6/8/12/16 grids, 1+5, etc.), drop a camera into each slot, add a title, logo,
  header/footer text, theme and accent color.
- **Bandwidth aware** — default `low_res` cloud streaming to save bandwidth, with an
  optional `high_res` toggle.
- **On-the-fly HEVC → H.264 transcoding** — Verkada HD streams use H.265 (HEVC) which
  Chrome/Firefox can't play. The server transcodes to H.264 in real-time using `ffmpeg`,
  so HD streams work in all browsers.
- **Kiosk friendly** — append `&kiosk=1` to a share link to hide chrome for a clean
  full-screen display.

---

## Features

### Viewer Experience

- **Fullscreen Spotlight** — Click the maximize button on any tile (or press a number
  key) to open that camera in fullscreen. Spotlight auto-defaults to HD+ (transcoded)
  for best quality at full size.
- **Quality Toggle in Spotlight** — Switch between SD, HD (native H.265, Safari only),
  and HD+ (transcoded H.264, all browsers) without leaving fullscreen.
- **Drag-and-Drop Rearrangement** — Viewers can drag tiles to rearrange cameras however
  they like. The arrangement is saved per-viewer in `localStorage` and never affects the
  saved page config. A reset button restores the original order.
- **Snapshot** — Click the camera icon on any playing tile to capture a still frame.
  Downloads as `cameraname_YYYY-MM-DDTHH-MM-SS.png`. Toggle snapshot mode with the
  camera icon in the header bar or press **S**.
- **Timestamp Overlay** — Live clock overlay on each tile showing date + time. Toggle
  with the clock icon in the header or press **T**.
- **Camera Cycling** — Auto-rotate through all cameras on the page in fullscreen
  spotlight every 10 seconds. Great for lobby displays and kiosks. Toggle with the
  repeat icon in the header or press **C**. Shows position indicator (e.g. 2/4) when
  active.
- **Smooth Transitions** — Spotlight overlay fades in with a smooth animation.

### Page Builder

- **15+ Layouts** — Single, 2 side-by-side, 3 wide, 2 stacked, 2×2 grid, 3×3 grid,
  1-big-+-3-right, 1-big-+-4-right, 1-big-+-5-right, 1-big-top-+-3-bottom,
  1-big-top-+-4-bottom, 6 (3×2), 8 (4×2), 12 (4×3), 16 (4×4).
- **Per-Tile Custom Labels** — Each slot has an optional custom label that overrides the
  camera name. Labels appear as an overlay on the bottom of each tile.
- **Camera Groups** — Save the current set of cameras as a named group, then apply it to
  any page with one click. Great for reusing the same camera set across multiple layouts.
  Groups are stored in SQLite and managed via the "Camera Groups" section in the page
  builder config panel.
- **Quality Settings** — Choose SD (H.264, plays everywhere), HD (native H.265, Safari
  only), or HD (transcoded) (H.264, all browsers, requires ffmpeg on server).
- **Branding** — Custom title, logo URL, header text, footer text, dark/light theme,
  and accent color picker.
- **Show/Hide Labels** — Toggle camera labels on/off per page.
- **Fit Mode** — Toggle between "cover" (fill tile, may crop) and "contain" (letterbox
  to show whole frame).
- **Live Preview** — See your page update in real-time as you configure it. Toggle the
  preview panel on/off.
- **Sharing & Access** — Set a custom URL slug, require access token (recommended),
  copy share link, rotate token to invalidate old links, and open the published page in
  a new tab.

### Streaming & Transcoding

- **Cloud HLS Proxy** — The server fetches Verkada HLS playlists, rewrites segment URLs
  to point through its own signed proxy, and re-attaches the streaming JWT server-side.
  The browser only sees same-origin URLs.
- **HEVC → H.264 Transcoding** — When HD+ quality is selected, the server runs `ffmpeg`
  to transcode the H.265 HD stream to H.264 in real-time. The transcode pipeline:
  - ffmpeg pulls the Verkada stream through an internal HMAC-gated proxy route
  - JWT is automatically refreshed every 30 minutes (long-running transcodes never die)
  - Segments are written to a temp directory and served via a dedicated route
  - Sessions auto-expire after 5 minutes of idle
  - Falls back to native cloud HLS if ffmpeg is unavailable
- **Local RTSP (Optional, HQ, Low Cloud Bandwidth)** — Configure a camera's RTSP URL
  and the server pulls the high-quality feed directly over your LAN, transcoding it to
  browser-friendly HLS with `ffmpeg`.
- **Pre-flight Manifest Polling** — When a transcode session is starting up, the server
  returns HTTP 503. The frontend polls until 200 before initializing hls.js, ensuring
  smooth playback without spinner loops.

### Security

- **API Key Encryption** — AES-256-GCM at rest, never sent to browsers.
- **HMAC-Signed Segment URLs** — Every proxied segment URL is HMAC-signed so only
  URLs generated by the server can be replayed through the proxy.
- **Internal Transcode Route** — The ffmpeg input route is gated by an HMAC token that
  only the server can produce; it's never exposed to browsers.
- **Access Tokens** — Each published page can require a token in the URL (`?t=...`).
  Tokens can be rotated to revoke old links.
- **Camera Access Control** — Public routes verify that a camera is assigned to the
  page before serving its stream.

---

## Architecture

```
Browser / Pi  ──HLS──>  This app (Node/Express)  ──HLS (cloud)──>  api.verkada.com
                              │
                              ├──ffmpeg──> H.264 HLS (transcoded HD)
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
4. For HD+ (transcoded), `ffmpeg` pulls the HD stream through an internal proxy route
   (which handles JWT refresh), transcodes to H.264, and writes HLS segments to disk.
   The server serves these segments to the browser via a token-authenticated route.

---

## Quick Start (Docker — recommended)

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

---

## Local Development

```bash
npm run install:all
# terminal 1 — API on :8080
MASTER_KEY=dev-secret npm run dev:server
# terminal 2 — Vite dev server on :5173 (proxies /api to :8080)
npm run dev:web
```

Visit `http://localhost:5173`.

---

## Verkada Setup Notes

- **API key + Org ID:** Create an API key in Verkada Command (Settings → API). Camera
  read + streaming permissions are required. The Org ID is also in Command
  (All Products → Admin → Org Settings → Verkada API).
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

---

## Raspberry Pi / TV Kiosk

Use a share link with `&kiosk=1` and launch Chromium in kiosk mode:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  "http://<server-ip>:8080/v/<slug>?t=<token>&kiosk=1"
```

> A **Pi Zero W** is very underpowered for in-browser HLS decode. For a single camera on
> a TV, a Pi Zero 2 W / Pi 3+ is recommended, or play the camera's RTSP feed directly with
> `mpv`/`ffmpeg` in fullscreen for the lightest footprint.

---

## Keyboard Shortcuts

Available on the viewer page:

| Key | Action |
|-----|--------|
| **1-9** | Spotlight camera 1-9 |
| **F** | Enter fullscreen (or fullscreen the spotlight) |
| **Q** | Cycle spotlight quality (SD → HD → HD+) |
| **S** | Toggle snapshot mode (camera icon on tiles) |
| **T** | Toggle timestamp overlay on all tiles |
| **C** | Toggle camera cycling (auto-rotate through cameras) |
| **Esc** | Close spotlight / exit fullscreen |

---

## Security Checklist

- Set a strong, persistent `MASTER_KEY`.
- Put the app behind HTTPS (reverse proxy) and set `TRUST_PROXY=1`.
- Use *Require access token* on pages; rotate the token to revoke old links.
- The API key and RTSP credentials are encrypted at rest and never returned to clients.

---

## Project Layout

```
server/
  src/
    index.js          Express app entry point
    db.js             SQLite database + schema + helpers
    verkada.js        Verkada API client (auth, cameras, streaming)
    hlsProxy.js       Secure HLS proxy (playlist rewriting, HMAC signing)
    streamCore.js     Stream routing (cloud, local RTSP, transcoded)
    transcode.js      On-the-fly HEVC → H.264 transcode session manager
    rtsp.js           Local RTSP → HLS transcode pipeline
    crypto.js         AES-256-GCM encrypt/decrypt
    routes/
      admin.js        Admin API (settings, cameras, pages, groups, preview)
      public.js       Public API (published pages, streaming)
      internal.js     Internal proxy for ffmpeg transcode input
web/
  src/
    pages/
      Viewer.jsx      Public viewer page (spotlight, cycling, shortcuts)
      PageBuilder.jsx Admin page builder (layout, cameras, branding, groups)
      Cameras.jsx     Camera list with streaming scope badges
      Settings.jsx    API key + org ID + connection test
    components/
      VideoTile.jsx   HLS video tile (snapshot, timestamp, error recovery)
      LayoutGrid.jsx  CSS grid layout renderer
    layouts.js        Layout preset definitions
    api.js            Fetch wrapper for admin API
Dockerfile, docker-compose.yml, .env.example
```

---

## API Surface

### Admin (cookie-authenticated)

- `POST /api/admin/setup|login|logout|change-password`
- `GET|POST /api/admin/settings`, `POST /api/admin/test`
- `GET /api/admin/cameras[?refresh=1]`, `POST /api/admin/cameras/:id/local`
- `GET|POST|PUT|DELETE /api/admin/pages[...]`, `POST /api/admin/pages/:id/rotate-token`
- `GET|POST /api/admin/groups`, `DELETE /api/admin/groups/:id`
- `GET /api/admin/preview/:cameraId/index.m3u8` (live preview)
- `GET /api/admin/preview/:cameraId/seg` (proxied segment)
- `GET /api/admin/preview/:cameraId/tx/:file` (transcoded segment)

### Public (per published page)

- `GET /api/public/pages/:slug` (page config + assigned cameras)
- `GET /api/public/pages/:slug/cam/:cameraId/index.m3u8` (HLS playlist)
- `GET /api/public/pages/:slug/cam/:cameraId/seg` (proxied segment)
- `GET /api/public/pages/:slug/cam/:cameraId/tx/:file` (transcoded segment)

### Internal (HMAC-gated, server-only)

- `GET /api/internal/tx/:cameraId/:resolution/index.m3u8` (ffmpeg input playlist)
- `GET /api/internal/tx/:cameraId/:resolution/seg/:k` (ffmpeg input segment)
