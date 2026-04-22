# degoog

Self-hosted private search (degoog + SearXNG) + MCP server + Cloudflare Tunnel — one repo, one `docker compose up`. Every web search Claude does (CLI, Desktop, web, iOS, Android) is routed through *your* degoog instance with a Romanian exit IP. Built-in `WebSearch`/`WebFetch` in Claude Code is blocked.

## What's in the box

```
degoog/
├── docker-compose.yml        # degoog + degoog-mcp + cloudflared + searxng + valkey
├── .env.example              # committed template for secrets
├── data/                     # degoog bind mount (runtime, gitignored)
├── searxng-config/           # searxng bind mount (runtime, gitignored)
├── scripts/
│   ├── backup.sh             # tar up data/ + searxng-config/
│   └── restore.sh            # extract + chown a backup
├── degoog-mcp/               # Node/TS MCP server wrapping degoog's /api/search
├── claude-degoog-plugin/     # Claude Code plugin: hooks + MCP registration
├── RUNBOOK.md                # disaster-recovery / rebuild-from-backup
└── README.md
```

## Architecture

```
                                                              ┌─────────────┐
                                                              │ Google, DDG │
                                                              │ Brave, Bing │
                                                              │  + 240 more │
                                                              └─────▲───────┘
                                                                    │ (Romanian exit IP)
                                                                    │
                                                              ┌─────┴───────┐
                                                              │   searxng   │
                                                              │    :8080    │
                                                              └─────▲───────┘
                                                                    │ plugin
┌──────────────────┐  stdio MCP   ┌──────────────┐  HTTP       ┌────┴────┐
│  Claude Code CLI │─────────────▶│              │────────────▶│ degoog  │
└──────────────────┘              │              │             │  :4444  │
                                  │  degoog-mcp  │             └─────────┘
┌──────────────────┐  stdio MCP   │   :8765      │                  ▲
│  Claude Desktop  │─────────────▶│              │                  │
└──────────────────┘              │              │                  │
                                  │              │             ┌────┴────┐
┌──────────────────┐  streamable- │              │             │ Browser │
│ claude.ai / iOS  │─────http────▶│              │             │ phone / │
│ Android          │              │              │             │ desktop │
└──────────────────┘              └──────▲───────┘             └────▲────┘
                                         │ Google SSO (OAuth 2.1)   │ Google SSO
                               Cloudflare Access            Cloudflare Access
                            (degoog-mcp.itguys.ro)           (degoog.itguys.ro)
```

Five services share one Docker network (`172.20.0.0/24`). Cloudflared terminates two public hostnames, both gated by Cloudflare Access + Google Workspace SSO: `degoog-mcp.itguys.ro` → `http://degoog-mcp:8765` (remote MCP, OAuth for Claude mobile/web Custom Connectors) and `degoog.itguys.ro` → `http://degoog:4444` (browser UI). The MCP server itself has no app-layer auth — Access authenticates every call before it reaches origin. SearXNG runs on the same internal network and is queried by degoog as a plugin engine. Valkey provides in-memory state for SearXNG's limiter and engine-token caches.

## Targets

- **Claude Code CLI:** `claude-degoog-plugin` denies built-in `WebSearch`/`WebFetch` via a `PreToolUse` hook and routes Claude to `mcp__degoog__degoog_search` / `degoog_fetch`. Local stdio MCP is bundled via `.mcp.json`.
- **Claude Desktop:** stdio MCP via `claude_desktop_config.json` pointing at `degoog-mcp/dist/index.js`. No hooks available — disable built-in web search manually in Claude settings.
- **claude.ai web, iOS, Android:** streamable-HTTP MCP exposed at `https://degoog-mcp.itguys.ro/mcp` via Cloudflare Tunnel. Cloudflare Access sits in front and acts as the OAuth 2.1 authorization server; the Claude app does a Google sign-in through Access on first connection. Registered as a Custom Connector with OAuth auth.
- **Browser UI (phone + desktop):** `https://degoog.itguys.ro` via Cloudflare Tunnel, gated by a Cloudflare Access policy requiring Google Workspace SSO (`@itguys.ro`). `/opensearch.xml` and `/public/*` are Bypass-policy'd so browser features (search engine auto-discover, PWA manifest, favicons) work without auth.

## First-run install

### 1. Clone + secrets

```sh
git clone <repo> ~/projects/degoog
cd ~/projects/degoog
cp .env.example .env
# Paste your CLOUDFLARE_TUNNEL_TOKEN into .env (from Zero Trust → Networks → Tunnels → (yours) → install connector)
```

In Cloudflare Zero Trust, create Access applications for `degoog.itguys.ro` and `degoog-mcp.itguys.ro` with a policy that requires your Google Workspace SSO (or whichever IdP you use). The MCP server expects Access to gate all non-`/healthz` requests — it does no auth of its own.

### 2. (Optional) Restore prior state

If migrating from another box:

```sh
./scripts/restore.sh path/to/degoog-<timestamp>.tar.gz
```

Otherwise the first start creates empty `data/` and you'll configure degoog fresh. SearXNG bootstraps its own `searxng-config/settings.yml` on first boot; after it comes up, edit that file to (a) extend `formats:` from `[html]` to `[html, json]`, (b) set `valkey.url: valkey://valkey:6379/0`, then `docker compose restart searxng`.

### 3. Bring it up

```sh
docker compose up -d
docker compose logs -f
```

Five containers: `degoog`, `degoog-mcp`, `cloudflared`, `searxng`, `valkey`. On first start degoog may take a few seconds to initialize.

### 4. Verify

```sh
# degoog via LAN (same box)
curl http://127.0.0.1:4444/ | head -c 80

# internal compose DNS
docker compose exec degoog-mcp wget -qO- http://degoog:4444/ | head -c 80

# tunnel liveness (public, /healthz bypasses Access)
curl -i https://degoog-mcp.itguys.ro/healthz

# MCP (should redirect to Cloudflare Access login — 302 to cloudflareaccess.com)
curl -i -X POST https://degoog-mcp.itguys.ro/mcp \
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
- Auth: **OAuth**. The app discovers Cloudflare Access's OAuth metadata and walks you through a Google sign-in on first use.

## Development (rebuilding degoog-mcp)

```sh
cd degoog-mcp
pnpm install
pnpm run build
docker compose build degoog-mcp && docker compose up -d degoog-mcp
```

## Disaster recovery

See [RUNBOOK.md](./RUNBOOK.md).

## Backups

```sh
./scripts/backup.sh                  # manual
crontab -e                           # automate (see RUNBOOK.md)
```

## Configuration reference

`.env`:

| Var | Purpose |
| --- | --- |
| `DEGOOG_DEFAULT_LANGUAGE` | ISO 639-1, default `ro`. |
| `DEGOOG_TIMEOUT_MS` | Per-request timeout (ms), default `15000`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Required. Connector token from Cloudflare Zero Trust. |

Network (pinned for migration stability):

| Container | Static IP | Ports (host) |
| --- | --- | --- |
| `degoog` | `172.20.0.10` | `127.0.0.1:4444` |
| `degoog-mcp` | auto | none (internal only) |
| `cloudflared` | auto | none (outbound only) |
| `searxng` | auto | none (internal only) |
| `valkey` | auto | none (internal only) |

## Upstream quirks

- **`type=web` vs unset:** degoog returns zero results when `type=web` is passed explicitly but works fine when omitted (defaults to web server-side). `degoog-mcp` only sends `type` for non-web searches; see `degoog-mcp/src/degoog.ts`.

## License

MIT.
