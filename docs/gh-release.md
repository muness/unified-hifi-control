# GitHub Release Workflow Caching Strategy

This document explains the caching and artifact reuse strategies in `.github/workflows/release.yml` and why each is needed.

## Overview

The release workflow builds for 5 targets across 3 platforms, plus web assets, Docker images, and platform-specific packages. Using cargo-zigbuild enables effective caching for cross-compiled targets.

## Caching Strategies

### 1. sccache + rust-cache for All Builds

**Used by:** All builds (Web Assets, macOS, Windows, Linux)

**Why both?** They cache different things:
- **sccache**: Caches individual compilation units (`.o` files)
- **rust-cache**: Caches `target/` directory including proc-macro `.dylib` files

Proc-macros (serde_derive, dioxus, thiserror, etc.) can't be cached by sccache due to "crate-type" limitations - they must be recompiled. But rust-cache preserves the compiled proc-macro binaries between runs.

**How:**
```yaml
- name: Setup sccache
  uses: mozilla-actions/sccache-action@v0.0.9

- name: Cache Rust
  uses: Swatinem/rust-cache@v2

- name: Build
  env:
    SCCACHE_GHA_ENABLED: "true"
    RUSTC_WRAPPER: "sccache"
  run: cargo build --release
```

### 2. cargo-zigbuild for Cross-Compilation

**Used by:** Linux musl builds (x86_64, aarch64, armv7), macOS universal

**Why zigbuild instead of cross:** The [cross](https://github.com/cross-rs/cross) tool runs cargo inside Docker containers, which breaks caching - container paths (`/project/`) don't match host paths, invalidating Cargo's fingerprints.

[cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild) uses Zig as a linker for cross-compilation without containers. This means:
- sccache works normally (no container isolation)
- rust-cache preserves compiled artifacts
- No Docker image pulls (~15s saved per build)
- Supports `universal2-apple-darwin` for fat macOS binaries

**Linux builds:**
```yaml
- name: Install cargo-zigbuild
  uses: taiki-e/install-action@v2
  with:
    tool: cargo-zigbuild

- name: Build with zigbuild
  env:
    SCCACHE_GHA_ENABLED: "true"
    RUSTC_WRAPPER: "sccache"
  run: cargo zigbuild --release --target ${{ matrix.target }}

- name: Smoke test armv7 binary
  if: matrix.target == 'armv7-unknown-linux-musleabihf'
  run: |
    sudo apt-get install -y qemu-user-static
    qemu-arm-static ./target/${{ matrix.target }}/release/binary --version
```

**macOS universal binary:**
```yaml
- name: Build universal binary
  run: cargo zigbuild --release --target universal2-apple-darwin
```

This creates a single fat binary that works on both x86_64 and arm64 Macs, eliminating the need for separate builds.

### 3. Tool Binary Caching

**Dioxus CLI:**
```yaml
- name: Cache Dioxus CLI
  uses: actions/cache@v4
  with:
    path: ~/.cargo/bin/dx
    key: dx-cli-0.7.3

- name: Install Dioxus CLI
  if: steps.cache-dx.outputs.cache-hit != 'true'
  run: cargo install dioxus-cli@0.7.3 --locked
```

**Why:** These tools take 2-3 minutes to compile. Caching the binaries saves this time on every run.

### 4. GHCR Base Images

**Used by:** Dockerfile.ci, Dockerfile.release

**Why:** GitHub Actions runners are in the same datacenter as GHCR (GitHub Container Registry). Pulling base images from GHCR is significantly faster than Docker Hub, AWS ECR, or other registries.

**Also:** Docker Hub has rate limits (200 pulls/6 hours for free accounts) which can block CI runs.

**How:**
```dockerfile
FROM ghcr.io/linuxcontainers/alpine:3.20
```

### 5. Web Assets Artifact Sharing

**Why:** Web assets (WASM + JS) are identical across all platforms. Building once and sharing via artifacts avoids 3x redundant WASM compilation.

**How:**
```yaml
# Build job uploads:
- uses: actions/upload-artifact@v4
  with:
    name: web-assets
    path: target/dx/unified-hifi-control/release/web/public/

# Platform jobs download:
- uses: actions/download-artifact@v4
  with:
    name: web-assets
    path: public/
```

**Tarball for LMS Plugin:**
```yaml
- name: Create web assets tarball
  run: |
    cd target/dx/unified-hifi-control/release/web
    tar -czvf web-assets.tar.gz public/
```

The LMS plugin downloads this tarball at runtime since it can't bundle large binary assets.

## Build Matrix

| Target | Caching | Build Tool |
|--------|---------|------------|
| Web Assets (WASM) | sccache + rust-cache | dx (dioxus-cli) |
| macOS universal | sccache + rust-cache | cargo-zigbuild |
| Windows x86_64 | sccache + rust-cache | cargo |
| Linux x86_64-musl | sccache + rust-cache | cargo-zigbuild |
| Linux aarch64-musl | sccache + rust-cache | cargo-zigbuild |
| Linux armv7-musl | sccache + rust-cache | cargo-zigbuild |
| Docker multi-arch | N/A | pre-built binaries |

## Lessons Learned

1. **sccache + rust-cache:** Use both for all builds. sccache caches compilation units, rust-cache caches proc-macro dylibs and the target directory.

2. **Avoid containerized cross-compilation:** Tools like `cross` run cargo in Docker containers, breaking Cargo's fingerprint-based caching (paths don't match). Use `cargo-zigbuild` instead - it cross-compiles without containers so caching works normally.

3. **Universal macOS binaries:** Use `cargo zigbuild --target universal2-apple-darwin` to create a single fat binary for both x86_64 and arm64, halving macOS build jobs.

4. **QEMU for cross-arch testing:** Test armv7 binaries on x86_64 runners using `qemu-user-static` for smoke tests.

5. **Registry choice matters:** GHCR from GitHub Actions is ~10x faster than external registries due to network locality.

6. **Tool version pinning:** Pin tool versions in cache keys (`dx-cli-0.7.3`) to ensure cache invalidation on upgrades.
