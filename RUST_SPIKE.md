# Unified Hi-Fi Control (Rust Spike)

A proof-of-concept Rust implementation exploring static binary deployment.

## Why Rust?

The Node.js implementation has deployment challenges:
- libc compatibility across NAS devices (glibc vs musl, version mismatches)
- Native module bundling issues (sharp, etc.)
- Large binary size (~50MB+ with Node.js runtime)

Rust with musl static linking produces:
- Single ~5-10MB binary
- Runs on ANY Linux (no runtime dependencies)
- Universal compatibility across Synology, QNAP, generic Linux

## Key Dependencies

- **[rust-roon-api](https://github.com/TheAppgineer/rust-roon-api)** - Roon protocol implementation (proven via Roon TUI)
- **[Axum](https://github.com/tokio-rs/axum)** - Web framework
- **[Leptos](https://github.com/leptos-rs/leptos)** - Web UI (planned)

## Building

### Development (native)

```bash
cargo build
cargo run
```

### Release (native)

```bash
cargo build --release
./target/release/unified-hifi-control
```

### Static Linux Binary (musl)

Using [cross](https://github.com/cross-rs/cross) (recommended):

```bash
# Install cross
cargo install cross --git https://github.com/cross-rs/cross

# Build for x86_64 Linux (static musl)
cross build --release --target x86_64-unknown-linux-musl

# Build for ARM64 Linux (static musl)
cross build --release --target aarch64-unknown-linux-musl
```

Or using [cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild):

```bash
# Install cargo-zigbuild
cargo install cargo-zigbuild

# Build for x86_64 Linux (static musl)
cargo zigbuild --release --target x86_64-unknown-linux-musl

# Build for ARM64 Linux (static musl)
cargo zigbuild --release --target aarch64-unknown-linux-musl
```

### Verify Static Linking

```bash
# Should show "statically linked" or no dynamic libraries
file target/x86_64-unknown-linux-musl/release/unified-hifi-control
ldd target/x86_64-unknown-linux-musl/release/unified-hifi-control
```

## Project Structure

```
src/
├── main.rs           # Entry point, server setup
├── config/
│   └── mod.rs        # Configuration loading
├── adapters/
│   ├── mod.rs
│   ├── roon.rs       # Roon adapter (rust-roon-api)
│   ├── hqplayer.rs   # TODO: HQPlayer client
│   └── lms.rs        # TODO: LMS client
├── api/
│   └── mod.rs        # HTTP API handlers
└── ui/               # TODO: Leptos web UI
```

## Status

This is a **spike/proof-of-concept**. Current state:

- [x] Basic project structure
- [x] Axum web server
- [x] Configuration loading
- [x] Roon adapter skeleton (rust-roon-api integration)
- [ ] HQPlayer client port
- [ ] LMS client port
- [ ] Leptos web UI
- [ ] MQTT integration
- [ ] Full API parity with Node.js version

## Configuration

Environment variables (prefix `UHC_`):

```bash
UHC_PORT=3000
UHC_ROON__EXTENSION_ID=com.example.my-extension
UHC_HQPLAYER__HOST=192.168.1.100
UHC_MQTT__HOST=localhost
```

Or config file at `~/.config/unified-hifi-control/config.toml`:

```toml
port = 3000

[roon]
extension_id = "com.example.my-extension"

[hqplayer]
host = "192.168.1.100"
port = 8088

[mqtt]
host = "localhost"
port = 1883
```

## Related

- [Issue #42](https://github.com/open-horizon-labs/unified-hifi-control/issues/42) - Architecture discussion
- [rust-roon-api](https://github.com/TheAppgineer/rust-roon-api)
- [Roon TUI](https://github.com/TheAppgineer/roon-tui) - Proof rust-roon-api works
