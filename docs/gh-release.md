# GitHub Release Workflow Caching Strategy

This document explains the caching, parallelization, and artifact reuse strategies in `.github/workflows/release.yml` and `.github/workflows/pr-packages.yml`.

## Overview

The release workflow builds for 5 targets across 3 platforms, plus web assets, Docker images, and platform-specific packages. Using cargo-zigbuild enables effective caching for cross-compiled Linux targets.

## Parallelization Strategy

Jobs are structured to maximize parallelism while respecting dependencies:

```
                    ┌─────────────────┐
                    │  build-web-     │
                    │  assets         │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ build-linux   │  │  build-macos    │  │  build-windows  │
│ (matrix: 3)   │  │  (universal)    │  │                 │
└───────┬───────┘  └────────┬────────┘  └────────┬────────┘
        │                   │                    │
        └───────────────────┼────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  build-docker         │
                │  build-linux-packages │
                │  build-synology       │
                │  build-qnap           │
                └───────────────────────┘
```

- **Independent jobs run in parallel**: Linux matrix (3 targets), macOS, Windows all build simultaneously
- **Dependent jobs wait**: Docker/packages wait for binaries + web assets

## Caching Strategies

### 1. rust-cache with Cross-Workflow Sharing

**Key insight:** Use `shared-key` to share caches between PR builds and release builds.

```yaml
- name: Cache Rust
  uses: Swatinem/rust-cache@v2
  with:
    shared-key: "wasm-build"        # Same key in PR and release workflows
    cache-all-crates: true          # Cache all dependencies, not just workspace
    cache-on-failure: true          # Save cache even if build fails
    cache-directories: target/dx    # Include dioxus build artifacts
```

