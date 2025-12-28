# Unified Hi-Fi Control

A source-agnostic hi-fi control bridge that connects music sources and audio pipeline control to any surface — hardware knobs, web UIs, or Home Assistant.

## Vision

Hi-fi software assumes you're at a computer or using vendor-specific apps. This bridge fills the gap:

- **Music Sources:** Roon (now), Music Assistant, Tidal Connect, Qobuz Connect (future)
- **Audio Pipeline:** HQPlayer Embedded (web UI control), receiver control (future)
- **Surfaces:** Anything that speaks HTTP or MQTT — ESP32 hardware, web UIs, Home Assistant, etc.

## Status

🚧 **In Development** — Consolidating [roon-knob](https://github.com/muness/roon-knob) bridge and [hqp-profile-switcher](https://github.com/muness/roon-extension-hqp-profile-switcher) into a unified platform.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│            Unified Hi-Fi Control Bridge              │
│  ┌──────────┐  ┌──────────────┐                     │
│  │   Roon   │  │  HQPlayer    │   (+ future sources)│
│  │          │  │  Embedded    │                     │
│  └──────────┘  └──────────────┘                     │
│                                                      │
│  HTTP API + optional MQTT                            │
└─────────────────────────────────────────────────────┘
              │
              ▼
      Any HTTP/MQTT client
    (ESP32, Web UI, HA, ...)
```

## Related

- [Open Horizons Endeavor](https://app.openhorizons.me/endeavor/80222d6d-63ab-45d8-a262-ee00303f18c9) — Strategic context and planning
- [roon-knob](https://github.com/muness/roon-knob) — ESP32-S3 hardware controller (firmware)

## License

ISC
