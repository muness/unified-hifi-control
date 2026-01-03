const { validateAdapter } = require('./adapter');

/**
 * Bus - Routes commands to backend adapters
 */
function createBus({ logger } = {}) {
  const log = logger || console;
  const backends = new Map();
  const zones = new Map();

  function registerBackend(source, adapter) {
    validateAdapter(adapter, source);
    backends.set(source, adapter);

    // Log capabilities
    const caps = {
      image: typeof adapter.getImage === 'function',
      events: typeof adapter.on === 'function',
    };
    log.info(`Registered ${source} backend`, caps);

    refreshZones(source);
  }

  function refreshZones(source = null) {
    if (source) {
      for (const [zid] of zones) {
        if (zid.startsWith(`${source}:`)) zones.delete(zid);
      }

      const adapter = backends.get(source);
      if (adapter) {
        adapter.getZones().forEach(z => {
          zones.set(z.zone_id, { zone: z, adapter });
        });
      }
    } else {
      zones.clear();
      for (const [src, adapter] of backends) {
        adapter.getZones().forEach(z => {
          zones.set(z.zone_id, { zone: z, adapter });
        });
      }
    }
  }

  function getZones() {
    return Array.from(zones.values()).map(({ zone }) => zone);
  }

  function getZone(zone_id) {
    return zones.get(zone_id)?.zone || null;
  }

  function getAdapterForZone(zone_id) {
    const entry = zones.get(zone_id);
    if (entry) return entry.adapter;

    const backend = zone_id.split(':')[0];
    return backends.get(backend) || null;
  }

  function getNowPlaying(zone_id) {
    const adapter = getAdapterForZone(zone_id);
    if (!adapter) {
      log.warn(`No adapter for zone: ${zone_id}`);
      return null;
    }
    return adapter.getNowPlaying(zone_id);
  }

  async function control(zone_id, action, value) {
    const adapter = getAdapterForZone(zone_id);
    if (!adapter) throw new Error(`Zone not found: ${zone_id}`);
    return adapter.control(zone_id, action, value);
  }

  async function getImage(image_key, opts = {}) {
    // Route by zone_id context (routes have zone_id when requesting images)
    const zone_id = opts.zone_id;
    if (!zone_id) {
      throw new Error('zone_id required in opts for image routing');
    }

    const adapter = getAdapterForZone(zone_id);
    if (!adapter) {
      throw new Error(`Backend not found for zone: ${zone_id}`);
    }

    if (!adapter.getImage) {
      throw new Error(`${adapter.constructor.name} does not support images`);
    }

    return adapter.getImage(image_key, opts);
  }

  function getStatus() {
    const status = {};
    for (const [source, adapter] of backends) {
      status[source] = adapter.getStatus();
    }
    return status;
  }

  async function start() {
    log.info('Starting bus...');
    for (const [source, adapter] of backends) {
      try {
        await adapter.start();
        log.info(`${source} started`);
      } catch (err) {
        log.error(`${source} start failed:`, err);
      }
    }
    refreshZones();
  }

  return {
    registerBackend,
    refreshZones,
    getZones,
    getZone,
    getNowPlaying,
    control,
    getImage,
    getStatus,
    start,
  };
}

module.exports = { createBus };
