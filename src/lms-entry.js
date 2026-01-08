#!/usr/bin/env node
/**
 * Minimal entry point for LMS plugin
 *
 * Stripped version that only includes:
 * - LMS client (for player status, artwork, control)
 * - HQPlayer client (for DSP control)
 * - Image processing (sharp for resizing)
 * - mDNS advertising (for client discovery)
 * - Unified API endpoints (/zones, /now_playing, /control, etc.)
 *
 * No web UI, no Roon/UPnP/OpenHome adapters.
 */

const os = require('os');
const http = require('http');
const sharp = require('sharp');
const { LMSClient } = require('./lms/client');
const { HQPClient } = require('./hqplayer/client');
const { createLogger } = require('./lib/logger');
const { advertise } = require('./lib/mdns');

const PORT = parseInt(process.env.PORT, 10) || 9199;
const log = createLogger('LMS-Plugin');

log.info('Starting Unified Hi-Fi Control (LMS Plugin Mode)');

// Create LMS client (connects to parent LMS instance)
const lms = new LMSClient({
  host: process.env.LMS_HOST || 'localhost',
  port: parseInt(process.env.LMS_PORT, 10) || 9000,
  logger: createLogger('LMS'),
});

// Create HQPlayer client
const hqp = new HQPClient({
  logger: createLogger('HQP'),
});

// Pre-configure HQPlayer if env vars set
if (process.env.HQP_HOST) {
  hqp.configure({
    host: process.env.HQP_HOST,
    port: process.env.HQP_PORT || 8088,
    username: process.env.HQP_USER,
    password: process.env.HQP_PASS,
  });
  log.info('HQPlayer configured', { host: process.env.HQP_HOST });
}