**Critical:** Both workflows must use **identical settings** for the same `shared-key`. Mismatched options (e.g., one has `cache-all-crates`, other doesn't) can prevent cache sharing.

**Options explained:**
- `shared-key`: Overrides job-based cache key to share across workflows/jobs
- `cache-all-crates`: Caches all crates, not just workspace members (important for proc-macros)
- `cache-on-failure`: Saves partial cache if build fails (speeds up retry)
- `cache-directories`: Additional directories to cache (e.g., `target/dx` for dioxus)

### 2. sccache for Compilation Units

**Used by:** Native builds (Web Assets, macOS, Windows)

```yaml
- name: Setup sccache
  uses: mozilla-actions/sccache-action@v0.0.9

- name: Build
  env:
    SCCACHE_GHA_ENABLED: "true"
    RUSTC_WRAPPER: "sccache"
  run: cargo build --release
```

**Why both sccache AND rust-cache?** They cache different things:
- **sccache**: Caches individual compilation units (`.o` files) keyed by source hash
- **rust-cache**: Caches `target/` directory including proc-macro `.dylib` files

Proc-macros (serde_derive, dioxus, thiserror) can't be cached by sccache due to "crate-type" limitations. rust-cache preserves compiled proc-macro binaries.

**Note:** sccache doesn't support zig's compiler wrapper, so zigbuild jobs use rust-cache only.

### 3. cargo-zigbuild for Linux Cross-Compilation

**Used by:** Linux musl builds (x86_64, aarch64, armv7)

**Why zigbuild instead of cross:** The [cross](https://github.com/cross-rs/cross) tool runs cargo inside Docker containers, which breaks caching - container paths (`/project/`) don't match host paths, invalidating Cargo's fingerprints.

[cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild) uses Zig as a cross-linker without containers:
- rust-cache works normally (no container path issues)
- No Docker image pulls (~15s saved per build)
- Produces static musl binaries

**Setup:**
```yaml
- name: Install zig
  run: |
    curl -L https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz | tar -xJ
    sudo mv zig-linux-x86_64-0.13.0 /opt/zig
    echo "/opt/zig" >> $GITHUB_PATH

- name: Cache cargo-zigbuild
  id: cache-zigbuild
  uses: actions/cache@v4
  with:
    path: ~/.cargo/bin/cargo-zigbuild
    key: cargo-zigbuild-0.20

- name: Install cargo-zigbuild
  if: steps.cache-zigbuild.outputs.cache-hit != 'true'
  run: cargo install cargo-zigbuild --locked

- name: Build
  run: cargo zigbuild --release --target ${{ matrix.target }}
```

**Per-target cache keys:**
```yaml
- name: Cache Rust
  uses: Swatinem/rust-cache@v2
  with:
    shared-key: zigbuild-${{ matrix.target }}  # Separate cache per target
```

### 4. macOS Universal Binary (cargo + lipo)

**Why not zigbuild?** zigbuild can't find macOS system frameworks. Use native cargo for each arch, then combine with `lipo`.

```yaml
- name: Build x86_64
  env:
    SCCACHE_GHA_ENABLED: "true"
    RUSTC_WRAPPER: "sccache"
  run: cargo build --release --target x86_64-apple-darwin

- name: Build aarch64
  env:
    SCCACHE_GHA_ENABLED: "true"
    RUSTC_WRAPPER: "sccache"
  run: cargo build --release --target aarch64-apple-darwin

- name: Create universal binary
  run: |
    lipo -create \
      target/x86_64-apple-darwin/release/unified-hifi-control \
      target/aarch64-apple-darwin/release/unified-hifi-control \
      -output unified-hifi-macos-universal
```

Both architectures build in the same job, sharing one cache entry that contains both `target/x86_64-apple-darwin/` and `target/aarch64-apple-darwin/`.

### 5. Tool Binary Caching

**Dioxus CLI and cargo-zigbuild:**
```yaml
- name: Cache Dioxus CLI
  id: cache-dx
  uses: actions/cache@v4
  with:
    path: ~/.cargo/bin/dx
    key: dx-cli-0.7.3  # Version in key ensures cache invalidation on upgrade

- name: Install Dioxus CLI
  if: steps.cache-dx.outputs.cache-hit != 'true'
  run: cargo install dioxus-cli@0.7.3 --locked
```

**Why:** Tools take 2-3 minutes to compile. Caching binaries saves this on every run.

### 6. GHCR Base Images

**Used by:** Dockerfile.ci, Dockerfile.release

```dockerfile
FROM ghcr.io/linuxcontainers/alpine:3.20
```

**Why GHCR?**
- GitHub Actions runners are co-located with GHCR (~10x faster pulls)
- Docker Hub has rate limits (200 pulls/6 hours) that can block CI

### 7. Web Assets Artifact Sharing

Web assets (WASM + JS) are identical across all platforms. Build once, share via artifacts:

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

## Build Matrix

| Target | Caching | Build Tool | Notes |
|--------|---------|------------|-------|
| Web Assets (WASM) | sccache + rust-cache | dx (dioxus-cli) | shared-key: wasm-build |
| macOS universal | sccache + rust-cache | cargo + lipo | Both archs in one job |
| Windows x86_64 | sccache + rust-cache | cargo | Native build |
| Linux x86_64-musl | rust-cache only | cargo-zigbuild | No sccache (zig wrapper) |
| Linux aarch64-musl | rust-cache only | cargo-zigbuild | No sccache (zig wrapper) |
| Linux armv7-musl | rust-cache only | cargo-zigbuild | +QEMU smoke test |
| Docker multi-arch | N/A | pre-built binaries | Uses Dockerfile.release |

## Smoke Testing Cross-Compiled Binaries

armv7 binaries are smoke-tested on x86_64 runners using QEMU:

```yaml
- name: Smoke test armv7 binary
  if: matrix.target == 'armv7-unknown-linux-musleabihf'
  run: |
    sudo apt-get update && sudo apt-get install -y qemu-user-static
    qemu-arm-static ./target/${{ matrix.target }}/release/unified-hifi-control --version
```

This adds ~14s but catches ABI issues, missing linkage, and startup crashes before release.

## Lessons Learned

1. **Align cache settings across workflows:** When using `shared-key` to share caches between PR and release workflows, ALL settings (`cache-all-crates`, `cache-on-failure`, `cache-directories`) must match. Mismatches prevent cache sharing.

2. **sccache + rust-cache:** Use both for native builds. sccache caches `.o` files, rust-cache caches proc-macro dylibs. zigbuild jobs can only use rust-cache (sccache incompatible with zig wrapper).

3. **Avoid containerized cross-compilation:** `cross` runs cargo in Docker containers, breaking Cargo's fingerprint caching. `cargo-zigbuild` cross-compiles without containers.

4. **Universal macOS via lipo:** Build each arch with native cargo, combine with `lipo`. zigbuild can't find macOS system frameworks.

5. **QEMU for cross-arch testing:** Smoke test armv7 binaries on x86_64 runners. Catches real issues (like missing `--version` support).

6. **Registry locality matters:** GHCR from GitHub Actions is ~10x faster than Docker Hub due to network co-location.

7. **Pin tool versions in cache keys:** `dx-cli-0.7.3` ensures cache invalidation when upgrading tools.

8. **Direct zig download:** Downloading zig directly is faster than using package managers or install actions that might compile from source.
