# Dioxus Fullstack + DioxusLabs/components Research

## Problem
- DioxusLabs/components render but don't work (NavbarItem doesn't navigate, Collapsible doesn't expand)
- Dashboard shows "Loading status..." forever (use_resource never resolves)
- Plain anchor tags work, but component interactivity is broken

## Root Cause: Hydration Not Happening

All three AI models (Gemini, Grok, ChatGPT) agree:

> The HTML looks right, but the JavaScript (WASM) hasn't taken over the page. This is a classic **Hydration** issue.

### What Hydration Does
- SSR renders initial HTML for fast loading
- Client loads WASM bundle
- WASM "hydrates" the DOM - attaches event handlers, starts futures, enables interactivity

### Why Components Don't Work Without Hydration
- `NavbarItem` with `to` prop: needs router/onclick handlers attached
- `Collapsible`: needs onclick + state management
- `use_resource`: the future is never polled without client execution

## Fixes Required

### 1. Use `serve_dioxus_application` instead of manual merge

**Current (broken):**
```rust
app.merge(dioxus::server::router(App));
```

**Correct:**
```rust
use dioxus_fullstack::prelude::*;

let app = Router::new()
    // Custom API routes first
    .route("/status", get(status_handler))
    .route("/zones", get(zones_handler))
    // ... other API routes ...
    // Then Dioxus app (handles SSR, hydration, and static assets)
    .serve_dioxus_application(ServeConfig::builder().build(), App);
```

This helper automatically:
- Serves static assets (WASM/JS bundle)
- Handles SSR rendering
- Serializes hydration data
- Sets up server function endpoints

### 2. Use `use_server_future` instead of `use_resource`

For SSR-compatible async data:
```rust
// Instead of:
let data = use_resource(|| async { fetch_data().await });

// Use:
let data = use_server_future(|| async { fetch_data().await });
```

`use_server_future` serializes results for hydration and auto-suspends.

### 3. Ensure WASM assets are served

Check browser dev tools:
- Network tab: confirm `.wasm` and `.js` files load with 200 (not 404)
- Console: look for hydration errors

### 4. Build correctly

Use `dx serve` for development - it handles:
- Hot-reloading
- Asset bundling
- Fullstack mode (both server and client builds)

For production:
```bash
dx build --release
```

## Key Insight from Dioxus Docs

> SSR is progressive, meaning by default pages are rendered on the client, and you can opt-in to rendering components on the server.

The `fullstack` feature enables both SSR and hydration. If hydration isn't working, components stay in their static, non-interactive state.

## Alternative: LiveView (No WASM)

If you want interactivity without shipping WASM to the client, Dioxus supports LiveView - server-driven UI over WebSocket. Different architecture entirely.

## References
- [Dioxus SSR docs](https://dioxuslabs.com/learn/0.7/essentials/fullstack/ssr/)
- [Dioxus Fullstack Project Setup](https://dioxuslabs.com/learn/0.7/essentials/fullstack/project_setup/)
- [dioxus_server docs.rs](https://docs.rs/dioxus/latest/dioxus/prelude/dioxus_server/index.html)
- [DioxusLabs/components GitHub](https://github.com/DioxusLabs/components)
