# claude-degoog (Claude Code plugin)

Forces Claude Code to route all web access through a self-hosted [degoog](https://github.com/fccview/degoog) instance.

## What it does

1. Registers the `degoog` MCP server (stdio) providing `degoog_search` and `degoog_fetch`.
2. Installs a `PreToolUse` hook that **denies** the built-in `WebSearch` and `WebFetch` tools with a message steering Claude to the MCP tools.
3. Installs a `UserPromptSubmit` hook that prefaces every session with a short reminder that web access is routed through degoog.

Net effect: Claude can't accidentally reach the open web. Every query and fetch goes through your degoog exit IP.

## Prerequisites

1. A running degoog instance at `http://degoog.local:4444` (override via `DEGOOG_URL` in `.mcp.json` if different).
2. [`degoog-mcp`](../degoog-mcp) built locally:
   ```sh
   cd ../degoog-mcp
   pnpm install
   pnpm run build
   ```
   The plugin's `.mcp.json` references `${CLAUDE_PLUGIN_ROOT}/../degoog-mcp/dist/index.js`, so the plugin dir must be a sibling of `degoog-mcp/`.
3. Node 24+.

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

Edit `.mcp.json` in the plugin to change the degoog URL or default language:

```json
{
  "mcpServers": {
    "degoog": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/../degoog-mcp/dist/index.js"],
      "env": {
        "DEGOOG_URL": "http://your-degoog:4444",
        "DEGOOG_DEFAULT_LANGUAGE": "en"
      }
    }
  }
}
```

## Files

- `.claude-plugin/plugin.json` — manifest
- `hooks/hooks.json` — hook registration
- `hooks/deny-builtin-web.sh` — PreToolUse deny handler
- `hooks/inject-context.sh` — UserPromptSubmit context injector
- `.mcp.json` — MCP server wiring

## License

MIT.
