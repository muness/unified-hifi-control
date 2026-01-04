/**
 * LMSAdapter - Wraps LMSClient to implement bus adapter interface
 *
 * Pattern follows RoonAdapter (src/bus/adapters/roon.js):
 * - getZones() returns flattened structure with lms: prefix
 * - getNowPlaying() returns summary with image_key
 * - getImage() takes image_key (coverid), returns {contentType, body}
 * - control() maps bus actions to LMS commands
 */

class LMSAdapter {
  constructor(lmsClient, { onZonesChanged } = {}) {
    this.lms = lmsClient;
    this.onZonesChanged = onZonesChanged;
  }

  async start() {
    return this.lms.start();
  }

  async stop() {
    return this.lms.stop();
  }

  getZones(opts = {}) {
    const players = this.lms.getCachedPlayers();
    return players.map(player => ({
      zone_id: `lms:${player.playerid}`,
      zone_name: player.name,
      state: player.state || 'stopped',
      output_count: 1,
      output_name: player.model,
      device_name: player.name,
      volume_control: {
        type: 'number',
        min: 0,
        max: 100,
        is_muted: false,
      },
      supports_grouping: false,
    }));
  }

  getNowPlaying(zone_id) {
    const playerId = zone_id.replace(/^lms:/, '');
    const player = this.lms.getCachedPlayer(playerId);
    if (!player) return null;

    // For streaming services (Qobuz, Tidal, etc.), artwork_url has the real image
    // coverid/artwork_track_id often return LMS placeholder icons for streaming content
    const imageKey = player.artwork_url || player.coverid || player.artwork_track_id || null;

    return {
      zone_id: `lms:${player.playerid}`,
      line1: player.title || 'No track',
      line2: player.artist || '',
      line3: player.album || '',
      is_playing: player.state === 'playing',
      volume: player.volume,
      volume_type: 'number',
      volume_min: 0,
      volume_max: 100,
      volume_step: 1,
      seek_position: player.time || 0,
      length: player.duration || 0,
      image_key: imageKey,
      artwork_url: player.artwork_url,  // Direct URL fallback
    };
  }

  async control(zone_id, action, value) {
    const playerId = zone_id.replace(/^lms:/, '');
    return this.lms.control(playerId, action, value);
  }

  async getImage(image_key, opts = {}) {
    if (!image_key) {
      throw new Error('No image_key provided');
    }

    // If image_key is a URL (artwork_url fallback), fetch directly
    if (image_key.startsWith('http://') || image_key.startsWith('https://')) {
      const fetchOpts = {};
      if (this.lms.username && this.lms.password) {
        const auth = Buffer.from(`${this.lms.username}:${this.lms.password}`).toString('base64');
        fetchOpts.headers = { 'Authorization': `Basic ${auth}` };
      }
      const response = await fetch(image_key, fetchOpts);
      if (!response.ok) {
        throw new Error(`Failed to fetch artwork: ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const body = Buffer.from(await response.arrayBuffer());
      return { contentType, body };
    }

    // Otherwise image_key is coverid - use LMS artwork URL
    return this.lms.getArtwork(image_key, opts);
  }

  getStatus() {
    const status = this.lms.getStatus();
    return {
      ...status,
      zones: this.getZones(),
      now_playing: this.lms.getCachedPlayers().map(player => ({
        zone_id: `lms:${player.playerid}`,
        line1: player.title || 'No track',
        line2: player.artist || '',
        is_playing: player.state === 'playing',
      })),
    };
  }
}

module.exports = { LMSAdapter };
