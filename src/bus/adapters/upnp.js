/**
 * UPnPAdapter - Wraps UPnPClient to implement bus adapter interface
 *
 * Follows RoonAdapter pattern (~80 lines):
 * - Wraps UPnP client
 * - Zone IDs: upnp:{uuid}
 * - Control point role (discover/control renderers)
 */

class UPnPAdapter {
  constructor(upnpClient, { onZonesChanged } = {}) {
    this.upnp = upnpClient;
    this.onZonesChanged = onZonesChanged;

    // Pass onZonesChanged to client if provided
    if (onZonesChanged && upnpClient.setOnZonesChanged) {
      upnpClient.setOnZonesChanged(onZonesChanged);
    }
  }

  async start() {
    return this.upnp.start();
  }

  async stop() {
    return this.upnp.stop();
  }

  getZones(opts = {}) {
    const zones = this.upnp.getZones(opts);
    return zones.map(zone => ({
      ...zone,
      zone_id: `upnp:${zone.zone_id}`,  // Prefix for routing
      source: 'upnp',
    }));
  }

  getNowPlaying(zone_id) {
    const upnpId = zone_id.replace(/^upnp:/, '');
    const state = this.upnp.getNowPlaying(upnpId);
    if (!state) return null;

    return {
      ...state,
      zone_id: `upnp:${state.zone_id}`,  // Prefix zone_id for routing
    };
  }

  async control(zone_id, action, value) {
    const upnpId = zone_id.replace(/^upnp:/, '');
    return this.upnp.control(upnpId, action, value);
  }

  async getImage(image_key, opts = {}) {
    // UPnP doesn't support album art through this interface
    throw new Error('Image retrieval not supported for UPnP renderers');
  }

  getStatus() {
    const status = { ...this.upnp.getStatus() };

    if (status.renderers) {
      status.renderers = status.renderers.map(r => ({
        ...r,
        zone_id: `upnp:${r.zone_id}`,
      }));
    }

    return status;
  }
}

module.exports = { UPnPAdapter };
