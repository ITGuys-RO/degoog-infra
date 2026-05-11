# claude-degoog (Claude Code plugin)

Forces Claude Code to route all web access through a self-hosted [degoog](https://github.com/fccview/degoog) instance.

## What it does

1. Registers the `degoog` MCP server (remote streamable-HTTP) providing `degoog_search` and `degoog_fetch`. The server runs in the K3s cluster at `https://degoog-mcp.itguys.ro/mcp`, gated by Cloudflare Access SSO.
2. Installs a `PreToolUse` hook that **denies** the built-in `WebSearch` and `WebFetch` tools with a message steering Claude to the MCP tools.
3. Installs a `UserPromptSubmit` hook that prefaces every session with a short reminder that web access is routed through degoog.

Net effect: Claude can't accidentally reach the open web. Every query and fetch goes through the degoog exit IP.

## Prerequisites

1. The K3s degoog stack deployed and reachable — see `../K3S_MIGRATION_PLAN.md`. Specifically, `degoog-mcp.itguys.ro` must have an Access **Bypass** policy on `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, and `/register` so MCP OAuth can bootstrap (Phase 4 of the plan).
2. Access to the `dustfeather@gmail.com` (or equivalent) account that satisfies the SSO policy on `degoog-mcp.itguys.ro`.
3. Claude Code with HTTP-MCP support. First connection opens a browser for SSO; subsequent calls reuse the cached OAuth token for the Access session duration.

The previous setup (stdio plugin + local `degoog-mcp/dist/index.js` + docker-compose `degoog` container) has been replaced by the cluster path. The `degoog-mcp/` source tree still lives in this repo because the GH Actions workflow builds the cluster image from it.

## Install (development)

From the monorepo root:

```sh
claude --plugin-dir ./claude-degoog-plugin
```

## Install (permanent)

Once published to a marketplace: `/plugin install claude-degoog@<marketplace>`.

Until then, point a user-level Claude Code config at the plugin directory, or clone this repo and use `--plugin-dir`.

## Verify

In Claude Code:

```
> what's the weather in bucharest?
```

Expected:
- The `PreToolUse` deny appears if Claude attempts `WebSearch` — in transcript, a `deny` permission decision with the reason above.
- Claude calls `mcp__degoog__degoog_search` instead.
- Results come from your degoog instance (Romanian exit IP).

## Overriding defaults

The plugin's `.mcp.json` points at a single remote endpoint:

```json
{
  "mcpServers": {
    "degoog": {
      "type": "http",
      "url": "https://degoog-mcp.itguys.ro/mcp"
    }
  }
}
```

If you've forked this for a different cluster or hostname, change the `url`. The server-side defaults (`DEGOOG_URL`, `DEGOOG_DEFAULT_LANGUAGE`, `DEGOOG_TIMEOUT_MS`) live on the cluster Deployment env (see `../k8s/60-mcp.yaml`), not in the plugin.

## Files

- `.claude-plugin/plugin.json` — manifest
- `hooks/hooks.json` — hook registration
- `hooks/deny-builtin-web.sh` — PreToolUse deny handler
- `hooks/inject-context.sh` — UserPromptSubmit context injector
- `.mcp.json` — MCP server wiring

## License

MIT.
