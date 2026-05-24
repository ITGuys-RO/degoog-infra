# CLAUDE.md

## Rules + gotchas

- Plugin `.mcp.json` hard-codes `${CLAUDE_PLUGIN_ROOT}/../degoog-mcp/dist/index.js` — plugin dir MUST stay sibling of `degoog-mcp/`; build `degoog-mcp` (`pnpm run build`) before plugin works.
- No tests, no linter. `tsc` via `pnpm run build` = only static check.
- `data/`, `searxng-config/`, `backups/` = runtime bind mounts, gitignored, never commit.

### Auth (entirely off-box)

- `degoog-mcp` has zero app-layer auth. Everything non-`/healthz` gated by Cloudflare Access (Google Workspace SSO). Do NOT add bearer-token logic — explicitly removed (`4ca7371`, `9b2a24e`).
- 302 to `*.cloudflareaccess.com` on `POST /mcp` = correct prod state (Access gating before origin). Not a bug.

### MCP server (`server.ts`)

- Bridges OAuth discovery to Cloudflare Access: serves both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` as itself (Claude OAuth clients ignore PRM pointers to another host), proxies `/authorize`/`/token`/`/register` to Access `/cdn-cgi/access/oauth/*`. Driven by `MCP_PUBLIC_BASE_URL` + `MCP_OAUTH_AUTHORIZATION_SERVER`; either unset → `.well-known` 404. Understand flow before touching OAuth.
- Streamable-http sessions = per-process in-memory `Map<sessionId, StreamableHTTPServerTransport>`. Container restart drops sessions (fine, Claude re-inits) — don't assume persistence.
- Optional MCP tool inputs: spread conditionally into downstream options (`exactOptionalPropertyTypes`-friendly — see existing `server.ts` patterns).

### Upstream degoog quirk

`type=web` explicit to `GET /api/search` → zero results. Omit `type` → server defaults to web. `src/degoog.ts` only sets `type` for non-web search types — preserve.

### SearXNG

Auto-generated `searxng-config/settings.yml` needs two post-bootstrap edits before degoog can reach it as JSON plugin engine w/ shared state:
- `formats:` `[html]` → `[html, json]`.
- `valkey.url: valkey://valkey:6379/0`.

Then `docker compose restart searxng`. Verify engine names exist in SearXNG engine registry before changing — misnamed → startup fails `Cannot load engine "X"`.

### docker-compose

`degoog` pinned to `172.20.0.10` for rebuild stability. Preserve subnet + address — `RUNBOOK.md` relies on it.

## Env vars

- `CLOUDFLARE_TUNNEL_TOKEN` — required for tunnel, machine-independent.
- `MCP_PUBLIC_BASE_URL` — public tunnel URL, required for OAuth discovery.
- `MCP_OAUTH_AUTHORIZATION_SERVER` — Cloudflare Access team domain (`https://itguys.cloudflareaccess.com`), required for OAuth discovery + proxy.

## Conventions

- Plugin hooks in `claude-degoog-plugin/hooks/` = bash emitting JSON hook contract on stdout. Shell errors surface as hook failures → use `set -euo pipefail`.
