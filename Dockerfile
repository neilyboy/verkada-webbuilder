# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend ----
FROM node:20-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- Stage 2: runtime (Node API + ffmpeg + built frontend) ----
FROM node:20-bookworm-slim
# ffmpeg for optional local RTSP -> HLS transcoding.
# build tools for compiling better-sqlite3 native bindings.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/ ./

# Built frontend (server serves /app/web/dist).
COPY --from=web /app/web/dist /app/web/dist

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "src/index.js"]
