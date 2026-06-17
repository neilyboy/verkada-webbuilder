# Deployment Guide

Full instructions for deploying **Verkada Website Viewer** on an Ubuntu (or any Linux)
server with Docker. Covers a basic deploy, HTTPS via a reverse proxy, updates, backups,
and troubleshooting.

---

## 1. Prerequisites

- A Linux server (Ubuntu 22.04+ recommended).
- **Docker Engine** and the **Docker Compose plugin**.
- A Verkada **API key** (Camera read + streaming permissions) and your **Organization ID**.
- (Optional) A domain name pointed at the server if you want HTTPS.
- (Optional) Per-camera **RTSP** enabled in Verkada Command for local HQ streaming.

Install Docker (Ubuntu):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in afterwards so 'docker' works without sudo
```

Verify:

```bash
docker --version
docker compose version
```

---

## 2. Get the code

```bash
git clone https://github.com/neilyboy/verkada-webbuilder.git
cd verkada-webbuilder
```

---

## 3. Configure environment

```bash
cp .env.example .env
```

Generate a strong master key and put it in `.env`:

```bash
echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env   # or edit .env by hand
```

`.env` reference:

| Variable           | Required | Description                                                                 |
|--------------------|----------|-----------------------------------------------------------------------------|
| `MASTER_KEY`       | **Yes**  | Secret that encrypts the stored Verkada API key. Keep it stable & private.  |
| `ADMIN_PASSWORD`   | No       | Seeds the admin password on first boot. Otherwise set it in the browser.    |
| `TRUST_PROXY`      | No       | Set to `1` when behind an HTTPS reverse proxy (enables secure cookies).     |
| `VERKADA_BASE_URL` | No       | Region override, e.g. `https://api.eu.verkada.com`. Default is US.          |
| `APP_PORT`         | No       | Host port to expose (container always listens on 8080). Default `8080`.     |

> **Important:** If you ever change or lose `MASTER_KEY`, the stored API key can no longer
> be decrypted and you'll need to re-enter it in Settings. Back it up securely.

---

## 4. Build and run

```bash
docker compose up -d --build
```

Check it's healthy:

```bash
docker compose ps
curl -s http://localhost:${APP_PORT:-8080}/api/health   # -> {"ok":true,"ffmpeg":true}
docker compose logs -f app
```

Open `http://<server-ip>:<APP_PORT>` and:

1. Create the admin password (first run).
2. **Settings** → paste API key + Org ID → **Save** → **Test connection**.
3. **Cameras** → **Sync from Verkada**.
4. **Pages** → **New page** → build, set **Published**, **Save**, copy the share link.

---

## 5. HTTPS with a reverse proxy (recommended)

Run the app bound to localhost and terminate TLS at a proxy. Set `TRUST_PROXY=1` in `.env`
and `docker compose up -d` again.

### Option A — Caddy (automatic Let's Encrypt)

`/etc/caddy/Caddyfile`:

```
cameras.example.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

### Option B — Nginx + Certbot

`/etc/nginx/sites-available/verkada`:

```nginx
server {
    listen 80;
    server_name cameras.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # important for live HLS
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/verkada /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d cameras.example.com
```

---

## 6. Local RTSP (optional, high quality, low cloud bandwidth)

1. In Verkada Command: camera → **Settings → Device → enable RTSP**, set a user/password.
2. Copy the RTSP URL (replace `[PASSWORD]`).
3. In the app: **Cameras → ⚙ Local source** → paste the URL → tick **Prefer local**.

The server pulls RTSP over your LAN and transcodes to HLS with `ffmpeg` (bundled in the
image). RTSP only works from the camera's local network (RFC1918), so **the server must be
able to reach the cameras' LAN**.

If the default Docker bridge network can't reach your cameras, use host networking — edit
`docker-compose.yml`:

```yaml
    # ports:                 # not needed with host networking
    #   - "${APP_PORT:-8080}:8080"
    network_mode: host       # app will listen on the host's :8080
```

Then `docker compose up -d`.

---

## 7. Raspberry Pi / TV kiosk

Append `&kiosk=1` to a share link to hide the header, and launch Chromium fullscreen:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  "https://cameras.example.com/v/<slug>?t=<token>&kiosk=1"
```

> A **Pi Zero W** is underpowered for in-browser HLS. For a single TV camera prefer a
> Pi Zero 2 W / Pi 3+, or play the camera's RTSP feed directly with `mpv` for the lightest
> footprint:
>
> ```bash
> mpv --fullscreen --profile=low-latency rtsp://user:pass@<camera-ip>:8554/...
> ```

---

## 8. Updating

```bash
cd verkada-webbuilder
git pull
docker compose up -d --build
```

Your data (SQLite DB + encrypted secrets) lives in `./data` and survives rebuilds.

---

## 9. Backups

Everything stateful is in `./data`. Back it up together with your `MASTER_KEY`:

```bash
docker compose down
tar czf verkada-viewer-backup-$(date +%F).tar.gz data .env
docker compose up -d
```

Restore by extracting the archive into the project directory before `docker compose up -d`.

---

## 10. Operations cheatsheet

```bash
docker compose ps                 # status
docker compose logs -f app        # live logs
docker compose restart app        # restart
docker compose down               # stop & remove container (keeps ./data)
docker compose up -d --build      # rebuild & start
```

---

## 11. Troubleshooting

| Symptom                                   | Cause / Fix                                                                 |
|-------------------------------------------|------------------------------------------------------------------------------|
| `Bind for 0.0.0.0:8080 failed`            | Port in use. Set a different `APP_PORT` in `.env`.                          |
| `Verkada API key is not configured`       | Set the key in **Settings** and Save.                                       |
| Test connection fails (401/403)           | Wrong key, wrong region (`VERKADA_BASE_URL`), or missing camera permissions.|
| Cameras list empty                        | Click **Sync from Verkada** after saving a valid key.                        |
| Video shows "Stream unavailable"          | Check Org ID is set; check `docker compose logs app` for the upstream error.|
| Local RTSP won't start                    | Verify RTSP is enabled on the camera, URL/credentials are correct, and the server can reach the camera's LAN (consider `network_mode: host`). |
| HEVC stream won't play in some browsers    | Some browsers can't decode H.265. Use `low_res`, or stream via a Chromium/Safari client. |
| Login works but logs you out behind proxy | Set `TRUST_PROXY=1` and ensure the proxy forwards `X-Forwarded-Proto`.       |

---

## 12. Security notes

- The Verkada API key and RTSP credentials are **encrypted at rest** (AES-256-GCM) and are
  **never** sent to viewers. The backend proxies HLS so the streaming JWT stays server-side.
- Each published page is **locked to its assigned cameras**; viewers cannot request others.
- Use **Require access token** on pages and **rotate** the token to revoke old links.
- Always run behind HTTPS in production and set `TRUST_PROXY=1`.
- Restrict who can reach the admin console (firewall, VPN, or proxy auth) for defense in depth.
