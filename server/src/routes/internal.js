import express from 'express';
import {
  verifyInternalRef,
  serveMasterPlaylist,
  serveSegment,
} from '../hlsProxy.js';
import { buildStreamUrl } from '../verkada.js';

// Server-internal HLS feed for the on-the-fly transcoder.
//
// ffmpeg (running in this same process's host) pulls the Verkada stream through
// THIS route rather than directly from Verkada. That lets the existing proxy
// re-attach a fresh streaming JWT on every segment, so a long-running transcode
// never dies when the 30-minute JWT expires. The route is gated by an HMAC
// token (signInternalRef) that only the server can produce; it is never exposed
// to browsers.

const router = express.Router();

function selfBase() {
  return `http://127.0.0.1:${process.env.PORT || 8080}`;
}

function verkadaUrlNoJwt(cameraId, resolution) {
  const u = new URL(buildStreamUrl({ cameraId, jwt: 'x', resolution }));
  u.searchParams.delete('jwt');
  return u.toString();
}

router.get('/tx/:cameraId/:resolution/index.m3u8', async (req, res) => {
  try {
    const { cameraId, resolution } = req.params;
    if (!verifyInternalRef(req.query.k, cameraId, resolution)) return res.status(403).end();
    const base = `${selfBase()}/api/internal/tx/${encodeURIComponent(
      cameraId
    )}/${encodeURIComponent(resolution)}`;
    const segMount = `${base}/seg/${encodeURIComponent(req.query.k)}`;
    await serveMasterPlaylist(res, verkadaUrlNoJwt(cameraId, resolution), segMount);
  } catch (err) {
    console.error('[internal] master error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

router.get('/tx/:cameraId/:resolution/seg/:k', async (req, res) => {
  try {
    const { cameraId, resolution, k } = req.params;
    if (!verifyInternalRef(k, cameraId, resolution)) return res.status(403).end();
    const base = `${selfBase()}/api/internal/tx/${encodeURIComponent(
      cameraId
    )}/${encodeURIComponent(resolution)}`;
    const segMount = `${base}/seg/${encodeURIComponent(k)}`;
    await serveSegment(req, res, segMount);
  } catch (err) {
    console.error('[internal] segment error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

export default router;