// HTTP API - compatible with knob/phone/watch clients
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-knob-id, x-device-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // Health check
    if (path === '/health' || path === '/status') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'ok',
        mode: 'lms-plugin',
        service: 'unified-hifi-control',
        version: process.env.APP_VERSION || 'dev',
      }));
      return;
    }

    // GET /zones - list all LMS players as zones
    if (path === '/zones') {
      res.setHeader('Content-Type', 'application/json');
      const players = await lms.getPlayers();
      const zones = players.map(p => ({
        zone_id: `lms:${p.playerid}`,
        zone_name: p.name,
        output_name: p.model || 'Squeezebox',
        device_name: p.ip,
      }));
      res.end(JSON.stringify({ zones }));
      return;
    }

    // GET /now_playing - get current playback for a zone
    if (path === '/now_playing') {
      res.setHeader('Content-Type', 'application/json');
      const zoneId = url.searchParams.get('zone_id');
      if (!zoneId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'zone_id required' }));
        return;
      }

      // Extract player ID from zone_id (lms:xx:xx:xx:xx:xx:xx)
      const playerId = zoneId.replace(/^lms:/, '');
      const status = await lms.getPlayerStatus(playerId);

      if (!status) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Zone not found' }));
        return;
      }

      const response = {
        zone_id: zoneId,
        line1: status.title || 'Stopped',
        line2: status.artist || '',
        line3: status.album || '',
        is_playing: status.mode === 'play',
        volume: status.volume,
        volume_type: 'number',
        image_key: status.artwork_track_id || status.coverid,
        image_url: `/now_playing/image?zone_id=${encodeURIComponent(zoneId)}`,
      };

      // Include zones list for client convenience
      const players = await lms.getPlayers();
      response.zones = players.map(p => ({
        zone_id: `lms:${p.playerid}`,
        zone_name: p.name,
      }));

      res.end(JSON.stringify(response));
      return;
    }

    // GET /now_playing/image - album artwork with optional resizing
    if (path === '/now_playing/image') {
      const zoneId = url.searchParams.get('zone_id');
      const width = parseInt(url.searchParams.get('width'), 10) || 360;
      const height = parseInt(url.searchParams.get('height'), 10) || 360;
      const format = url.searchParams.get('format');

      if (!zoneId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'zone_id required' }));
        return;
      }

      const playerId = zoneId.replace(/^lms:/, '');
      const status = await lms.getPlayerStatus(playerId);
      const coverId = status?.artwork_track_id || status?.coverid;

      if (!coverId) {
        // Return placeholder
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <rect width="100%" height="100%" fill="#333"/>
          <text x="50%" y="50%" fill="#888" text-anchor="middle" dy=".3em" font-family="sans-serif" font-size="24">No Image</text>
        </svg>`);
        return;
      }

      try {
        const { contentType, body } = await lms.getArtwork(coverId);
        let imageBuffer = Buffer.from(await body.arrayBuffer());

        // RGB565 format for ESP32 displays
        if (format === 'rgb565') {
          const result = await sharp(imageBuffer)
            .resize(width, height, { fit: 'cover' })
            .raw()
            .toBuffer({ resolveWithObject: true });

          const rgb888 = result.data;
          const rgb565 = Buffer.alloc(width * height * 2);

          for (let i = 0; i < rgb888.length; i += 3) {
            const r = rgb888[i] >> 3;
            const g = rgb888[i + 1] >> 2;
            const b = rgb888[i + 2] >> 3;
            const pixel = (r << 11) | (g << 5) | b;
            const idx = (i / 3) * 2;
            rgb565[idx] = pixel & 0xFF;
            rgb565[idx + 1] = (pixel >> 8) & 0xFF;
          }

          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('X-Image-Width', width.toString());
          res.setHeader('X-Image-Height', height.toString());
          res.setHeader('X-Image-Format', 'rgb565');
          res.end(rgb565);
          return;
        }

        // Resize and return JPEG
        imageBuffer = await sharp(imageBuffer)
          .resize(width, height, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toBuffer();

        res.setHeader('Content-Type', 'image/jpeg');
        res.end(imageBuffer);
        return;

      } catch (err) {
        log.warn('Artwork fetch failed', { error: err.message });
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <rect width="100%" height="100%" fill="#333"/>
        </svg>`);
        return;
      }
    }

    // POST /control - transport controls
    if (path === '/control' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      const body = await readBody(req);
      const { zone_id, action, value } = JSON.parse(body);

      if (!zone_id || !action) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'zone_id and action required' }));
        return;
      }

      const playerId = zone_id.replace(/^lms:/, '');
      log.info('Control command', { playerId, action, value });

      // Map unified actions to LMS commands
      switch (action) {
        case 'play':
          await lms.command(playerId, ['play']);
          break;
        case 'pause':
          await lms.command(playerId, ['pause', '1']);
          break;
        case 'play_pause':
          await lms.command(playerId, ['pause']);
          break;
        case 'stop':
          await lms.command(playerId, ['stop']);
          break;
        case 'next':
          await lms.command(playerId, ['playlist', 'index', '+1']);
          break;
        case 'previous':
          await lms.command(playerId, ['playlist', 'index', '-1']);
          break;
        case 'volume':
          await lms.command(playerId, ['mixer', 'volume', String(value)]);
          break;
        case 'vol_rel':
          const delta = value > 0 ? `+${value}` : String(value);
          await lms.command(playerId, ['mixer', 'volume', delta]);
          break;
        case 'mute':
          await lms.command(playerId, ['mixer', 'muting', value ? '1' : '0']);
          break;
        default:
          res.statusCode = 400;
          res.end(JSON.stringify({ error: `Unknown action: ${action}` }));
          return;
      }

      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // HQPlayer endpoints
    if (path === '/hqp/status') {
      res.setHeader('Content-Type', 'application/json');
      const status = await hqp.getStatus();
      res.end(JSON.stringify(status));
      return;
    }

    if (path === '/hqp/configure' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      const body = await readBody(req);
      const config = JSON.parse(body);
      hqp.configure(config);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (path === '/hqp/pipeline') {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        const pipeline = await hqp.fetchPipeline();
        res.end(JSON.stringify({ enabled: true, ...pipeline }));
      } else if (req.method === 'POST') {
        const body = await readBody(req);
        const { setting, value } = JSON.parse(body);
        await hqp.setPipelineSetting(setting, value);
        res.end(JSON.stringify({ ok: true }));
      }
      return;
    }

    // Not found
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (err) {
    log.error('Request error', { path, error: err.message });
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Get local IP for mDNS
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();
let mdnsService;

// Start server
server.listen(PORT, () => {
  log.info(`LMS plugin API listening on port ${PORT}`);

  // Advertise via mDNS for client discovery
  mdnsService = advertise(PORT, {
    name: 'Unified Hi-Fi Control (LMS)',
    base: `http://${localIp}:${PORT}`,
  }, createLogger('mDNS'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('Shutting down...');
  if (mdnsService) mdnsService.stop();
  server.close();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  log.error('Unhandled rejection', { error: err.message });
});
