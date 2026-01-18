# Research: Issues #68 and #75

## Issue #68: LMS Play Action

**Status:** Still broken - needs investigation

### Original Report
> It's mostly working: discovery doesn't work (at least not on my Mac). Once I configure the bridge URL manually, most things seem to work, except for the "play" action ("pause" would).

### Investigation from LMS Dev (michaelherger)
Key insight from the LMS forums:
> I just checked via Material skin - watching network traffic and it uses play to resume from pause:
> `{"id":0,"method":"slim.request","params":["00:01:02:03:04:05",["play"]]}`

This contradicts the original assumption that `["play"]` doesn't resume from pause. Material skin successfully uses plain `["play"]` to resume.

The dev also tested:
> I just tried by hand ... and `pause 0` works ... so do you have the correct JSON syntax?
> `{"id":1,"method":"slim.request","params":["00:01:02:03:04:05",["pause","0"]]}`
> Try quoting the "0"

### Current Implementation
**Location:** `src/adapters/lms.rs:562-581`
```rust
"play" => {
    let is_paused = self.state.read().await.players
        .get(player_id)
        .map(|p| p.mode == "pause")
        .unwrap_or(false);
    if is_paused {
        vec![json!("pause"), json!(0)]  // Uses integer 0, not string "0"
    } else {
        vec![json!("play")]
    }
}
```

### Possible Issues to Investigate

1. **JSON serialization of pause parameter**
   - Current: `json!(0)` → sends integer `0`
   - Maybe needs: `json!("0")` → sends string `"0"`
   - LMS dev suggested trying quoted "0"

2. **Player mode cache may be stale**
   - If `is_paused` check returns wrong value, we send wrong command
   - Check if mode is correctly updated on player state changes

3. **Plain `["play"]` might actually work**
   - Material skin uses it successfully
   - Maybe the current workaround is masking another issue

4. **Request ID**
   - Less likely to be the problem, but suggested changing from `1` to unique value
   - Helps with debugging in LMS logs

### Recommended Debug Steps

1. Add logging to see:
   - What player mode we read before sending command
   - Exact JSON-RPC request being sent
   - Response from LMS

2. Try sending plain `["play"]` without the pause check

3. Compare with working Material skin request format

---

## Issue #75: LOG_LEVEL and PORT Environment Variables

**Status:** Bug confirmed - env vars not being read

### Root Cause

The LMS plugin passes these environment variables:
```bash
PORT=8088 LOG_LEVEL=info CONFIG_DIR=... LMS_HOST=127.0.0.1 ./unified-hifi-control
```

But the Rust code expects different variable names:

| LMS Plugin Passes | Rust Code Expects | Location |
|-------------------|-------------------|----------|
| `PORT` | `UHC_PORT` | `src/config/mod.rs:155-160` |
| `LOG_LEVEL` | `RUST_LOG` | `src/main.rs:68-72` |
| `LMS_HOST` | `LMS_HOST` | (already works) |
| `LMS_PORT` | `LMS_PORT` | (already works) |

### Current Code

**Port loading (`src/config/mod.rs:148-160`):**
```rust
let mut builder = ::config::Config::builder()
    .set_default("port", 8088)?
    .add_source(::config::File::with_name(...).required(false))
    // Only reads UHC_PORT, not PORT
    .add_source(
        ::config::Environment::with_prefix("UHC")
            .separator("__")
            .try_parsing(true),
    );
```

**Logging initialization (`src/main.rs:68-75`):**
```rust
tracing_subscriber::registry()
    .with(
        // Reads RUST_LOG, not LOG_LEVEL
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "unified_hifi_control=debug,tower_http=debug,roon_api=info".into()
        }),
    )
```

### Proposed Fix

1. **PORT fallback** - Add to `src/config/mod.rs` before building config:
```rust
// Support legacy PORT env var (used by LMS plugin)
if let Ok(port) = std::env::var("PORT") {
    if let Ok(port_num) = port.parse::<u16>() {
        builder = builder.set_override("port", port_num as i64)?;
    }
}
```

2. **LOG_LEVEL mapping** - Add to `src/main.rs` before tracing init:
```rust
// Map LOG_LEVEL to RUST_LOG if RUST_LOG is not set
if std::env::var("RUST_LOG").is_err() {
    if let Ok(level) = std::env::var("LOG_LEVEL") {
        std::env::set_var("RUST_LOG", format!("unified_hifi_control={}", level));
    }
}
```

### Testing

To verify the fix:
```bash
# Should bind to port 9000 and show info-level logs only
PORT=9000 LOG_LEVEL=info ./target/dx/unified-hifi-control/release/web/unified-hifi-control
```
