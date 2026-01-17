# Architecture

## Vision

A source-agnostic hi-fi control platform where **complexity is absorbed by the bus and coordinator, not distributed across adapters or UI**.

## Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   AdapterCoordinator                     │
│  (owns lifecycle: start/stop based on settings)         │
│  (publishes ShuttingDown on Ctrl+C)                     │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│                       EventBus                           │
│  (tokio broadcast: zone events, commands, lifecycle)    │
└─────────────────────────────────────────────────────────┘
     ▲           ▲           ▲              │
     │           │           │              ▼
┌────────┐  ┌────────┐  ┌────────┐   ┌─────────────┐
│ LMS    │  │ Roon   │  │ UPnP   │   │   Zone      │
│Handle  │  │Handle  │  │Handle  │   │ Aggregator  │
│        │  │        │  │        │   │ (state)     │
│[Logic] │  │[Logic] │  │[Logic] │   └─────────────┘
└────────┘  └────────┘  └────────┘          │
                                             ▼
                                      ┌─────────────┐
                                      │   API/UI    │
                                      │   + SSE     │
                                      └─────────────┘
```

## Key Components

### AdapterCoordinator
- Single decision point for adapter lifecycle
- Starts only enabled adapters
- Publishes `ShuttingDown` on Ctrl+C
- Waits for adapter ACKs before exit

### AdapterHandle + AdapterLogic
- **AdapterLogic trait**: Adapter-specific discovery/protocol (what varies)
- **AdapterHandle**: Wraps logic with consistent lifecycle (what's common)
- Adapters can't forget shutdown handling - the handle does it
- ACK on stop is automatic

### EventBus
- Zone lifecycle: `ZoneDiscovered`, `ZoneUpdated`, `ZoneRemoved`
- Now playing: `NowPlayingChanged`
- Commands: `Command`, `CommandResponse`
- Lifecycle: `AdapterStopping`, `AdapterStopped`, `ZonesFlushed`, `ShuttingDown`

### ZoneAggregator
- Single source of truth for zone state
- Subscribes to bus, maintains `HashMap<zone_id, Zone>`
- Flushes zones on `AdapterStopping`
- API calls this, never adapters directly

## Principles

1. **Disabled adapter = not started = nothing to show**
   - Coordinator checks settings before start
   - No "searching" for disabled backends

2. **Zone identity is the zone_id prefix**
   - `roon:`, `lms:`, `openhome:`, `upnp:`, `hqp:`
   - No separate `source` or `protocol` fields

3. **Adapters are event publishers**
   - Don't store zones (aggregator does)
   - Publish events, handle commands
   - Lifecycle managed by handle

4. **Clean shutdown path**
   - `ShuttingDown` → SSE handlers close
   - `AdapterStopping(prefix)` → Aggregator flushes
   - `stop()` with ACK → Coordinator waits
   - No hanging on Ctrl+C

## Implementation

See [ARCHITECTURE-RECOMMENDATION-A.md](./ARCHITECTURE-RECOMMENDATION-A.md) for detailed implementation plan.

See [ARCHITECTURE-GAP-ANALYSIS.md](./ARCHITECTURE-GAP-ANALYSIS.md) for analysis of current state vs this vision.
