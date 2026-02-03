# HQPlayer Protocol Audit

## Summary

Comprehensive audit comparing our HQPlayer adapter implementation against the official `hqp-control` v5.2.30 reference source code.

**Key Finding:** HQPlayer's Set commands (SetMode, SetFilter, SetShaping) expect the **VALUE field** from list items, not the array **index**. Despite the hqp-control command-line help text saying `--set-filter <index>`, the actual XML protocol uses the `value` attribute which corresponds to HQPlayer's internal ID (the VALUE field), not the position in the list.

## Commands Audit

### ✅ Fully Implemented (Correct Semantics)

| Command | hqp-control | Our Implementation | Notes |
|---------|-------------|-------------------|-------|
| `GetInfo` | `<GetInfo/>` | ✅ Correct | Returns name, product, version, platform, engine |
| `State` | `<State/>` | ✅ Correct | Returns full playback state |
| `Status` | `<Status subscribe="0/1"/>` | ✅ Correct | Returns playback position and status |
| `GetModes` | `<GetModes/>` | ✅ Correct | Returns mode list with index, name, value |
| `GetFilters` | `<GetFilters/>` | ✅ Correct | Returns filter list with index, name, value, arg |
| `GetShapers` | `<GetShapers/>` | ✅ Correct | Returns shaper list with index, name, value |
| `GetRates` | `<GetRates/>` | ✅ Correct | Returns rate list with index, rate |
| `VolumeRange` | `<VolumeRange/>` | ✅ Correct | Returns min, max, enabled, adaptive |
| `Play` | `<Play/>` | ✅ Correct | Basic playback |
| `Pause` | `<Pause/>` | ✅ Correct | Pause playback |
| `Stop` | `<Stop/>` | ✅ Correct | Stop playback |
| `Previous` | `<Previous/>` | ✅ Correct | Previous track |
| `Next` | `<Next/>` | ✅ Correct | Next track |
| `Seek` | `<Seek value="pos"/>` | ✅ Correct | Seek to position in seconds |
| `Volume` | `<Volume value="dB"/>` | ✅ Correct | Set volume in dB |
| `VolumeUp` | `<VolumeUp/>` | ✅ Correct | Volume increment |
| `VolumeDown` | `<VolumeDown/>` | ✅ Correct | Volume decrement |
| `VolumeMute` | `<VolumeMute/>` | ✅ Correct | Toggle mute |
| `MatrixListProfiles` | `<MatrixListProfiles/>` | ✅ Correct | List matrix profiles |
| `MatrixGetProfile` | `<MatrixGetProfile/>` | ✅ Correct | Get current matrix profile |
| `MatrixSetProfile` | `<MatrixSetProfile value="name"/>` | ✅ Correct | Set matrix profile by NAME (string) |

### 🔧 Fixed in This PR (Value/Index Semantics)

| Command | hqp-control | Our Fix | Issue |
|---------|-------------|---------|-------|
| `SetMode` | `<SetMode value="X"/>` | Send VALUE directly | Was converting value→index incorrectly |
| `SetFilter` | `<SetFilter value="X" value1x="Y"/>` | Send VALUE directly | Was converting value→index incorrectly |
| `SetShaping` | `<SetShaping value="X"/>` | Send VALUE directly | Was converting value→index incorrectly |
| `SetRate` | `<SetRate value="X"/>` | ✅ Keep index lookup | RateItem has no VALUE field, uses index |

**Note on SetRate:** Unlike filters/shapers/modes, RateItem only has `index` and `rate` fields (no `value`). The SetRate command expects the INDEX from the rates list. Our implementation correctly looks up the rate value (e.g., 48000) and converts it to the corresponding index.

### ⚠️ Implemented but Not Exposed via API

| Command | hqp-control | Status | Notes |
|---------|-------------|--------|-------|
| `SetInvert` | `<SetInvert value="0/1"/>` | State parsed but no set API | Polarity inversion |
| `SetConvolution` | `<SetConvolution value="0/1"/>` | State parsed but no set API | Convolution engine toggle |
| `SetRepeat` | `<SetRepeat value="0/1/2"/>` | State parsed but no set API | 0=off, 1=track, 2=all |
| `SetRandom` | `<SetRandom value="0/1"/>` | State parsed but no set API | Shuffle toggle |
| `SetAdaptiveVolume` | `<SetAdaptiveVolume value="0/1"/>` | State parsed but no set API | Adaptive volume |

### ❌ Not Implemented (Potential Future Features)

