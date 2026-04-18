# degoog

Self-hosted private search (degoog) + Wireguard VPN + MCP server + Cloudflare Tunnel — one repo, one `docker compose up`. Every web search Claude does (CLI, Desktop, web, iOS, Android) is routed through *your* degoog instance with a Romanian exit IP. Built-in `WebSearch`/`WebFetch` in Claude Code is blocked.

## What's in the box

```
degoog/
├── docker-compose.yml        # degoog + wireguard + degoog-mcp + cloudflared
├── .env.example              # committed template for secrets
├── data/                     # degoog bind mount (runtime, gitignored)
├── wireguard-config/         # wireguard bind mount (runtime, gitignored)
├── scripts/
│   ├── backup.sh             # tar up data/ + wireguard-config/
│   └── restore.sh            # extract + chown a backup
├── degoog-mcp/               # Node/TS MCP server wrapping degoog's /api/search
├── claude-degoog-plugin/     # Claude Code plugin: hooks + MCP registration
├── MIGRATE.md                # runbook for moving to a new box
└── README.md
```

## Architecture

```
                                                              ┌─────────────┐
                                                              │   Google    │
                                                              │   DDG, etc  │
                                                              └─────▲───────┘
                                                                    │ (Romanian exit IP)
┌──────────────────┐  stdio MCP   ┌──────────────┐  HTTP       ┌────┴────┐
│  Claude Code CLI │─────────────▶│              │────────────▶│ degoog  │
└──────────────────┘              │              │             │  :4444  │
                                  │  degoog-mcp  │             └─────────┘
┌──────────────────┐  stdio MCP   │   :8765      │                  ▲
│  Claude Desktop  │─────────────▶│              │                  │
└──────────────────┘              │              │                  │
                                  │              │          ┌───────┴────────┐
┌──────────────────┐              │              │          │   wireguard    │
│ claude.ai / iOS  │  streamable- │              │          │  (phone LAN    │
│ Android          │─────http────▶│              │          │   access, DNS) │
└──────────────────┘              └──────▲───────┘          └────────────────┘
                                         │ bearer auth
                               Cloudflare Tunnel
                            (degoog-mcp.itguys.ro)
```

All four services share one Docker network (`172.20.0.0/24`). Cloudflared reaches the MCP over the internal hostname `degoog-mcp:8765`. The MCP reaches degoog over `degoog:4444`. Wireguard serves the phone's LAN-side access to `degoog.local` (pinned to `172.20.0.10`).

## Targets

- **Claude Code CLI:** `claude-degoog-plugin` denies built-in `WebSearch`/`WebFetch` via a `PreToolUse` hook and routes Claude to `mcp__degoog__degoog_search` / `degoog_fetch`. Local stdio MCP is bundled via `.mcp.json`.
- **Claude Desktop:** stdio MCP via `claude_desktop_config.json` pointing at `degoog-mcp/dist/index.js`. No hooks available — disable built-in web search manually in Claude settings.
- **claude.ai web, iOS, Android:** streamable-HTTP MCP exposed at `https://degoog-mcp.itguys.ro/mcp` via Cloudflare Tunnel, authenticated with a bearer token. Registered as a Custom Connector.

## First-run install

### 1. Clone + secrets

```sh
git clone <repo> ~/projects/degoog
cd ~/projects/degoog
cp .env.example .env
# Generate a bearer token:
node -e "console.log('DEGOOG_MCP_BEARER=' + crypto.randomBytes(32).toString('base64url'))" >> .env
# Paste your CLOUDFLARE_TUNNEL_TOKEN into .env (from Zero Trust → Networks → Tunnels → (yours) → install connector)
```

### 2. (Optional) Restore prior state

If migrating from another box:

```sh
./scripts/restore.sh path/to/degoog-<timestamp>.tar.gz
```

Otherwise the first start creates empty `data/` and you'll configure degoog fresh. For Wireguard peer keys, you'd need an existing `wireguard-config/` — on first run the container generates one automatically.

### 3. Bring it up

```sh
docker compose up -d
docker compose logs -f
```

Four containers: `degoog`, `wireguard`, `degoog-mcp`, `cloudflared`. On first start degoog may take a few seconds to initialize. Wireguard prints QR codes for new peers into its logs.

### 4. Verify

```sh
# degoog via LAN (same box)
curl http://127.0.0.1:4444/ | head -c 80

# internal compose DNS
docker compose exec degoog-mcp wget -qO- http://degoog:4444/ | head -c 80

# tunnel liveness (public)
curl -i https://degoog-mcp.itguys.ro/healthz

# MCP auth (public)
TOKEN="$(grep DEGOOG_MCP_BEARER .env | cut -d= -f2)"
curl -i -X POST https://degoog-mcp.itguys.ro/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
```

### 5. Wire up Claude clients

**Claude Code CLI:**
```sh
claude --plugin-dir ./claude-degoog-plugin
```

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:
```json
{
  "mcpServers": {
    "degoog": {
      "command": "node",
      "args": ["/absolute/path/to/degoog/degoog-mcp/dist/index.js"],
      "env": { "DEGOOG_URL": "http://127.0.0.1:4444" }
    }
  }
}
```

**claude.ai / mobile** — Settings → Connectors → Add custom connector:
- URL: `https://degoog-mcp.itguys.ro/mcp`
- Auth: Bearer token, paste `$DEGOOG_MCP_BEARER`.

## Development (rebuilding degoog-mcp)

```sh
cd degoog-mcp
pnpm install
pnpm run build
docker compose build degoog-mcp && docker compose up -d degoog-mcp
```

## Migration

See [MIGRATE.md](./MIGRATE.md).

## Backups

```sh
./scripts/backup.sh                  # manual
crontab -e                           # automate (see MIGRATE.md)
```

## Configuration reference

`.env`:

| Var | Purpose |
| --- | --- |
| `DEGOOG_MCP_BEARER` | Required. 32-byte random token the MCP checks on `/mcp`. |
| `DEGOOG_DEFAULT_LANGUAGE` | ISO 639-1, default `ro`. |
| `DEGOOG_TIMEOUT_MS` | Per-request timeout (ms), default `15000`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Required. Connector token from Cloudflare Zero Trust. |

Network (pinned for migration stability):

| Container | Static IP | Ports (host) |
| --- | --- | --- |
| `degoog` | `172.20.0.10` | `127.0.0.1:4444` |
| `wireguard` | auto | `51820/udp` |
| `degoog-mcp` | auto | none (internal only) |
| `cloudflared` | auto | none (outbound only) |

## Upstream quirks

- **`type=web` vs unset:** degoog returns zero results when `type=web` is passed explicitly but works fine when omitted (defaults to web server-side). `degoog-mcp` only sends `type` for non-web searches; see `degoog-mcp/src/degoog.ts`.

## License

MIT.
