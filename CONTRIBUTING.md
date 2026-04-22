# Contributing

This is a personal self-hosted stack. PRs and issues are welcome but response time is best-effort.

## Before opening a PR

- Open an issue first for anything larger than a typo or one-line fix. Saves both of us effort if the direction doesn't fit.
- Bugs in the upstream degoog UI, SearXNG engines, or cloudflared should go to the respective upstream project. This repo wires them together; it doesn't own them.

## Dev setup

The only buildable component is `degoog-mcp/`.

```sh
cd degoog-mcp
pnpm install
pnpm run build            # tsc → dist/
pnpm run dev              # tsc --watch

# After TS changes, rebuild the container:
docker compose build degoog-mcp && docker compose up -d degoog-mcp
```

There is no test suite. `pnpm run build` (tsc strict) is the only static check. Tests are welcome — keep them runnable as `pnpm test`.

## Style

- **TypeScript:** strict mode, ESM, Zod for tool input schemas. Spread optional props conditionally rather than passing `undefined` (see `src/server.ts` — `exactOptionalPropertyTypes`-friendly pattern).
- **Shell scripts:** `set -euo pipefail` at the top.
- **Plugin hooks** (`claude-degoog-plugin/hooks/`): bash, emit the Claude Code hook JSON contract on stdout, exit non-zero on failure.
- **Commit messages:** short lowercase category prefix + summary. Existing examples:
  - `MCP: bridge OAuth discovery to Cloudflare Access`
  - `degoog: match upstream entrypoint's PUID/PGID pattern`
  - `Rename MIGRATE.md to RUNBOOK.md, reframe as disaster recovery`

## PR checklist

- Short description of the change and *why*.
- How you tested: commands, endpoints, containers rebuilt.
- Breaking changes (env var renames, compose shape changes, plugin config changes) flagged explicitly.
- No secrets, `data/`, `searxng-config/`, or `backups/` in the diff. All gitignored.

## Architectural guardrails

Things the project intentionally does, so you don't accidentally revert them:

- **No app-layer auth in `degoog-mcp`.** Cloudflare Access is the security boundary. Don't add bearer tokens — commits `4ca7371` and `9b2a24e` removed them on purpose.
- **The plugin's `.mcp.json` hardcodes the degoog-mcp build path** (`${CLAUDE_PLUGIN_ROOT}/../degoog-mcp/dist/index.js`). `claude-degoog-plugin/` must stay a sibling of `degoog-mcp/`, and `degoog-mcp` must be built first.
- **Upstream degoog quirk:** passing `type=web` to `/api/search` returns zero results; omitting `type` defaults server-side to web. `src/degoog.ts` only sets `type` for non-web searches. Preserve this.
- **Static internal IP (`172.20.0.10`) for `degoog`.** Don't renumber without updating `RUNBOOK.md`.
- **SearXNG post-bootstrap tweaks** (extend `formats:` to `[html, json]`, set `valkey.url: valkey://valkey:6379/0`) are applied manually on first bring-up. Don't bake them into the image.
