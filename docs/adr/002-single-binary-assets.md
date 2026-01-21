# ADR 002: Single Binary Asset Distribution

## Status
**Proposed**

## Context

The current build process produces:
1. A server binary (`cargo build --release`)
2. Separate web assets (`dx build --platform web` → `public/` folder with WASM, JS, HTML, CSS)

This requires:
- Setting `DIOXUS_PUBLIC_PATH` environment variable in all deployment scripts
- Shipping/installing assets alongside the binary
- Complex package manifests for AUR, deb, rpm, Synology, QNAP, Windows, macOS, LMS

Users report issues when assets aren't found (#134), and the packaging complexity leads to bugs like `ProtectSystem=strict` blocking runtime symlinks.

## Research Findings

### Fullstack Build Discovery

`dx build --fullstack --release` produces a significantly simpler output:
- **SSR (Server-Side Rendering)** with hydration data embedded in HTML
- **No WASM bundle** - the server renders HTML directly
- **Only 23KB of CSS assets** instead of ~2MB WASM + JS + HTML

The fullstack binary starts and serves pages without the `public/` folder, but CSS returns 404.

### Asset Breakdown

| Asset Type | Current (web build) | Fullstack Build |
|------------|---------------------|-----------------|
| WASM bundle | ~1.5MB | Not needed (SSR) |
| JavaScript | ~50KB | Not needed (SSR) |
| index.html | ~2KB | Not needed (SSR) |
| tailwind.css | 20KB | 20KB |
| dx-theme.css | 3KB | 3KB |
| Component CSS | 8KB | 8KB |
| **Total** | **~1.6MB** | **31KB** |

## Options

### Option A: DIOXUS_PUBLIC_PATH (Current + Fix)
Keep separate assets, use Dioxus's native `DIOXUS_PUBLIC_PATH` env var.

**Pros:**
- Minimal code changes
- Standard Dioxus deployment

**Cons:**
- Still requires shipping assets folder
- All deployment scripts need env var
- 31KB of external files

### Option B: Inline CSS with include_str!
Embed CSS at compile time using `include_str!` and `document::Style`.

```rust
const TAILWIND_CSS: &str = include_str!("../../../public/tailwind.css");
document::Style { {TAILWIND_CSS} }
```

**Pros:**
- True single binary
- No external files or env vars needed
- Simple deployment: copy binary, run

**Cons:**
- 31KB added to binary size (negligible)
- CSS changes require recompile
- Need to inline ~6 CSS files

### Option C: rust-embed
Use `rust-embed` crate to embed assets and serve from memory.

**Pros:**
- Standard pattern for embedded assets
- Works with any file type (images, fonts)

**Cons:**
- New dependency
- Need custom axum middleware before Dioxus
- More complex than inline CSS

### Option D: Data URLs for CSS
Encode CSS as base64 data URLs in link href.

**Pros:**
- No code changes to serving logic

**Cons:**
- 33% larger (base64 overhead)
- Ugly URLs in HTML source

## Decision

**Recommended: Option B (Inline CSS)**

Rationale:
1. Simplest implementation - just change `document::Link` to `document::Style`
2. True single binary - copy and run, no configuration
3. Eliminates entire category of deployment bugs
4. 31KB binary size increase is negligible (~0.3% of 10MB binary)

## Implementation Plan

1. Switch CI from `cargo build` + `dx build --platform web` to `dx build --fullstack`
2. Replace `document::Link { href: asset!(...) }` with `document::Style { {include_str!(...)} }`
3. Handle favicon/icons (either inline as data URLs or accept they need external serving)
4. Remove `DIOXUS_PUBLIC_PATH` from all package scripts
5. Remove `web-assets` CI artifact and tarball

## Files Requiring CSS Inlining

- `src/app/components/layout.rs` - tailwind.css, dx-components-theme.css
- `src/components/navbar/component.rs` - navbar/style.css (3.7KB)
- `src/components/tabs/component.rs` - tabs/style.css (1.9KB)
- `src/components/button/component.rs` - button/style.css (1.4KB)
- `src/components/collapsible/component.rs` - collapsible/style.css (0.8KB)

## Open Questions

1. **Favicon/Icons**: Keep as external files, embed as data URLs, or drop?
2. **Logo image**: Currently served from `/hifi-logo.png` - needs similar treatment
3. **Cross-compilation**: Does `dx build --fullstack` work with cross-compilation targets?

## Consequences

**Positive:**
- Single binary distribution
- No deployment configuration required
- Eliminates PUBLIC_DIR/DIOXUS_PUBLIC_PATH complexity
- Simpler CI (one build step instead of two)

**Negative:**
- CSS changes require full recompile
- Slightly larger binary (~31KB)
- May need fallback for favicon/images
