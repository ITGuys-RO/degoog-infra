## Summary

<!-- What does this change and why? One or two sentences is plenty. -->

## Tested

<!-- Commands, endpoints, containers you verified. Paste relevant output. -->

- [ ] `pnpm run build` passes (if touching `degoog-mcp/`)
- [ ] Stack comes up cleanly: `docker compose up -d && docker compose ps`
- [ ] (If touching the tunnel or MCP path) `curl -i https://<host>/healthz` still returns `200`

## Breaking changes

<!-- Env var renames, docker-compose shape changes, plugin config changes, backup format changes. "None" is fine. -->

## Related issue

<!-- Closes #N, or "N/A" -->
