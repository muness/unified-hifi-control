function validateAdapter(adapter, source) {
  const required = ['start', 'stop', 'getZones', 'getNowPlaying', 'control', 'getStatus'];
  const missing = required.filter(m => typeof adapter[m] !== 'function');
  if (missing.length > 0) {
    throw new Error(`${source} adapter missing: ${missing.join(', ')}`);
  }
  return true;
}

function validateZoneId(zone_id) {
  if (!zone_id || !zone_id.includes(':')) {
    throw new Error(`Invalid zone_id format (expected "backend:id"): ${zone_id}`);
  }
  return true;
}

const ACTIONS = {
  PLAY_PAUSE: 'play_pause',
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  NEXT: 'next',
  PREVIOUS: 'previous',
  PREV: 'prev',
  VOL_REL: 'vol_rel',
  VOL_ABS: 'vol_abs',
  SEEK: 'seek',
};

module.exports = { validateAdapter, validateZoneId, ACTIONS };
