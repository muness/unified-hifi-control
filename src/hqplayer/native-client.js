/**
 * HQPlayer Native Protocol Client
 *
 * Implements the TCP/XML control protocol on port 4321.
 * This is cleaner and more reliable than web scraping.
 *
 * Based on Jussi Laako's hqp-control reference implementation.
 *
 * Note: Profile loading (ConfigurationLoad) requires authenticated sessions
 * with ECDH key exchange + ChaCha20Poly1305 encryption, so we keep the
 * web scraping approach for that functionality.
 */

const net = require('net');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { EventEmitter } = require('events');

const DEFAULT_PORT = 4321;
const CONNECT_TIMEOUT = 5000;
const RESPONSE_TIMEOUT = 10000;

// Commands that return multiple items before end element
const MULTI_ITEM_COMMANDS = {
  GetModes: 'ModesItem',
  GetFilters: 'FiltersItem',
  GetShapers: 'ShapersItem',
  GetRates: 'RatesItem',
  GetInputs: 'InputsItem',
  ConfigurationList: 'ConfigurationItem',
};

class HQPNativeClient extends EventEmitter {
  constructor({ host, port = DEFAULT_PORT, logger } = {}) {
    super();
    this.host = host || null;
    this.port = Number(port) || DEFAULT_PORT;
    this.log = logger || console;
    this.socket = null;
    this.connected = false;
    this.buffer = '';
    this.pendingRequests = [];
    this.currentRequest = null;
    this.collectingItems = null;

    // XML parser config - parse attributes with @ prefix
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: true,
    });
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
    return new Promise((resolve, reject) => {
      if (!this.host) {
        return reject(new Error('HQPlayer host not configured'));
      }

      if (this.connected && this.socket) {
        return resolve();
      }

      this.socket = new net.Socket();
      this.buffer = '';

      const timeout = setTimeout(() => {
        this.socket.destroy();
        reject(new Error('Connection timeout'));
      }, CONNECT_TIMEOUT);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
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
          reject(err);
        }
      });

      this.socket.connect(this.port, this.host);
    });
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
      const parsed = this.parser.parse(xml);
      const { command, resolve, reject, timeout } = this.currentRequest;
      const itemType = MULTI_ITEM_COMMANDS[command];

      // Get the root element name and its content
      const rootName = Object.keys(parsed).find(k => k !== '?xml');
      const rootContent = parsed[rootName];

      // Multi-item command handling
      if (itemType && rootName === command) {
        // Check if self-contained response (items embedded in same XML)
        if (rootContent && rootContent[itemType]) {
          clearTimeout(timeout);
          const items = Array.isArray(rootContent[itemType])
            ? rootContent[itemType]
            : [rootContent[itemType]];
          const meta = { ...rootContent };
          delete meta[itemType];

          this.currentRequest = null;
          this.collectingItems = null;
          resolve({ ...meta, items });
          this.processNextRequest();
          return;
        }

        // Start collecting (items will come on separate lines)
        if (!this.collectingItems) {
          this.collectingItems = {
            meta: typeof rootContent === 'object' ? { ...rootContent } : {},
            items: [],
          };
          delete this.collectingItems.meta[itemType];
          return;
        }

        // End - closing tag (we got items separately)
        if (this.collectingItems) {
          clearTimeout(timeout);
          const result = { ...this.collectingItems.meta, items: this.collectingItems.items };
          this.currentRequest = null;
          this.collectingItems = null;
          resolve(result);
          this.processNextRequest();
          return;
        }
      }

      // Item element (on separate line)
      if (itemType && rootName === itemType && this.collectingItems) {
        this.collectingItems.items.push(
          typeof rootContent === 'object' ? rootContent : {}
        );
        return;
      }

      // Single element response
      clearTimeout(timeout);
      this.currentRequest = null;
      resolve(typeof rootContent === 'object' ? rootContent : { result: rootContent });
      this.processNextRequest();

    } catch (err) {
      this.log.error('XML parse error', { error: err.message, xml: xml.slice(0, 200) });
      // Don't reject - might be partial data or noise
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
   * Get full pipeline status in a format compatible with existing HQPClient
   */
  async getPipelineStatus() {
    const [state, modes, filters, shapers, rates] = await Promise.all([
      this.getState(),
      this.getModes(),
      this.getFilters(),
      this.getShapers(),
      this.getRates(),
    ]);

    return {
      status: {
        state: ['Stopped', 'Paused', 'Playing'][Number(state.state)] || 'Unknown',
        activeMode: modes.find(m => String(m.value) === String(state.mode))?.name || state.active_mode || '',
        activeFilter: filters.find(f => String(f.value) === String(state.filter))?.name || '',
        activeShaper: shapers.find(s => String(s.value) === String(state.shaper))?.name || '',
      },
      volume: {
        value: Number(state.volume) || 0,
        min: -48,
        max: 0,
        isFixed: false,
      },
      settings: {
        mode: {
          selected: {
            value: String(state.mode),
            label: modes.find(m => String(m.value) === String(state.mode))?.name || '',
          },
          options: modes.map(m => ({ value: String(m.value), label: m.name })),
        },
        filter1x: {
          selected: {
            value: String(state.filter),
            label: filters.find(f => String(f.value) === String(state.filter))?.name || '',
          },
          options: filters.map(f => ({ value: String(f.value), label: f.name })),
        },
        filterNx: {
          selected: {
            value: String(state.filter),
            label: filters.find(f => String(f.value) === String(state.filter))?.name || '',
          },
          options: filters.map(f => ({ value: String(f.value), label: f.name })),
        },
        shaper: {
          selected: {
            value: String(state.shaper),
            label: shapers.find(s => String(s.value) === String(state.shaper))?.name || '',
          },
          options: shapers.map(s => ({ value: String(s.value), label: s.name })),
        },
        samplerate: {
          selected: {
            value: String(state.rate),
            label: rates.find(r => String(r.index) === String(state.rate))?.rate?.toString() || 'Auto',
          },
          options: [
            { value: '0', label: 'Auto' },
            ...rates.map(r => ({ value: String(r.index), label: String(r.rate) })),
          ],
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
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

  return new Promise((resolve) => {
    const discovered = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const timer = setTimeout(() => {
      socket.close();
      resolve(Array.from(discovered.values()));
    }, timeout);

    socket.on('message', (msg, rinfo) => {
      try {
        const parsed = parser.parse(msg.toString('utf8'));
        const discover = parsed.discover;

        if (discover && discover.result === 'OK') {
          discovered.set(rinfo.address, {
            host: rinfo.address,
            port: 4321,
            name: discover.name || 'HQPlayer',
            version: discover.version || 'unknown',
          });
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
