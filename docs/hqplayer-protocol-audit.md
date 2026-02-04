# HQPlayer Protocol Audit

## Summary

Comprehensive audit comparing our HQPlayer adapter implementation against the official `hqp-control` v5.2.30 reference source code.

**Key Finding:** HQPlayer's Set commands (SetMode, SetFilter, SetShaping) expect the **VALUE field** from list items, not the array **index**. Despite the hqp-control command-line help text saying `--set-filter <index>`, the actual XML protocol uses the `value` attribute which corresponds to HQPlayer's internal ID (the VALUE field), not the position in the list.

## Commands Audit

### Fully Implemented (Correct Semantics)

| Command | hqp-control | Our Implementation | Notes |
|---------|-------------|-------------------|-------|
| `GetInfo` | `<GetInfo/>` | Correct | Returns name, product, version, platform, engine |
| `State` | `<State/>` | Correct | Returns full playback state |
| `Status` | `<Status subscribe="0/1"/>` | Correct | Returns playback position and status |
| `GetModes` | `<GetModes/>` | Correct | Returns mode list with index, name, value |
| `GetFilters` | `<GetFilters/>` | Correct | Returns filter list with index, name, value, arg |
| `GetShapers` | `<GetShapers/>` | Correct | Returns shaper list with index, name, value |
| `GetRates` | `<GetRates/>` | Correct | Returns rate list with index, rate |
| `VolumeRange` | `<VolumeRange/>` | Correct | Returns min, max, enabled, adaptive |
| `Play` | `<Play/>` | Correct | Basic playback |
| `Pause` | `<Pause/>` | Correct | Pause playback |
| `Stop` | `<Stop/>` | Correct | Stop playback |
| `Previous` | `<Previous/>` | Correct | Previous track |
| `Next` | `<Next/>` | Correct | Next track |
| `Seek` | `<Seek value="pos"/>` | Correct | Seek to position in seconds |
| `Volume` | `<Volume value="dB"/>` | Correct | Set volume in dB |
| `VolumeUp` | `<VolumeUp/>` | Correct | Volume increment |
| `VolumeDown` | `<VolumeDown/>` | Correct | Volume decrement |
| `VolumeMute` | `<VolumeMute/>` | Correct | Toggle mute |
| `MatrixListProfiles` | `<MatrixListProfiles/>` | Correct | List matrix profiles |
| `MatrixGetProfile` | `<MatrixGetProfile/>` | Correct | Get current matrix profile |
| `MatrixSetProfile` | `<MatrixSetProfile value="name"/>` | Correct | Set matrix profile by NAME (string) |

### Fixed in This PR (Value/Index Semantics)

| Command | hqp-control | Our Fix | Issue |
|---------|-------------|---------|-------|
| `SetMode` | `<SetMode value="X"/>` | Send VALUE directly | Was converting value->index incorrectly |
| `SetFilter` | `<SetFilter value="X" value1x="Y"/>` | Send VALUE directly | Was converting value->index incorrectly |
| `SetShaping` | `<SetShaping value="X"/>` | Send VALUE directly | Was converting value->index incorrectly |
| `SetRate` | `<SetRate value="X"/>` | Keep index lookup | RateItem has no VALUE field, uses index |

**Note on SetRate:** Unlike filters/shapers/modes, RateItem only has `index` and `rate` fields (no `value`). The SetRate command expects the INDEX from the rates list. Our implementation correctly looks up the rate value (e.g., 48000) and converts it to the corresponding index.

### Implemented but Not Exposed via API

| Command | hqp-control | Status | Notes |
|---------|-------------|--------|-------|
| `SetInvert` | `<SetInvert value="0/1"/>` | State parsed but no set API | Polarity inversion |
| `SetConvolution` | `<SetConvolution value="0/1"/>` | State parsed but no set API | Convolution engine toggle |
| `SetRepeat` | `<SetRepeat value="0/1/2"/>` | State parsed but no set API | 0=off, 1=track, 2=all |
| `SetRandom` | `<SetRandom value="0/1"/>` | State parsed but no set API | Shuffle toggle |
| `SetAdaptiveVolume` | `<SetAdaptiveVolume value="0/1"/>` | State parsed but no set API | Adaptive volume |

### Not Implemented (Potential Future Features)

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

### State vs Status: Configured vs Active

HQPlayer has TWO distinct concepts that are often confused:

| Aspect | State Command | Status Command |
|--------|---------------|----------------|
| **Purpose** | Configured settings + actual active state | Playback position and some active info |
| **Filter/Shaper** | Numeric VALUE (e.g., `filter1x="24"`) | String NAME (e.g., `active_filter="poly-sinc-ext2"`) |
| **active_mode** | Numeric VALUE - **USE THIS** (e.g., `active_mode="1"` = SDM) | String NAME - **UNRELIABLE** (may show `"[source]"` even when outputting DSD) |
| **When to use** | Settings UI + actual active mode/rate | Now Playing display (filter/shaper names) |

