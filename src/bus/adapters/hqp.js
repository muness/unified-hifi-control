/**
 * HQPAdapter - Wraps HQPClient to implement bus adapter interface
 *
 * Evidence-based implementation:
 * - HQPClient.getStatus() returns {enabled, connected, pipeline, ...} (src/hqplayer/client.js:525-571)
 * - HQPClient.fetchPipeline() returns pipeline state with settings/volume (src/hqplayer/client.js:425-428)
 * - HQPClient.setPipelineSetting(name, value) updates pipeline settings (src/hqplayer/client.js:430-483)
 * - HQPClient.setVolume(value) updates volume (src/hqplayer/client.js:485-494)
 * - HQPClient.loadProfile(profileValue) loads a profile (src/hqplayer/client.js:496-523)
 * - HQPlayer doesn't control transport (receives stream from upstream)
 * - HQPlayer doesn't provide artwork (it's a rendering pipeline, not a source)
 */

class HQPAdapter {
  constructor(hqpClient) {
    this.hqp = hqpClient;
  }

  async start() {
    // HQPClient doesn't need async initialization
    // Connection is established on first request
  }

  async stop() {
    // HQPClient doesn't maintain persistent connections
    // Cleanup happens via process exit
  }

  getZones(opts = {}) {
    if (!this.hqp.isConfigured()) return [];

    return [{
      zone_id: 'hqp:pipeline',
      zone_name: 'HQPlayer Pipeline',
      source: 'hqp',
      state: 'idle',  // HQP doesn't have play/pause state
    }];
  }

  async getNowPlaying(zone_id) {
    if (zone_id !== 'hqp:pipeline') return null;

    // Return pipeline state, not track info (HQP is a renderer, not a source)
    const status = await this.hqp.getStatus();

    if (!status.enabled || !status.connected) {
      return null;
    }

    const pipeline = status.pipeline;
    if (!pipeline) {
      return {
        line1: 'HQPlayer',
        line2: 'Pipeline Inactive',
        line3: status.configName || '',
        is_playing: false,
        volume: null,
        zone_id,
        image_key: null,
      };
    }

    // Map HQP pipeline state to zone state
    const pipelineState = pipeline.status?.state || 'Stopped';
    const state = pipelineState.toLowerCase(); // 'stopped', 'paused', 'playing'

    return {
      line1: 'HQPlayer Pipeline',
      line2: pipeline.settings?.filter1x?.selected?.label || '',
      line3: status.configName || '',
      is_playing: state === 'playing',
      volume: pipeline.volume?.value !== undefined ? pipeline.volume.value : null,
      volume_min: pipeline.volume?.min || -60,
      volume_max: pipeline.volume?.max || 0,
      volume_step: 1,  // HQP uses 1dB increments
      volume_type: 'db',
      zone_id,
      image_key: null,  // HQP doesn't provide artwork
    };
  }

  async control(zone_id, action, value) {
    if (zone_id !== 'hqp:pipeline') {
      throw new Error(`Unknown zone: ${zone_id}`);
    }

    // Map bus actions to HQP native protocol
      case 'play':
        return this.hqp.native.play();

      case 'play_pause': {
        const np = await this.getNowPlaying(zone_id);
        return np?.is_playing ? this.hqp.native.pause() : this.hqp.native.play();
      }

      case 'pause':
        return this.hqp.native.pause();

      case 'stop':
        return this.hqp.native.stop();

      case 'next':
        return this.hqp.native.next();

      case 'previous':
      case 'prev':
        return this.hqp.native.previous();

      case 'seek':
        if (value == null || value < 0) throw new Error('Seek requires non-negative position');
        return this.hqp.native.seek(value);

      case 'vol_abs': {
        const np = await this.getNowPlaying(zone_id);
        const min = np?.volume_min ?? -60;
        const max = np?.volume_max ?? 0;
        const clamped = Math.max(min, Math.min(max, Number(value)));
        return this.hqp.setVolume(clamped);
      }

      case 'vol_rel': {
        const np = await this.getNowPlaying(zone_id);
        if (np?.volume == null) throw new Error('Cannot get current volume for relative adjustment');
        const min = np.volume_min ?? -60;
        const max = np.volume_max ?? 0;
        const newVolume = Math.max(min, Math.min(max, np.volume + Number(value)));
        return this.hqp.setVolume(newVolume);
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  getStatus() {
    return this.hqp.getStatus();
  }

  // Backend-specific methods (not in adapter interface):
  // These stay on the adapter for HQP-specific functionality

  async fetchPipeline() {
    return this.hqp.fetchPipeline();
  }

  async setPipelineSetting(name, value) {
    return this.hqp.setPipelineSetting(name, value);
  }

  async loadProfile(profileValue) {
    return this.hqp.loadProfile(profileValue);
  }

  async fetchProfiles() {
    return this.hqp.fetchProfiles();
  }
}

module.exports = { HQPAdapter };
