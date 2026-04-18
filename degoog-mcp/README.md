# degoog-mcp

MCP server that proxies web search and page extraction through a self-hosted [degoog](https://github.com/fccview/degoog) instance.

Two tools:
- `degoog_search(query, page?, language?, time_filter?, search_type?)` — calls `GET /api/search` on degoog and returns `[{ title, url, snippet, source, thumbnail?, duration? }]`.
- `degoog_fetch(url)` — fetches and extracts readable text via Mozilla Readability.

Two transports:
- `stdio` — for Claude Code and Claude Desktop (local).
- `http` (streamable-http) — for claude.ai web / iOS / Android Custom Connectors, exposed via Cloudflare Tunnel.

## Requirements

Node 24+.

## Install

```sh
pnpm install
pnpm run build
```

## Run

### stdio (local, for Claude Code / Desktop)

```sh
DEGOOG_URL=http://degoog.local:4444 node dist/index.js
```

### http (remote, for claude.ai / mobile)

```sh
cp .env.example .env
node --env-file=.env dist/index.js --transport http --host 127.0.0.1 --port 8765
```

Endpoint: `POST /mcp` (streamable-http). `GET /healthz` is unauthenticated liveness.

**Auth**: the http transport itself does no authentication. It must run behind an upstream gateway (Cloudflare Access OAuth 2.1, or equivalent) that authenticates callers before they reach `/mcp`. Don't expose this port to the public internet without a gateway in front.

## Configuration

See `.env.example`. Key variables:

| Var | Default | Purpose |
| --- | --- | --- |
| `DEGOOG_URL` | `http://degoog.local:4444` | Base URL of your degoog instance. |
| `DEGOOG_DEFAULT_LANGUAGE` | `ro` | Fallback language when the caller omits it. |
| `DEGOOG_TIMEOUT_MS` | `15000` | Request timeout (ms). |

## Docker

```sh
docker build -t degoog-mcp .
docker run --rm -p 8765:8765 \
  -e DEGOOG_URL=http://host.docker.internal:4444 \
  degoog-mcp
```

## Claude Desktop (stdio)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent:

```json
{
  "mcpServers": {
    "degoog": {
      "command": "node",
      "args": ["/absolute/path/to/degoog-mcp/dist/index.js"],
      "env": {
        "DEGOOG_URL": "http://degoog.local:4444"
      }
    }
  }
}
```

## claude.ai Custom Connector (streamable-http)

1. Expose the server via Cloudflare Tunnel and put a Cloudflare Access application in front of it (see the root README). Access acts as the OAuth 2.1 authorization server.
2. In Claude → Settings → Connectors → Add custom connector, set URL to `https://degoog-mcp.itguys.ro/mcp` and Authentication to **OAuth**. The app walks you through an IdP sign-in (Google SSO, etc.) on first use.

## License

MIT.
