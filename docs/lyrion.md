# Lyrion (LMS) Integration Notes

Implementation learnings for the Lyrion Music Server adapter.

## API Reference

- [CLI Documentation](https://lyrion.org/reference/cli/introduction/)
- [Players Command](https://lyrion.org/reference/cli/players/)
- Local docs: `http://HOST:9000/html/docs/cli-api.html`

## Key Fields

### `connected` vs `isplaying`

The `players` query returns both fields with different meanings:

| Field | Meaning | Values |
|-------|---------|--------|
| `connected` | TCP connection to player | 0/1 |
| `isplaying` | Playback state | 0/1 |

**Important:** Mobile apps (iPeng, Squeezer) often show `connected: 0` when:
- App is backgrounded (iOS aggressively suspends)
- Device is sleeping
- Network hiccup

Do NOT filter players by `connected` status - users expect to see paused/idle players.

### `artwork_url` for Streaming Services

For streaming content (Qobuz, Tidal, etc.), LMS returns `artwork_url` as a **relative path**:

```
/imageproxy/https%3A%2F%2Fstatic.qobuz.com%2F.../image.jpg
```

Must prepend `baseUrl` to make it absolute:

```javascript
if (artworkUrl && artworkUrl.startsWith('/')) {
  artworkUrl = `${this.baseUrl}${artworkUrl}`;
}
```

The `coverid` field often returns placeholder icons for streaming content - prefer `artwork_url`.

## Polling Behavior

LMS uses polling (no WebSocket push). Default interval: 2 seconds.

**Zone change notifications:** Only notify bus when player set changes (added/removed), not on every poll. Otherwise zones will flicker in the UI.

```javascript
const setChanged = previousIds.size !== currentIds.size ||
  [...previousIds].some(id => !currentIds.has(id));

if (setChanged && this.onZonesChanged) {
  this.onZonesChanged();
}
```

## JSON-RPC Format

Endpoint: `POST http://HOST:9000/jsonrpc.js`

```json
{
  "id": 1,
  "method": "slim.request",
  "params": ["PLAYER_ID", ["command", "arg1", "arg2"]]
}
```

Use empty string `""` for server-level commands (like `players`).

## Status Tags

Request specific fields with the `tags` parameter:

```javascript
['status', '-', 1, 'tags:aAdltKc']
// a=artist, A=album, d=duration, l=album_id, t=tracknum, K=artwork_url, c=coverid
```

## Authentication

LMS supports HTTP Basic Auth. Include credentials in requests:

```javascript
const auth = Buffer.from(`${username}:${password}`).toString('base64');
headers['Authorization'] = `Basic ${auth}`;
```
