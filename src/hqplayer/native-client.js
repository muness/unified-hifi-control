/**
 * HQPlayer Native Protocol Client
 *
 * Implements the TCP/XML control protocol on port 4321.
 * This is cleaner and more reliable than web scraping.
 *
 * Based on Jussi Laako's hqp-control reference implementation.
 *
 * IMPORTANT: Index vs Value distinction
 * -------------------------------------
 * The State command returns ARRAY INDICES for filter/shaper settings, NOT the
 * values used in the web UI or SetFilter/SetShaping commands.
 *
 * Example:
 *   - State returns: { filter1x: 40, shaper: 24 }
 *   - filters[40] = { index: 40, name: 'poly-sinc-long-mp-2s', value: 29 }
 *   - shapers[24] = { index: 24, name: 'ASDM7EC-fast', value: 33 }
 *   - Web UI shows: filter1x=29, shaper=33 (the VALUE fields)
 *
 * To get the correct value for UI display or SetFilter commands:
 *   const filterObj = filters[state.filter1x];  // Look up by array index
 *   const valueForUI = filterObj.value;         // Use the .value field
 *
 * Note: Profile loading (ConfigurationLoad) requires authenticated sessions
 * with ECDH key exchange + ChaCha20Poly1305 encryption, so we keep the
 * web scraping approach for that functionality.
 */

const net = require('net');
const xpath = require('xpath');
const { DOMParser } = require('@xmldom/xmldom');
const { EventEmitter } = require('events');

const DEFAULT_PORT = 4321;
const CONNECT_TIMEOUT = 5000;
const RESPONSE_TIMEOUT = 10000;

// Commands that return multiple items - maps command to item element name
const MULTI_ITEM_COMMANDS = {
  GetModes: 'ModesItem',
  GetFilters: 'FiltersItem',
  GetShapers: 'ShapersItem',
  GetRates: 'RatesItem',
  GetInputs: 'InputsItem',
  ConfigurationList: 'ConfigurationItem',
  MatrixListProfiles: 'MatrixProfile',
};

class HQPNativeClient extends EventEmitter {
  constructor({ host, port = DEFAULT_PORT, logger } = {}) {
    super();
    this.host = host || null;
    this.port = Number(port) || DEFAULT_PORT;
    this.log = logger || console;
    this.socket = null;
    this.connected = false;
    this.connecting = null;  // Promise for in-progress connection
    this.buffer = '';
    this.pendingRequests = [];
    this.currentRequest = null;
    this.collectingItems = null;
    this.domParser = new DOMParser();
  }

  isConfigured() {
    return !!this.host;
  }

  configure({ host, port }) {
    const changed = host !== this.host || port !== this.port;
    this.host = host || this.host;
    this.port = Number(port) || this.port;
    if (changed && this.connected) {
      this.disconnect();
    }
  }

