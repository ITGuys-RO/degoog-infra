# Security policy

This is a single-maintainer self-hosted stack. Security response is best-effort, not an SLA.

## Reporting a vulnerability

Please **do not** open a public issue for security-sensitive reports.

- **Preferred:** use GitHub's private vulnerability reporting. On this repo, go to the **Security** tab → **Report a vulnerability**.
- **Alternative:** email `dustfeather@gmail.com` with `degoog security` in the subject.

Include steps to reproduce, which component is affected (MCP server, compose stack, plugin, scripts), and the impact you'd expect.

## Scope

**In scope**

- `degoog-mcp/` — MCP server source (TypeScript, stdio + streamable-http transports).
- `claude-degoog-plugin/` — plugin hooks and configuration.
- `docker-compose.yml`, `scripts/` — orchestration and backup/restore.
- Anything else shipped by this repo.

**Out of scope** (report upstream)

- `fccview/degoog` — https://github.com/fccview/degoog
- SearXNG — https://github.com/searxng/searxng
- Valkey, `cloudflare/cloudflared` — respective upstreams.
- Cloudflare Access / Tunnel platform itself — https://hackerone.com/cloudflare

## What to expect

- Acknowledgement within 7 days.
- A fix or mitigation plan for in-scope issues as time allows. This is a side project; complex rewrites may take longer.
- Credit in the commit or release notes if you want it, or anonymity if you don't.
