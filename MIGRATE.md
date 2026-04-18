# Migration runbook

Everything needed to move this entire stack (degoog + MCP + searxng + valkey + tunnel) to a new box in one shot. Nothing in Cloudflare's dashboard needs to change, and DNS survives.

## What survives the move (free)

- `degoog-mcp.itguys.ro` and `degoog.itguys.ro` — hostnames live in your Cloudflare DNS/Tunnel config, unaffected by the box.
- The Cloudflare Tunnel itself — the token is machine-independent. Same token on a new box = same tunnel resurfacing.
- The Cloudflare Access application + policy protecting `degoog.itguys.ro` — all config lives in Zero Trust, not on the box.

## What you move with you

- This repo (git clone on the new box).
- `.env` — the one secret: `CLOUDFLARE_TUNNEL_TOKEN`. Keep in a password manager.
- A recent backup tarball (`backups/degoog-YYYYMMDDTHHMMSSZ.tar.gz`) containing `data/` and `searxng-config/`.

## Before you pull the plug on the old box

```sh
cd /home/dustfeather/projects/degoog
./scripts/backup.sh              # writes backups/degoog-<timestamp>.tar.gz
```

Transfer `.env` (securely, e.g. via password manager) and the backup tarball to the new box.

## On the new box

```sh
# 1. Install deps
sudo apt install -y docker.io docker-compose-plugin

# 2. Clone the repo
git clone <repo-url> ~/projects/degoog
cd ~/projects/degoog

# 3. Put secrets in place
cp .env.example .env
# edit .env and paste CLOUDFLARE_TUNNEL_TOKEN

# 4. Restore runtime state
./scripts/restore.sh /path/to/degoog-<timestamp>.tar.gz

# 5. Bring the stack up
docker compose up -d
docker compose logs -f
```

Verify:

```sh
# degoog reachable via internal DNS
docker compose exec degoog-mcp wget -qO- http://degoog:4444/ | head -c 80

# tunnel ingress reachable
curl -i https://degoog-mcp.itguys.ro/healthz

# mcp auth works
curl -i -X POST https://degoog-mcp.itguys.ro/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
# Expect 302 to Cloudflare Access login — that means the tunnel reached the
# MCP and Access is gating it, which is the correct production state.
```

Phone access just works: `https://degoog.itguys.ro` authenticates via Google Workspace SSO and routes through the new box's connector.

## Partial-scenario cheat sheet

| Scenario | Action |
| --- | --- |
| Box died, backup is fresh | Full runbook above. |
| Box died, no backup | Reinstall + clone repo. Degoog loses cached state (rebuilds on first queries). SearXNG regenerates default `settings.yml` — re-apply the `formats: [html, json]` and `valkey.url` tweaks. Tunnel token still works. |
| Box alive, just redeploying stack | `docker compose down && docker compose up -d`. No data move needed. |
| Lost `.env` | Recover `CLOUDFLARE_TUNNEL_TOKEN` from Cloudflare dashboard (Zero Trust → Networks → Connectors → (your tunnel) → Refresh). |
| Lost tunnel token | In Cloudflare dashboard, delete the connector and create a new one; paste the new token in `.env`. DNS / hostname survive. |

## Routine backups

Once you're on the new box:

```sh
# Crontab: weekly at 03:00 Sunday, keep 8 most recent backups.
0 3 * * 0 cd ~/projects/degoog && ./scripts/backup.sh && ls -1t backups/degoog-*.tar.gz | tail -n +9 | xargs -r rm
```

Encrypt before uploading offsite:

```sh
gpg --symmetric --cipher-algo AES256 backups/degoog-<timestamp>.tar.gz
# Produces .tar.gz.gpg; push that to object storage / offsite.
```