  connect() {
    if (!this.host) {
      return Promise.reject(new Error('HQPlayer host not configured'));
    }

    if (this.connected && this.socket) {
      return Promise.resolve();
    }

    // Return existing connection attempt if in progress
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.buffer = '';

      const timeout = setTimeout(() => {
        this.connecting = null;
        this.socket.destroy();
        reject(new Error('Connection timeout'));
      }, CONNECT_TIMEOUT);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connecting = null;
        this.connected = true;
        this.log.info('HQPlayer native protocol connected', { host: this.host, port: this.port });
        this.emit('connected');
        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleData(data.toString('utf8'));
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.socket = null;
        this.log.info('HQPlayer native protocol disconnected');
        this.emit('disconnected');
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        this.log.error('HQPlayer socket error', { error: err.message });
        this.emit('error', err);
        if (!this.connected) {
          this.connecting = null;
          reject(err);
        }
      });

      this.socket.connect(this.port, this.host);
    });

    return this.connecting;
  }

  handleData(data) {
    this.buffer += data;

    // Process complete lines (XML documents end with newline)
    while (this.buffer.includes('\n')) {
      const idx = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);

      if (line) {
        this.handleXmlLine(line);
      }
    }
  }

  handleXmlLine(xml) {
    if (!this.currentRequest) return;

    try {
      const doc = this.domParser.parseFromString(xml, 'text/xml');
      const { command, resolve, timeout } = this.currentRequest;
      const itemType = MULTI_ITEM_COMMANDS[command];

      // Multi-item commands - extract items with xpath
      if (itemType) {
        const itemNodes = xpath.select(`//${itemType}`, doc);
        if (itemNodes.length > 0) {
          clearTimeout(timeout);
          this.currentRequest = null;
          resolve({ items: itemNodes.map(node => this.parseItem(itemType, node)) });
          this.processNextRequest();
          return;
        }
      }

      // Single element response
      const root = doc.documentElement;
      if (!root) return;

      clearTimeout(timeout);
      this.currentRequest = null;
      resolve(this.parseResponse(root));
      this.processNextRequest();

    } catch (err) {
      this.log.error('XML parse error', { error: err.message, xml: xml.slice(0, 200) });
    }
  }

  parseItem(itemType, node) {
    const str = (name) => xpath.select(`string(@${name})`, node);
    const num = (name) => Number(str(name)) || 0;

    switch (itemType) {
      case 'ModesItem':
        return { index: num('index'), name: str('name'), value: num('value') };

      case 'FiltersItem':
        return { index: num('index'), name: str('name'), value: num('value'), arg: num('arg') };

      case 'ShapersItem':
        return { index: num('index'), name: str('name'), value: num('value') };

      case 'RatesItem':
        return { index: num('index'), rate: num('rate') };

      case 'InputsItem':
        return { name: str('name') };

      case 'ConfigurationItem':
        return { name: str('name') };

      case 'MatrixProfile':
        return { name: str('name') };

      default:
        return { name: str('name'), value: num('value') };
    }
  }

  parseResponse(root) {
    const str = (name) => root.getAttribute(name) || '';
    const num = (name) => Number(root.getAttribute(name)) || 0;
    const numOrNull = (name) => root.hasAttribute(name) ? Number(root.getAttribute(name)) : null;
    const bool = (name) => root.getAttribute(name) === '1';

    switch (root.nodeName) {
      case 'State':
        return {
          state: num('state'),           // 0=stopped, 1=paused, 2=playing
          mode: num('mode'),             // PCM=0, SDM=1
          filter: num('filter'),         // legacy single filter
          filter1x: numOrNull('filter1x'),  // 1x oversampling filter (if set)
          filterNx: numOrNull('filterNx'),  // Nx oversampling filter (if set)
          shaper: num('shaper'),
          rate: num('rate'),
          volume: num('volume'),
          activeMode: num('active_mode'),
          activeRate: num('active_rate'),
          invert: bool('invert'),
          convolution: bool('convolution'),
          repeat: num('repeat'),         // 0=off, 1=track, 2=all
          random: bool('random'),
          adaptive: bool('adaptive'),
          filter20k: bool('filter_20k'),
          matrixProfile: str('matrix_profile'),
        };

      case 'GetInfo':
        return {
          name: str('name'),
          product: str('product'),
          version: str('version'),
          platform: str('platform'),
          engine: str('engine'),
        };

      case 'Status':
        return {
          state: num('state'),
          track: num('track'),
          trackId: str('track_id'),
          position: num('position'),
          length: num('length'),
          volume: num('volume'),
          activeMode: str('active_mode'),
          activeFilter: str('active_filter'),
          activeShaper: str('active_shaper'),
          activeRate: num('active_rate'),
          activeBits: num('active_bits'),
          activeChannels: num('active_channels'),
          samplerate: num('samplerate'),
          bitrate: num('bitrate'),
        };

      case 'VolumeRange':
        return {
          min: num('min'),
          max: num('max'),
          step: num('step') || 1,
          enabled: bool('enabled'),
          adaptive: bool('adaptive'),
        };

      case 'MatrixGetProfile':
        return { value: str('value') };

      default:
        return { result: str('result') || 'OK' };
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.buffer = '';
    this.pendingRequests = [];
    this.currentRequest = null;
    this.collectingItems = null;
  }

  send(command, xml) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        return reject(new Error('Not connected'));
      }

      const timeout = setTimeout(() => {
        if (this.currentRequest) {
          this.currentRequest = null;
          this.collectingItems = null;
          reject(new Error('Response timeout'));
          this.processNextRequest();
        }
      }, RESPONSE_TIMEOUT);

      this.pendingRequests.push({ command, xml, resolve, reject, timeout });
      this.processNextRequest();
    });
  }

  processNextRequest() {
    if (this.currentRequest || this.pendingRequests.length === 0) {
      return;
    }

    this.currentRequest = this.pendingRequests.shift();
    this.socket.write(this.currentRequest.xml + '\n');
  }

  // Build XML helpers
  buildRequest(element, attrs = {}) {
    if (Object.keys(attrs).length === 0) {
      return `<?xml version="1.0"?><${element}/>`;
    }
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${this.escapeXml(String(v))}"`)
      .join(' ');
    return `<?xml version="1.0"?><${element} ${attrStr}/>`;
  }

  escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // --- Public API ---

  async getInfo() {
    await this.ensureConnected();
    return this.send('GetInfo', this.buildRequest('GetInfo'));
  }

  async getState() {
    await this.ensureConnected();
    return this.send('State', this.buildRequest('State'));
  }

  async getStatus(subscribe = false) {
    await this.ensureConnected();
    return this.send('Status', this.buildRequest('Status', { subscribe: subscribe ? 1 : 0 }));
  }

  async getModes() {
    await this.ensureConnected();
    const response = await this.send('GetModes', this.buildRequest('GetModes'));
    return response.items || [];
  }

  async getFilters() {
    await this.ensureConnected();
    const response = await this.send('GetFilters', this.buildRequest('GetFilters'));
    return response.items || [];
  }

  async getShapers() {
    await this.ensureConnected();
    const response = await this.send('GetShapers', this.buildRequest('GetShapers'));
    return response.items || [];
  }

  async getRates() {
    await this.ensureConnected();
    const response = await this.send('GetRates', this.buildRequest('GetRates'));
    return response.items || [];
  }

  async getMatrixProfiles() {
    await this.ensureConnected();
    const response = await this.send('MatrixListProfiles', this.buildRequest('MatrixListProfiles'));
    return response.items || [];
  }

  async getMatrixProfile() {
    await this.ensureConnected();
    return this.send('MatrixGetProfile', this.buildRequest('MatrixGetProfile'));
  }

  async setMatrixProfile(value) {
    await this.ensureConnected();
    return this.send('MatrixSetProfile', this.buildRequest('MatrixSetProfile', { value }));
  }

  async setMode(value) {
    await this.ensureConnected();
    return this.send('SetMode', this.buildRequest('SetMode', { value }));
  }

  async setFilter(value, value1x = -1) {
    await this.ensureConnected();
    const attrs = { value };
    if (value1x >= 0) {
      attrs.value1x = value1x;
    }
    return this.send('SetFilter', this.buildRequest('SetFilter', attrs));
  }

  async setShaping(value) {
    await this.ensureConnected();
    return this.send('SetShaping', this.buildRequest('SetShaping', { value }));
  }

  async setRate(value) {
    await this.ensureConnected();
    return this.send('SetRate', this.buildRequest('SetRate', { value }));
  }

  async setVolume(value) {
    await this.ensureConnected();
    return this.send('Volume', this.buildRequest('Volume', { value }));
  }

  async volumeUp() {
    await this.ensureConnected();
    return this.send('VolumeUp', this.buildRequest('VolumeUp'));
  }

  async volumeDown() {
    await this.ensureConnected();
    return this.send('VolumeDown', this.buildRequest('VolumeDown'));
  }

  async volumeMute() {
    await this.ensureConnected();
    return this.send('VolumeMute', this.buildRequest('VolumeMute'));
  }

  async getVolumeRange() {
    await this.ensureConnected();
    return this.send('VolumeRange', this.buildRequest('VolumeRange'));
  }

  async play() {
    await this.ensureConnected();
    return this.send('Play', this.buildRequest('Play', { last: 0 }));
  }

  async pause() {
    await this.ensureConnected();
    return this.send('Pause', this.buildRequest('Pause'));
  }

  async stop() {
    await this.ensureConnected();
    return this.send('Stop', this.buildRequest('Stop'));
  }

  async previous() {
    await this.ensureConnected();
    return this.send('Previous', this.buildRequest('Previous'));
  }

  async next() {
    await this.ensureConnected();
    return this.send('Next', this.buildRequest('Next'));
  }

  async seek(position) {
    await this.ensureConnected();
    return this.send('Seek', this.buildRequest('Seek', { position }));
  }

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  async testConnection() {
    try {
      await this.connect();
      const info = await this.getInfo();
      return { success: true, info };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get full pipeline status in a format compatible with existing HQPClient.
   *
   * Note: State returns array indices for filters/shapers. We look up by index
   * to get the actual value field needed for UI display. See file header.
   */
  async getPipelineStatus() {
    const [state, modes, filters, shapers, rates, volRange] = await Promise.all([
      this.getState(),
      this.getModes(),
      this.getFilters(),
      this.getShapers(),
      this.getRates(),
      this.getVolumeRange(),
    ]);

    // State returns array indices for filters/shapers, look up to get the actual value
    const filter1xIdx = state.filter1x !== null ? state.filter1x : state.filter;
    const filterNxIdx = state.filterNx !== null ? state.filterNx : state.filter;
    const shaperIdx = state.shaper;

    // Look up by array index to get the filter/shaper objects
    const filter1xObj = filters[filter1xIdx];
    const filterNxObj = filters[filterNxIdx];
    const shaperObj = shapers[shaperIdx];

    // Mode lookup - state.mode is index, activeMode is value
    const getModeByIndex = (idx) => modes.find(m => m.index === idx)?.name || '';
    const getModeByValue = (val) => modes.find(m => m.value === val)?.name || '';

    return {
      status: {
        state: ['Stopped', 'Paused', 'Playing'][state.state] || 'Unknown',
        mode: getModeByIndex(state.mode),
        activeMode: getModeByValue(state.activeMode),
        activeFilter: filter1xObj?.name || '',
        activeShaper: shaperObj?.name || '',
        activeRate: state.activeRate || 0,
        convolution: state.convolution,
        invert: state.invert,
      },
      volume: {
        value: state.volume,
        min: volRange.min,
        max: volRange.max,
        isFixed: !volRange.enabled,
      },
      settings: {
        mode: {
          selected: {
            value: String(modes.find(m => m.index === state.mode)?.value ?? state.mode),
            label: getModeByIndex(state.mode),
          },
          options: modes.map(m => ({ value: String(m.value), label: m.name })),
        },
        filter1x: {
          selected: {
            value: String(filter1xObj?.value ?? filter1xIdx),
            label: filter1xObj?.name || '',
          },
          options: filters.map(f => ({ value: String(f.value), label: f.name })),
        },
        filterNx: {
          selected: {
            value: String(filterNxObj?.value ?? filterNxIdx),
            label: filterNxObj?.name || '',
          },
          options: filters.map(f => ({ value: String(f.value), label: f.name })),
        },
        shaper: {
          selected: {
            value: String(shaperObj?.value ?? shaperIdx),
            label: shaperObj?.name || '',
          },
          options: shapers.map(s => ({ value: String(s.value), label: s.name })),
        },
        samplerate: {
          selected: {
            value: String(state.rate),
            label: state.rate === 0 ? 'Auto' : (rates.find(r => r.index === state.rate)?.rate?.toString() || 'Auto'),
          },
          options: rates.map(r => ({
            value: String(r.index),
            label: r.index === 0 ? 'Auto' : String(r.rate),
          })),
        },
      },
    };
  }
}

/**
 * Discover HQPlayer instances on the network via UDP multicast
 */
function discoverHQPlayers(timeout = 3000) {
  const dgram = require('dgram');
  const { DOMParser } = require('@xmldom/xmldom');
  const domParser = new DOMParser();

  return new Promise((resolve) => {
    const discovered = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const timer = setTimeout(() => {
      socket.close();
      resolve(Array.from(discovered.values()));
    }, timeout);

    socket.on('message', (msg, rinfo) => {
      try {
        const doc = domParser.parseFromString(msg.toString('utf8'), 'text/xml');
        const root = doc.documentElement;

        if (root && root.nodeName === 'discover') {
          const result = root.getAttribute('result');
          if (result === 'OK') {
            discovered.set(rinfo.address, {
              host: rinfo.address,
              port: 4321,
              name: root.getAttribute('name') || 'HQPlayer',
              version: root.getAttribute('version') || 'unknown',
              product: root.getAttribute('product') || null,
            });
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.close();
      resolve(Array.from(discovered.values()));
    });

    socket.bind(() => {
      const message = Buffer.from('<?xml version="1.0"?><discover>hqplayer</discover>');
      socket.send(message, 0, message.length, 4321, '239.192.0.199');
    });
  });
}

module.exports = { HQPNativeClient, discoverHQPlayers };
