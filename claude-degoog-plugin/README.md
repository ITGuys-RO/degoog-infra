# claude-degoog (Claude Code plugin)

Forces Claude Code to route all web access through a self-hosted [degoog](https://github.com/fccview/degoog) instance.

## What it does

1. Registers the `degoog` MCP server (remote streamable-HTTP) providing `degoog_search` and `degoog_fetch`. The server runs in the K3s cluster at `https://degoog-mcp.itguys.ro/mcp`, gated by a Cloudflare Access **Service Token** — the plugin sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, no browser SSO.
2. Installs a `PreToolUse` hook that **denies** the built-in `WebSearch` and `WebFetch` tools with a message steering Claude to the MCP tools.
3. Installs a `UserPromptSubmit` hook that prefaces every session with a short reminder that web access is routed through degoog.

Net effect: Claude can't accidentally reach the open web. Every query and fetch goes through the degoog exit IP.

## Prerequisites

1. The K3s degoog stack deployed and reachable — see `../K3S_MIGRATION_PLAN.md`.
2. A Cloudflare Access **Service Token** (Zero Trust → Access → Service Auth → Service Tokens) and an Access application on `degoog-mcp.itguys.ro` whose policy set includes a **Service Auth** policy referencing that token. (See Phase 4 of the plan.)
3. Two env vars exported wherever Claude Code reads its environment (e.g. `~/.bashrc`):
   ```sh
   export DEGOOG_MCP_CF_ACCESS_CLIENT_ID="<client-id>.access"
   export DEGOOG_MCP_CF_ACCESS_CLIENT_SECRET="<client-secret>"
   ```
   `.mcp.json` interpolates `${DEGOOG_MCP_CF_ACCESS_CLIENT_ID}` / `${DEGOOG_MCP_CF_ACCESS_CLIENT_SECRET}` into the request headers, so the secret never lands in the repo.
4. Claude Code with HTTP-MCP support.

The previous setup (stdio plugin + local `degoog-mcp/dist/index.js` + docker-compose `degoog` container) has been replaced by the cluster path. The `degoog-mcp/` source tree still lives in this repo because the GH Actions workflow builds the cluster image from it. The MCP server also implements an OAuth-PRM → Cloudflare Access bridge (`/.well-known/oauth-*`, `/authorize`, `/token`, `/register`) for interactive SSO clients like claude.ai web; this plugin doesn't use it.

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

The plugin's `.mcp.json`:

```json
{
  "mcpServers": {
    "degoog": {
      "type": "http",
      "url": "https://degoog-mcp.itguys.ro/mcp",
      "headers": {
        "CF-Access-Client-Id": "${DEGOOG_MCP_CF_ACCESS_CLIENT_ID}",
        "CF-Access-Client-Secret": "${DEGOOG_MCP_CF_ACCESS_CLIENT_SECRET}"
      }
    }
  }
}
```

If you've forked this for a different cluster or hostname, change the `url`. The server-side defaults (`DEGOOG_URL`, `DEGOOG_DEFAULT_LANGUAGE`, `DEGOOG_TIMEOUT_MS`) live on the cluster Deployment env (see `../k8s/60-mcp.yaml`), not in the plugin.

> If your Claude Code build doesn't expand `${VAR}` inside `headers`, fall back to one of: (a) put the literal values in `.mcp.json` and **do not commit** that change, or (b) front the MCP with a small local proxy that injects the headers. Don't ever commit the client secret.

## Files

- `.claude-plugin/plugin.json` — manifest
- `hooks/hooks.json` — hook registration
- `hooks/deny-builtin-web.sh` — PreToolUse deny handler
- `hooks/inject-context.sh` — UserPromptSubmit context injector
- `.mcp.json` — MCP server wiring

## License

MIT.
