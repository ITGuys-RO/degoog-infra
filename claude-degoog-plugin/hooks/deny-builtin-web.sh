#!/usr/bin/env bash
set -euo pipefail

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Web access in this environment is routed through a self-hosted degoog instance. Use the MCP tools `mcp__degoog__degoog_search` for search and `mcp__degoog__degoog_fetch` for URL fetches. Do not use the built-in WebSearch or WebFetch tools."
  }
}
JSON