**Key Insight:** State contains BOTH configured AND active values:
- `mode` = configured mode (what user set)
- `active_mode` = actual active mode (what's actually running) - **USE THIS**
- `rate` = configured rate index
- `active_rate` = actual output sample rate

**Warning:** Status's `active_mode` field is unreliable. It may report `"[source]"` even when HQPlayer is actively outputting DSD (e.g., at 11289600 Hz). Always use State's `active_mode` (numeric) for the actual active mode.

**Set commands change CONFIGURED values only.** The active values only change when:
- Playback is stopped and restarted
- A new track starts
- HQPlayer internally decides to apply the change

### Our Caching Strategy

To avoid overwhelming HQPlayer with rapid TCP commands:

| Data | Fetched | Cached | Refreshed |
|------|---------|--------|-----------|
| Modes list | On connect | Yes | After profile load |
| Filters list | On connect | Yes | After profile load |
| Shapers list | On connect | Yes | After profile load |
| Rates list | On connect | Yes | After profile load |
| VolumeRange | On connect | Yes | After profile load |
| State | Per request | No | N/A |
| Status | Per request | No | N/A |

**Per-request commands:** Only State + Status (2 TCP commands)

**Connection commands:** GetInfo, GetModes, GetFilters, GetShapers, GetRates, Status, VolumeRange (7 TCP commands, but only on connect)

**Reconnection:** 1 second delay between attempts, max 2 attempts (to avoid crashing HQPlayer)

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

### State Response Fields (Configured + Active)

The `<State/>` command returns BOTH configured settings AND actual active state:

```xml
<State filter="24" filter1x="24" filterNx="37" shaper="9" mode="1" rate="2"
       volume="-58" active_mode="0" active_rate="48000"
       invert="0" convolution="1" repeat="0" random="0" adaptive="0" filter_20k="0"
       matrix_profile=""/>
```

**Configured Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `filter` | VALUE | General filter (fallback if no split) |
| `filter1x` | VALUE | 1x filter (for 1x sample rates) |
| `filterNx` | VALUE | Nx filter (for 2x+ sample rates) |
| `shaper` | VALUE | Dither/noise shaper |
| `mode` | VALUE | Configured PCM/SDM mode (-1 = [source]) |
| `rate` | **INDEX** | Configured rate list index (NOT the Hz value!) |
| `volume` | dB | Current volume |

**Active Fields (USE THESE for actual playback state):**

| Field | Type | Description |
|-------|------|-------------|
| `active_mode` | VALUE | **Actual** active mode (0=PCM, 1=SDM) - **USE THIS** |
| `active_rate` | Hz | **Actual** output sample rate |

### Status Response Fields (Playback Position + Display Names)

The `<Status subscribe="0"/>` command returns playback position and string names for display:

```xml
<Status state="0" track="0" position="0" length="0" volume="-58"
        active_mode="PCM" active_filter="poly-sinc-ext2" active_shaper="LNS15"
        active_rate="48000" active_bits="32" active_channels="2"/>
```

| Field | Type | Description |
|-------|------|-------------|
| `active_mode` | String | **UNRELIABLE** - may show "[source]" even when outputting DSD. Use State's `active_mode` instead. |
| `active_filter` | String | Active filter name (what's actually running) - reliable |
| `active_shaper` | String | Active shaper name - reliable |
| `active_rate` | Hz | Actual output sample rate - reliable |
| `active_bits` | int | Output bit depth |
| `active_channels` | int | Output channel count |
| `state` | 0/1/2 | Stopped/Paused/Playing |
| `position` | seconds | Current playback position |
| `length` | seconds | Track length |

**Which to use:**
- **Active mode:** Use State's `active_mode` (numeric VALUE) - Status's is unreliable
- **Active filter/shaper:** Use Status (string names for display)
- **Active rate:** Either works (both return Hz)
- **Settings UI:** Use State's configured values (mode, filter1x, filterNx, shaper, rate)

### Key Insight: VALUE vs INDEX

For most list items, HQPlayer has TWO different identifiers:

1. **index** - Position in the list (0, 1, 2, ...)
2. **value** - HQPlayer's internal ID (can be non-sequential, e.g., IIR2 has value=57)

Example from filter list:

```text
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

- hqp-control v5.2.30 source: Available from Signalyst (HQPlayer author Jussi Laako)
- HQPlayer Desktop/Embedded by Signalyst: <https://www.signalyst.com/consumer.html>
