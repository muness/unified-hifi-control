#!/usr/bin/env node
/**
 * Minimal entry point for LMS plugin
 *
 * Stripped down version that only includes:
 * - HQPlayer client (for DSP control)
 * - Minimal HTTP API (no web UI)
 * - mDNS advertising (for phone/watch/knob discovery)
 *
 * Designed to run as a child process of the LMS plugin.
 */

const os = require('os');
const http = require('http');
const { HQPClient } = require('./hqplayer/client');
const { createLogger } = require('./lib/logger');
const { advertise } = require('./lib/mdns');

const PORT = parseInt(process.env.PORT, 10) || 9199; // Different from main app
const log = createLogger('LMS-Plugin');

log.info('Starting Unified Hi-Fi Control (LMS Plugin Mode)');

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

// Minimal HTTP API - no Express, no web UI
const server = http.createServer(async (req, res) => {
  // CORS for local requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Parse URL
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // Health check
    if (path === '/health') {
      res.end(JSON.stringify({ status: 'ok', mode: 'lms-plugin' }));
      return;
    }

    // HQPlayer status
    if (path === '/hqp/status') {
      const status = await hqp.getStatus();
      res.end(JSON.stringify(status));
      return;
    }

    // HQPlayer configure
    if (path === '/hqp/configure' && req.method === 'POST') {
      const body = await readBody(req);
      const config = JSON.parse(body);
      hqp.configure(config);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // HQPlayer volume
    if (path === '/hqp/volume' && req.method === 'POST') {
      const body = await readBody(req);
      const { volume } = JSON.parse(body);
      await hqp.setVolume(volume);
      res.end(JSON.stringify({ success: true, volume }));
      return;
    }

    // HQPlayer mute
    if (path === '/hqp/mute' && req.method === 'POST') {
      const body = await readBody(req);
      const { muted } = JSON.parse(body);
      await hqp.setMute(muted);
      res.end(JSON.stringify({ success: true, muted }));
      return;
    }

    // HQPlayer filter/shaper
    if (path === '/hqp/filter' && req.method === 'POST') {
      const body = await readBody(req);
      const { filter, shaper } = JSON.parse(body);
      if (filter) await hqp.setFilter(filter);
      if (shaper) await hqp.setShaper(shaper);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Not found
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (err) {
    log.error('Request error', { path, error: err.message });
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

// Bind to all interfaces so clients can reach us
server.listen(PORT, () => {
  log.info(`LMS plugin API listening on port ${PORT}`);

  // Advertise via mDNS for phone/watch/knob discovery
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
