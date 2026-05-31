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

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
