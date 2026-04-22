# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

Three intertwined artifacts live here, deployed as one unit:

1. **`docker-compose.yml`** — five-service stack (`degoog`, `degoog-mcp`, `cloudflared`, `searxng`, `valkey`) on a single internal network `172.20.0.0/24`. Only `degoog` exposes a host port (`127.0.0.1:4444`) and `degoog-mcp` exposes `0.0.0.0:8765`. Everything else is reached via compose DNS. `cloudflared` terminates two public hostnames (`degoog.itguys.ro`, `degoog-mcp.itguys.ro`).
2. **`degoog-mcp/`** — TypeScript MCP server (Node 24+, pnpm, ESM). Wraps degoog's `GET /api/search` and a Readability-based URL fetch. Two transports: stdio (for Claude Code/Desktop) and streamable-http (for claude.ai web/mobile Custom Connectors).
3. **`claude-degoog-plugin/`** — Claude Code plugin. Registers the stdio MCP server via `.mcp.json` and installs two hooks: a `PreToolUse` deny for `WebSearch`/`WebFetch` and a `UserPromptSubmit` context injection. The plugin's `.mcp.json` hard-codes `${CLAUDE_PLUGIN_ROOT}/../degoog-mcp/dist/index.js`, so the plugin dir **must remain a sibling of `degoog-mcp/`** and `degoog-mcp` must be built first.

## Common commands

Build / iterate on the MCP server:

```sh
cd degoog-mcp
pnpm install
pnpm run build                # tsc → dist/
pnpm run dev                  # tsc --watch
```

Rebuild the MCP container after TS changes:

```sh
docker compose build degoog-mcp && docker compose up -d degoog-mcp
```

Full stack lifecycle:

```sh
docker compose up -d
docker compose logs -f
docker compose down
```

State backup/restore (tars `data/` + `searxng-config/`):

```sh
./scripts/backup.sh                       # → backups/degoog-<UTC-timestamp>.tar.gz
./scripts/restore.sh <path-to-tarball>    # extract + chown
```

Smoke-test the stack:

```sh
curl http://127.0.0.1:4444/ | head -c 80                      # degoog host port
docker compose exec degoog-mcp wget -qO- http://degoog:4444/  # internal DNS
curl -i https://degoog-mcp.itguys.ro/healthz                  # tunnel + Access bypass
```

A 302 to `*.cloudflareaccess.com` on `POST /mcp` is the **correct** production state — Access is gating the call before it reaches origin.

There is no test suite and no linter config; `tsc` via `pnpm run build` is the only static check.

## Architecture notes worth internalizing

**Auth is entirely off-box.** `degoog-mcp` has no app-layer authentication. Everything non-`/healthz` is expected to be gated by Cloudflare Access (Google Workspace SSO). Do not add bearer-token logic to the server — prior commits explicitly removed it (`4ca7371`, `9b2a24e`).

**The MCP server bridges OAuth discovery to Cloudflare Access.** `src/server.ts` serves both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` as itself (Claude's OAuth clients ignore PRM pointers to a different host), then proxies `/authorize`, `/token`, `/register` to Access's `/cdn-cgi/access/oauth/*` endpoints. `MCP_PUBLIC_BASE_URL` and `MCP_OAUTH_AUTHORIZATION_SERVER` env vars drive this; if either is unset the `.well-known` endpoints 404. Understand this flow before touching anything in `server.ts` around OAuth.

**Streamable-http sessions are per-process in memory.** `src/server.ts` keeps a `Map<sessionId, StreamableHTTPServerTransport>`. Restarting the container drops all sessions — acceptable because Claude re-initializes, but don't assume persistence.

**Upstream degoog quirk:** passing `type=web` explicitly to `GET /api/search` returns zero results; omitting `type` defaults server-side to web. `src/degoog.ts` only sets `type` for non-web search types. Preserve this when editing.

**SearXNG requires two post-bootstrap edits** to the auto-generated `searxng-config/settings.yml` (before it can be reached by degoog as a JSON plugin engine with shared state):
- Extend `formats:` from `[html]` to `[html, json]`.
- Set `valkey.url: valkey://valkey:6379/0`.

Then `docker compose restart searxng`. Before changing any engine names in `settings.yml`, verify they exist in the SearXNG engine registry — misnamed engines fail loudly at startup with `Cannot load engine "X"`.

**Static IPs are pinned for rebuild stability.** `degoog` is nailed to `172.20.0.10` on the internal network. Preserve the subnet and address when editing `docker-compose.yml` — `RUNBOOK.md` relies on it.

## Env vars that actually matter

| Var | Where | Effect |
| --- | --- | --- |
| `CLOUDFLARE_TUNNEL_TOKEN` | `.env`, read by `cloudflared` | Required for the tunnel to come up. Machine-independent; moves with the repo. |
| `DEGOOG_URL` | `degoog-mcp` | Defaults to `http://degoog.local:4444`; compose sets it to `http://degoog:4444`. |
| `DEGOOG_DEFAULT_LANGUAGE` | both `degoog` and `degoog-mcp` | ISO 639-1. `ro` by default. |
| `DEGOOG_TIMEOUT_MS` | `degoog-mcp` | Per-request timeout for calls to degoog. |
| `MCP_PUBLIC_BASE_URL` | `degoog-mcp` | Public URL the MCP is reachable at via tunnel. Required for OAuth discovery. |
| `MCP_OAUTH_AUTHORIZATION_SERVER` | `degoog-mcp` | Cloudflare Access team domain (e.g. `https://itguys.cloudflareaccess.com`). Required for OAuth discovery + proxy. |

## Editing conventions in this repo

- `degoog-mcp` is ESM + strict TS + Zod for tool input schemas. When adding optional MCP tool inputs, spread them conditionally into the downstream options object (see `src/server.ts` — `exactOptionalPropertyTypes`-friendly pattern).
- Hooks in `claude-degoog-plugin/hooks/` are plain bash scripts that emit the JSON hook contract on stdout. Shell errors surface to Claude as hook failures, so `set -euo pipefail`.
- `data/`, `searxng-config/`, and `backups/` are runtime bind mounts / output dirs. They're gitignored — never commit contents.
