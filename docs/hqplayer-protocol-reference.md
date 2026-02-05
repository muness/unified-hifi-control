# HQPlayer Control Protocol Reference

Authoritative protocol semantics for HQPlayer TCP control interface, derived from analysis of the official `hqp-control` v5.2.30 reference implementation.

## Protocol Overview

- **Port:** 4321
- **Transport:** TCP
- **Format:** XML documents, newline-terminated
- **Example:** `<?xml version="1.0"?><SetMode value="1"/>\n`

## List Items: INDEX vs VALUE

Every list item (modes, filters, shapers) has **two identifiers**:

| Field | Description | Example |
|-------|-------------|---------|
| `index` | Position in list (0, 1, 2, ...) | `index="15"` |
| `value` | HQPlayer internal ID (non-sequential) | `value="53"` |

**Example filter list showing the difference:**

```text
[0] "none" value=0
[1] "IIR" value=1
[2] "IIR2" value=57        <- value != index
[15] "poly-sinc-hb-xs" value=53
[19] "poly-sinc-ext" value=15
```

**Example modes list showing index ≠ value:**

```text
[0] "[source]" value=-1   <- index=0, value=-1
[1] "PCM" value=0         <- index=1, value=0
[2] "SDM" value=1         <- index=2, value=1
```

**Exception:** `RatesItem` has no `value` field - only `index` and `rate` (Hz).

## Command Semantics

### What State Returns

The `<State/>` command returns these fields for settings:

| Field | Returns | Type | Notes |
|-------|---------|------|-------|
| `mode` | INDEX | u32 | Index into modes list (0,1,2) |
| `filter` | INDEX | u32 | General filter (fallback) |
| `filter1x` | INDEX | u32 | 1x filter |
| `filterNx` | INDEX | u32 | Nx filter |
| `shaper` | INDEX | u32 | Noise shaper |
| `rate` | INDEX | u32 | Rate list index (NOT Hz!) |
| `active_mode` | INDEX | u32 | Actually running mode |
| `active_rate` | Hz | u32 | Actually running rate |

### What Set Commands Expect

| Command | Parameter | Expects | Evidence |
|---------|-----------|---------|----------|
| `SetMode` | `value` | INDEX | CLI: `--set-mode <index>` |
| `SetFilter` | `value`, `value1x` | **INDEX** | CLI: `--set-filter <index> [index1x]` |
| `SetShaping` | `value` | **INDEX** | CLI: `--set-shaping <index>` |
| `SetRate` | `value` | INDEX | RateItem has no VALUE field |

### The Critical Rule

**For filter and shaper:**
- State returns INDEX
- SetFilter/SetShaping expect INDEX
- Round-trip: read from State, send back unchanged

**For mode:**
- State returns INDEX
- SetMode expects INDEX
- Same as filter/shaper!

**For rate:**
- State returns INDEX
- SetRate expects INDEX
- Display uses `rate` field from RateItem (Hz value)

## Reference Implementation Evidence

### CLI Help (Main.cpp:43)

```text
--set-mode <index>
--set-filter <index> [index1x]
--set-shaping <index>
--set-rate <index>
```

All commands use INDEX consistently. ModesItem has index (0,1,2) and value (-1,0,1) - these differ!

### setFilter Implementation (ControlInterface.cpp:1337)

```cpp
void clControlInterface::setFilter(int value, int value1x)
{
    xwriter->writeStartElement(QStringLiteral("SetFilter"));
    xwriter->writeAttribute(QStringLiteral("value"), QString::number(value));
    if (value1x >= 0)
        xwriter->writeAttribute(QStringLiteral("value1x"), QString::number(value1x));
}
```

The parameter is named `value` but the CLI passes the `<index>` argument directly.

### State Parsing (ControlInterface.cpp:1774-1790)

```cpp
emit stateResponse(
    xreader->attributes().value("state").toString().toInt(),
    xreader->attributes().value("mode").toString().toInt(),
    xreader->attributes().value("filter").toString().toInt(),
    iFilter1x, iFilterNx,
    xreader->attributes().value("shaper").toString().toInt(),
    xreader->attributes().value("rate").toString().toInt(),
    // ...
);
```

State values are parsed and passed through - the reference doesn't transform them.

### FiltersItem Parsing (ControlInterface.cpp:2084-2091)

```cpp
emit filtersItem(
    xreader->attributes().value("index").toString().toUInt(),
    xreader->attributes().value("name").toString(),
    xreader->attributes().value("value").toString().toInt(),
    xreader->attributes().value("arg").toString().toUInt());
```

Both `index` and `value` are captured from the list response.

## State vs Status

HQPlayer has two query commands with different semantics:

| Aspect | State | Status |
|--------|-------|--------|
| Filter/Shaper | Numeric (INDEX) | String (name) |
| active_mode | Numeric INDEX - **reliable** | String - **unreliable** |
| Use for | Settings UI, actual state | Display names |

**Warning:** Status's `active_mode` may show `"[source]"` even when outputting DSD. Always use State's numeric `active_mode`.

## Implementation Checklist

When implementing HQPlayer control:

- [ ] Parse FiltersItem/ShapersItem/ModesItem storing both `index` and `value`
- [ ] State.filter/filter1x/filterNx/shaper are INDEX - look up by index
- [ ] State.mode is INDEX - look up by index (ModesItem has index≠value!)
- [ ] SetFilter/SetShaping: send INDEX from State unchanged
- [ ] SetMode: send INDEX (CLI help confirms `--set-mode <index>`)
- [ ] SetRate: send INDEX (RateItem has no value field)
- [ ] For display: use Status's string fields (active_filter, active_shaper)
- [ ] For actual mode: use State's active_mode (INDEX), not Status's string

## Quick Reference Table

| Setting | State Field | State Type | Set Command | Set Expects | UI/API Use |
|---------|-------------|------------|-------------|-------------|------------|
| Mode | `mode` | INDEX | SetMode | INDEX | NAME (e.g., "PCM") |
| Filter 1x | `filter1x` | INDEX | SetFilter | INDEX | NAME (e.g., "poly-sinc-ext2") |
| Filter Nx | `filterNx` | INDEX | SetFilter | INDEX | NAME |
| Shaper | `shaper` | INDEX | SetShaping | INDEX | NAME (e.g., "ASDM7") |
| Rate | `rate` | INDEX | SetRate | INDEX | Hz (e.g., 48000) |

## API Design

**Clients (UI, API, MCP) use semantic values:**
- Mode: `"PCM"`, `"DSD"`, `"[source]"`
- Filter: `"poly-sinc-ext2"`, `"IIR"`, etc.
- Shaper: `"ASDM7"`, `"NS5"`, etc.
- Samplerate: `48000`, `96000`, etc. (Hz)

**Adapter handles all HQPlayer-specific conversions:**
- Mode name → INDEX (0, 1, 2)
- Filter name → INDEX
- Shaper name → INDEX
- Rate Hz → INDEX

## Version

- Reference: hqp-control v5.2.30 (2024-03-31)
- This document: 2026-02-05
