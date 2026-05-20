# CLAUDE.md

Guidance for Claude Code working in this repository.

## Repo shape

One deployed unit, three artifacts:

- **`docker-compose.yml`** — five-service stack (`degoog`, `degoog-mcp`, `cloudflared`, `searxng`, `valkey`) on internal network `172.20.0.0/24`. Only `degoog` exposes a host port (`127.0.0.1:4444`); everything else is reached via compose DNS. `cloudflared` terminates two public hostnames (`degoog.itguys.ro`, `degoog-mcp.itguys.ro`).
- **`degoog-mcp/`** — TypeScript MCP server (Node 24+, pnpm, ESM, strict TS, Zod). Wraps degoog's `GET /api/search` plus a Readability URL fetch. Two transports: stdio and streamable-http.
- **`claude-degoog-plugin/`** — Claude Code plugin: registers the stdio MCP server via `.mcp.json` plus a `PreToolUse` deny for `WebSearch`/`WebFetch` and a `UserPromptSubmit` context injection.

## Rules and gotchas

- The plugin's `.mcp.json` hard-codes `${CLAUDE_PLUGIN_ROOT}/../degoog-mcp/dist/index.js` — the plugin dir **must stay a sibling of `degoog-mcp/`**, and `degoog-mcp` must be built (`pnpm run build`) before the plugin works.
- No test suite, no linter config. `tsc` via `pnpm run build` is the only static check.
- `./scripts/backup.sh` tars `data/` + `searxng-config/` to `backups/degoog-<UTC-timestamp>.tar.gz`; `restore.sh` extracts + chowns.
- `data/`, `searxng-config/`, `backups/` are runtime bind mounts / output dirs — gitignored, never commit contents.

### Auth

- **Auth is entirely off-box.** `degoog-mcp` has no app-layer auth; everything non-`/healthz` is gated by Cloudflare Access (Google Workspace SSO). Do not add bearer-token logic — prior commits explicitly removed it (`4ca7371`, `9b2a24e`).
- A 302 to `*.cloudflareaccess.com` on `POST /mcp` is the **correct** production state — Access gating before origin. Not a bug.

### MCP server (`server.ts`)

- The server bridges OAuth discovery to Cloudflare Access: it serves both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` as itself (Claude's OAuth clients ignore PRM pointers to another host), then proxies `/authorize`, `/token`, `/register` to Access's `/cdn-cgi/access/oauth/*`. Driven by `MCP_PUBLIC_BASE_URL` and `MCP_OAUTH_AUTHORIZATION_SERVER`; if either is unset the `.well-known` endpoints 404. Understand this flow before touching OAuth code.
- Streamable-http sessions are a per-process in-memory `Map<sessionId, StreamableHTTPServerTransport>`. Container restart drops all sessions — fine (Claude re-inits) but don't assume persistence.
- When adding optional MCP tool inputs, spread them conditionally into the downstream options object (`exactOptionalPropertyTypes`-friendly pattern — see existing code in `server.ts`).

### Upstream degoog quirk

Passing `type=web` explicitly to `GET /api/search` returns zero results; omitting `type` defaults server-side to web. `src/degoog.ts` only sets `type` for non-web search types — preserve this.

### SearXNG

The auto-generated `searxng-config/settings.yml` needs two post-bootstrap edits before degoog can reach it as a JSON plugin engine with shared state:
- Extend `formats:` from `[html]` to `[html, json]`.
- Set `valkey.url: valkey://valkey:6379/0`.

Then `docker compose restart searxng`. Before changing engine names in `settings.yml`, verify they exist in the SearXNG engine registry — misnamed engines fail at startup with `Cannot load engine "X"`.

### docker-compose

`degoog` is pinned to `172.20.0.10` for rebuild stability. Preserve the subnet and address when editing — `RUNBOOK.md` relies on it.

## Env vars

- `CLOUDFLARE_TUNNEL_TOKEN` (`.env`, `cloudflared`) — required for the tunnel; machine-independent, moves with the repo.
- `DEGOOG_URL` (`degoog-mcp`) — defaults `http://degoog.local:4444`; compose sets `http://degoog:4444`.
- `DEGOOG_DEFAULT_LANGUAGE` (`degoog` + `degoog-mcp`) — ISO 639-1, `ro` default.
- `DEGOOG_TIMEOUT_MS` (`degoog-mcp`) — per-request timeout for calls to degoog.
- `MCP_PUBLIC_BASE_URL` (`degoog-mcp`) — public tunnel URL; required for OAuth discovery.
- `MCP_OAUTH_AUTHORIZATION_SERVER` (`degoog-mcp`) — Cloudflare Access team domain (e.g. `https://itguys.cloudflareaccess.com`); required for OAuth discovery + proxy.

## Editing conventions

- Plugin hooks in `claude-degoog-plugin/hooks/` are plain bash emitting the JSON hook contract on stdout. Shell errors surface as hook failures — use `set -euo pipefail`.