#### Playback Control
| Command | Description | Priority |
|---------|-------------|----------|
| `Backward` | Seek backward | Low (rarely used) |
| `Forward` | Seek forward | Low (rarely used) |
| `SelectTrack` | Jump to playlist index | Medium |
| `PlayNextURI` | Queue next URI | Medium |

#### Playlist Management
| Command | Description | Priority |
|---------|-------------|----------|
| `PlaylistAdd` | Add URI to playlist | Medium |
| `PlaylistRemove` | Remove item from playlist | Medium |
| `PlaylistClear` | Clear playlist | Medium |
| `PlaylistGet` | Get playlist contents | Medium |
| `PlaylistLoad/Save` | Load/save named playlists | Low |
| `PlaylistMoveUp/Down` | Reorder playlist | Low |

#### Library
| Command | Description | Priority |
|---------|-------------|----------|
| `LibraryGet` | Browse library | Low |
| `LibraryPictureByPath/Hash` | Get album art | Low |
| `LibraryFavorite*` | Favorite management | Low |

#### Display/Transport
| Command | Description | Priority |
|---------|-------------|----------|
| `GetDisplay/SetDisplay` | Display mode (time/remain/total) | Low |
| `GetTransport/SetTransport` | Transport type selection | Low |
| `GetInputs` | List available inputs | Medium |

#### Advanced
| Command | Description | Priority |
|---------|-------------|----------|
| `Set20kFilter` | 20kHz lowpass filter toggle | Low |
| `SetTransportRate` | Transport sample rate | Low |
| `GetLicense` | License info | Low |
| `Reset` | Reset HQPlayer | Low |
| `ConfigurationLoad` | Load config (requires auth) | Low |

#### Authentication (Requires Crypto)
| Command | Description | Priority |
|---------|-------------|----------|
| `SessionAuthentication` | ECDH + Ed25519 handshake | Low |
| Encrypted commands | ChaCha20-Poly1305 encryption | Low |

## Protocol Details

### List Item Structure

From hqp-control parsing:

```cpp
// ModesItem: index, name, value (value can be negative, e.g., -1 for [source])
emit modesItem(index, name, value);

// FiltersItem: index, name, value, arg
emit filtersItem(index, name, value, arg);

// ShapersItem: index, name, value
emit shapersItem(index, name, value);

// RatesItem: index, rate (no value field!)
emit ratesItem(index, rate);
```

### State Response Fields

The State XML response contains:
- `filter` - current filter VALUE
- `filter1x` - 1x filter VALUE (when using split filters)
- `filterNx` - Nx filter VALUE (when using split filters)
- `mode` - mode VALUE (can be -1 for [source])
- `shaper` - shaper VALUE
- `rate` - rate INDEX (different from others!)
- `active_rate` - actual sample rate in Hz
- `volume` - volume in dB

### Key Insight: VALUE vs INDEX

For most list items, HQPlayer has TWO different identifiers:
1. **index** - Position in the list (0, 1, 2, ...)
2. **value** - HQPlayer's internal ID (can be non-sequential, e.g., IIR2 has value=57)

Example from filter list:
```
index=0, value=0, name=none
index=1, value=1, name=IIR
index=2, value=57, name=IIR2  <-- Note: value != index
index=15, value=53, name=poly-sinc-hb-xs
index=19, value=15, name=poly-sinc-ext
```

When setting a filter, you send the VALUE (e.g., 53 for poly-sinc-hb-xs), not the index (15).

**Exception:** SetRate uses the INDEX because RateItem has no value field.

## Testing Verification

After applying the fixes:

```bash
# Test filter1x change to poly-sinc-hb-xs (value 53)
curl -X POST http://localhost:8089/hqp/pipeline \
  -H "Content-Type: application/json" \
  -d '{"setting":"filter1x","value":53}'
# Result: {"settings":{"filter1x":{"selected":{"value":"53","label":"poly-sinc-hb-xs"}}}}

# Test shaper change to NS5 (value 7)
curl -X POST http://localhost:8089/hqp/pipeline \
  -H "Content-Type: application/json" \
  -d '{"setting":"shaper","value":7}'
# Result: {"settings":{"shaper":{"selected":{"value":"7","label":"NS5"}}}}

# Test rate change to 96000
curl -X POST http://localhost:8089/hqp/pipeline \
  -H "Content-Type: application/json" \
  -d '{"setting":"samplerate","value":96000}'
# Result: {"settings":{"samplerate":{"selected":{"value":"96000","label":"96000"}}}}
```

## References

- hqp-control v5.2.30 source: `/Users/muness1/src/hqp-control-5230-src/`
- Protocol documentation: `hqplayer_control_protocol.md`
- HQPlayer Desktop by Signalyst
