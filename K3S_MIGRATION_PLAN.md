# K3s migration plan — degoog stack

Plan for moving the docker-compose stack in this repo to the existing K3s cluster.
Written by Claude Code on 2026-05-11; revised the same day after live cluster
verification (runner name, wsl taint state, GHCR namespace, tunnel mechanism)
and a round of user-decision lock-in (see Section 5). Designed to be executed
by a fresh agent that does not have prior conversation context.

---

## 0. Required reading before you start

1. **Cluster state file**: `/home/dustfeather/cloudflare-mesh-k3s-state.md`
   on the user's WSL machine. It documents the cluster, kubeconfig setup,
   tunnel, ARC runners, etc. **Read it.** Many decisions in this plan refer
   to facts in there.
2. **The current stack**: `~/projects/degoog/docker-compose.yml` and
   `~/projects/degoog/.env.example` in this repo.
3. **The MCP server source**: `~/projects/degoog/degoog-mcp/` (Node.js).

If any fact in this plan disagrees with the current cluster state, **trust
the cluster** — re-verify with `kubectl --context=k3s-itguys get ...`
before acting.

---

## 1. Goal

Replace the docker-compose stack with K8s workloads on the existing K3s
cluster (`k3s-itguys` context). Keep functional parity:

- `degoog-mcp.itguys.ro` and `searxng.itguys.ro` reachable publicly via
  Cloudflare tunnel + Access SSO.
- All inter-service traffic stays in-cluster.
- `degoog`'s app data persists across pod restarts.
- `searxng`'s `settings.yml` is version-controlled (move to a ConfigMap).
- Backups continue to work (mechanism may change — see Phase 5).

Out of scope: `wireguard-config/` directory in this repo is a separate
project, not in docker-compose. Ignore it.

---

## 2. Cluster context summary (so you don't have to rediscover)

You run `kubectl` and `helm` from WSL. The kubeconfig is merged via env var
already exported in `~/.bashrc` and `~/.profile`:
```
KUBECONFIG=$HOME/.kube/config:$HOME/.kube/k3s-itguys.yaml
```
Use `--context=k3s-itguys` on every command (the default context is
`docker-desktop`, which is NOT this cluster).

Key facts:

| Thing | Value |
|---|---|
| K3s version | v1.35.4+k3s1 |
| Nodes | `asus-laptop` (control-plane, 100.96.0.2, 30 GB RAM, always-on) and `wsl` (sporadic, 100.96.0.1, may be down for hours/days) |
| Node taint on `wsl` | `ephemeral=true:NoSchedule`. Live-verify with `kubectl --context=k3s-itguys get node wsl -o jsonpath='{.spec.taints}'`. Pods without a matching toleration only land on `asus-laptop` — which is the intended outcome for every workload in this stack, so don't add tolerations. |
| Default storage class | `local-path` (provisioner `local-path-provisioner` in `kube-system`). PVCs are pinned to the node where the pod first runs. |
| Existing cloudflared tunnel | UUID `1a6623ce-1e68-4898-bcc3-a69b0a7abee2`, name `itguys-cluster`, deployed in namespace `cloudflare-tunnel` (2 replicas). Token-based / dashboard-managed ingress (no in-cluster ingress ConfigMap — confirmed: only `kube-root-ca.crt` lives there). Currently routes `headlamp.itguys.ro` → `headlamp.headlamp.svc.cluster.local:80`. **Reuse this tunnel** — add new public hostnames via the CF Zero Trust dashboard, not via manifest changes. |
| Cloudflared Deployment uses | `TUNNEL_TRANSPORT_PROTOCOL=http2` env var (UDP/443 to CF edge is blocked on this LAN). Liveness `/ready` with `failureThreshold=6, periodSeconds=15`. |
| GHCR push: ARC runner | This repo is **`ITGuys-RO/degoog-infra`** (org-owned, NOT `dustfeather/degoog`). The runner scale set to use is **`arc-itguys-ro`** in ns `arc-runners` (org-scoped, maxRunners=5, DinD, minRunners=0). There is no per-repo `arc-itguys-ro-degoog-infra` runner. Target it with `runs-on: arc-itguys-ro`. |
| Helm | v4.1.4 at `~/.local/bin/helm` |
| Headlamp dashboard | `https://headlamp.itguys.ro` (CF Access SSO + bearer token: `kubectl --context=k3s-itguys -n kube-system create token headlamp-admin --duration=24h`) |
| k9s | `~/.local/bin/k9s --context k3s-itguys` |

**Workload placement guideline**: ALL workloads pin to `asus-laptop` via
`nodeSelector: kubernetes.io/hostname=asus-laptop`. Three reasons:
(1) local-path PVs are node-local so anything stateful must pin anyway;
(2) `wsl` carries `ephemeral=true:NoSchedule` and no toleration is set
on any of these workloads; (3) `asus-laptop` is the control-plane —
if it's down, the cluster is down, so distributing the stateless pods
to `wsl` buys no real availability. Keep all five Deployments
(`degoog`, `degoog-mcp`, `searxng`, `valkey`, `tor`) on `asus-laptop`.

---

## 3. Target architecture

Single namespace `degoog` containing:

| Workload | Kind | Notes |
|---|---|---|
| `degoog` | Deployment + Service | Pre-built image `ghcr.io/fccview/degoog:latest`. Persistent `data` PVC. **Pin to asus-laptop.** PUID/PGID env vars retained. ClusterIP svc on :4444. |
| `degoog-mcp` | Deployment + Service | Image `ghcr.io/itguys-ro/degoog-mcp:<tag>` (built by GH Actions, pushed to GHCR — see Phase 1). Stateless. **Pin to asus-laptop** (no toleration for the wsl taint). ClusterIP svc on :8765. |
| `searxng` | Deployment + Service | `searxng/searxng:latest`. Mount `settings.yml` from a ConfigMap. **Pin to asus-laptop.** ClusterIP svc on :8080. |
| `valkey` | Deployment + Service | `valkey/valkey:9-alpine`, ephemeral (`--save "" --appendonly no`), no PVC. **Pin to asus-laptop.** ClusterIP svc on :6379. |
| `tor` | Deployment + Service | `dperson/torproxy:latest`. **Pin to asus-laptop.** ClusterIP svc on :9050 (and :9051 control). |
| `degoog-data` | PVC | RWO, ~1 Gi to start (current usage ~80 MB, grows). StorageClass: default (local-path). |
| `searxng-settings` | ConfigMap | Holds `settings.yml` checked into this repo at `searxng-config/settings.yml`. |

**Public exposure** (added to existing `itguys-cluster` cloudflared tunnel,
NO new cloudflared):
- `degoog-mcp.itguys.ro` → `degoog-mcp.degoog.svc.cluster.local:8765`
- `searxng.itguys.ro` → `searxng.degoog.svc.cluster.local:8080`

**Don't do these things** (compose habits that break in K8s):
- Don't set `container_name`. K8s ignores it.
- Don't set static IPs (`ipv4_address`). Use Service DNS.
- Don't expose `127.0.0.1:4444` on a node. ClusterIP is the equivalent for
  internal traffic; tunnel handles external.
- Don't deploy another cloudflared. Add hostnames to the existing tunnel.

---

## 4. Phase-by-phase plan

### Phase 1 — Build pipeline for `degoog-mcp`

**Why first**: nothing else can run until the image exists in a registry.

1. Add a workflow at `.github/workflows/build-mcp.yml` in this repo:
   - Trigger: `push` to `main`, paths `degoog-mcp/**` and the workflow itself;
     also `workflow_dispatch`.
   - `runs-on: arc-itguys-ro` (org-scoped DinD runner in ns `arc-runners`,
     maxRunners=5). Do NOT use `arc-df-*` runners — those are
     `dustfeather/`-scoped and this repo lives in the `ITGuys-RO` org.
   - Steps: pinned `actions/checkout@<SHA> # v6.0.2` (use the same SHA as
     the other workflows in this repo — `de0fac2e4500dabe0009e67214ff5f5447ce83dd`
     — for CodeQL `actions/unpinned-tag` cleanliness), log into GHCR with
     `${{ secrets.GITHUB_TOKEN }}`, `docker buildx build` the
     `./degoog-mcp` directory, push two tags:
     `ghcr.io/itguys-ro/degoog-mcp:${{ github.sha }}` and
     `ghcr.io/itguys-ro/degoog-mcp:latest`.
   - Set `permissions: { contents: read, packages: write }`.
2. Push the workflow file. Watch the run in github.com Actions tab AND
   `kubectl --context=k3s-itguys -n arc-runners get pods -w` (you should
   see an ephemeral runner pod spin up).
3. Verify: `https://github.com/ITGuys-RO/degoog-infra/pkgs/container/degoog-mcp`
   should show the new image.
4. **First push of a new GHCR package is private by default.** After the
   first successful build, flip it to public in GitHub:
   `Settings → Packages → degoog-mcp → Change visibility → Public`.
   Once public, the cluster pulls anonymously and Phase 2 needs no
   `imagePullSecret`.

**Locked-in decision**: GHCR package will be **public** (user choice).
Skip the `imagePullSecret` section in Phase 2.

### Phase 2 — K8s manifests

Create directory `k8s/` in this repo. Files:

- `k8s/00-namespace.yaml` — `Namespace degoog`.
- `k8s/10-pvc.yaml` — `PersistentVolumeClaim degoog-data` (RWO, 1Gi, default
  storage class).
- `k8s/15-configmap-searxng.yaml` — `ConfigMap searxng-settings` with
  `settings.yml` key. Generate it from the file in this repo:
  `kubectl create configmap searxng-settings --from-file=settings.yml=searxng-config/settings.yml --dry-run=client -o yaml`.
- `k8s/20-degoog.yaml` — Deployment + Service. Image
  `ghcr.io/fccview/degoog:latest`, env `DEGOOG_DEFAULT_SEARCH_LANGUAGE=ro`,
  `PUID=1002`, `PGID=1002`. Mount `degoog-data` PVC at `/app/data`.
  `nodeSelector: kubernetes.io/hostname=asus-laptop`.
  Service ClusterIP, port 4444.
- `k8s/30-valkey.yaml` — Deployment + Service. Image `valkey/valkey:9-alpine`,
  args `["valkey-server","--save","","--appendonly","no"]`. No PVC. ClusterIP
  on 6379.
- `k8s/40-tor.yaml` — Deployment + Service. Image `dperson/torproxy:latest`.
  ClusterIP on 9050.
- `k8s/50-searxng.yaml` — Deployment + Service. Image
  `searxng/searxng:latest`. Env `SEARXNG_BASE_URL=https://searxng.itguys.ro/`.
  Mount `searxng-settings` ConfigMap as a file at
  `/etc/searxng/settings.yml`. **Pin to asus-laptop.**
  Service ClusterIP on 8080.
- `k8s/60-mcp.yaml` — Deployment + Service. Image
  `ghcr.io/itguys-ro/degoog-mcp:latest` (or pinned SHA). Env
  `DEGOOG_URL=http://degoog:4444`, plus the optional MCP_* envs from
  `.env.example` (use a Secret for any sensitive ones; the OAuth issuer
  URL is public, can be a literal). Service ClusterIP on 8765.

Apply order: namespace → PVC + ConfigMap → backends → frontends.

```bash
kubectl --context=k3s-itguys apply -f k8s/00-namespace.yaml
kubectl --context=k3s-itguys -n degoog apply -f k8s/10-pvc.yaml -f k8s/15-configmap-searxng.yaml
kubectl --context=k3s-itguys -n degoog apply -f k8s/20-degoog.yaml -f k8s/30-valkey.yaml -f k8s/40-tor.yaml
# Wait for those to be Ready, then:
kubectl --context=k3s-itguys -n degoog apply -f k8s/50-searxng.yaml -f k8s/60-mcp.yaml
```

**Image pull secret**: NOT needed. The user opted for a public GHCR
package; the cluster pulls anonymously. If you ever flip the package
back to private, add an `imagePullSecret` as a separate change.

### Phase 3 — Migrate the persistent data

The current `./data` directory has ~80 MB. Get it onto the PVC:

1. Apply `00`, `10`, `20-degoog.yaml`. The pod starts with an empty PVC.
2. Stop the docker-compose `degoog` container so writes are quiesced
   on the source: `cd ~/projects/degoog && docker compose stop degoog`.
3. Copy:
   ```bash
   POD=$(kubectl --context=k3s-itguys -n degoog get pod -l app=degoog -o jsonpath='{.items[0].metadata.name}')
   kubectl --context=k3s-itguys -n degoog cp ~/projects/degoog/data "$POD:/app/data" -c degoog
   ```
   (`kubectl cp` overwrites; if you want a clean slate, delete `/app/data/*`
   inside the pod first via `kubectl exec`.)
4. Restart the degoog pod so it re-reads everything cleanly:
   `kubectl --context=k3s-itguys -n degoog rollout restart deployment/degoog`.
5. Verify in the pod: `kubectl exec -it ... -- ls -la /app/data` — should
   show the files with the right ownership (PUID 1002).

### Phase 4 — Public exposure via the existing tunnel

Do NOT deploy another cloudflared.

1. **Tunnel ingress** — for a dashboard-managed (token-based) tunnel this
   can be done in the UI (Zero Trust → Networks → Tunnels →
   `itguys-cluster` → Public Hostname → Add) OR via the API
   (`PUT /accounts/{acct}/cfd_tunnel/{tunnel}/configurations`). Add all
   three hostnames with **service type HTTP** (the cluster Services speak
   plain HTTP — HTTPS here causes `tls: first record does not look like a
   TLS handshake` → 502):

   | Hostname | Service URL |
   |---|---|
   | `degoog.itguys.ro` | `http://degoog.degoog.svc.cluster.local:4444` |
   | `searxng.itguys.ro` | `http://searxng.degoog.svc.cluster.local:8080` |
   | `degoog-mcp.itguys.ro` | `http://degoog-mcp.degoog.svc.cluster.local:8765` |

   `degoog.itguys.ro` exposes the upstream degoog web UI for direct
   browser use without WARP. **If you add a hostname via the API, also
   create the CNAME** (`<subdomain>` → `<tunnel-id>.cfargotunnel.com`,
   proxied) — the `/configurations` endpoint does NOT create DNS records;
   the dashboard "Add public hostname" button does both.

2. **Access applications** — Access → Applications → Add an application →
   Self-hosted, one per hostname. Allow policy: same emails as the
   existing Headlamp app (`dustfeather@gmail.com`, `contact@itguys.ro`),
   session duration ≥ 24 h. For `degoog.itguys.ro` and `searxng.itguys.ro`
   that's all — a single Allow policy.

3. **`degoog-mcp.itguys.ro` Access app — use a Service Token, not SSO.**
   The MCP client (Claude Code) is headless, so an interactive SSO flow
   is the wrong tool. Instead:
   - Zero Trust → Access → **Service Auth → Service Tokens** → create one
     (e.g. named `degoog-mcp`). Copy the **Client ID** (`<random>.access`)
     and **Client Secret** (shown once).
   - In the `degoog-mcp.itguys.ro` Access application, add a policy with
     **Action: Service Auth** that Includes that token. Protect the whole
     hostname (no path restriction) — the client sends the credential
     headers on every request, so `/mcp`, `/healthz`, `/.well-known/*`
     are all covered. Optionally also keep a human Allow policy alongside
     it for browser debugging.
   - The plugin (`claude-degoog-plugin/.mcp.json`) sends
     `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, sourced
     from `${DEGOOG_MCP_CF_ACCESS_CLIENT_ID}` /
     `${DEGOOG_MCP_CF_ACCESS_CLIENT_SECRET}` env vars (so the secret
     stays out of git). See Phase 9.

   Note: CF Access *policies* cannot path-match — only *applications*
   can (via `domain/path`). The Service-Auth-on-whole-hostname approach
   sidesteps that entirely. (The MCP server's OAuth-PRM bridge —
   `/.well-known/oauth-*`, `/authorize`, `/token`, `/register` — still
   works for interactive clients like claude.ai web, but with whole-host
   Service Auth those paths require the token too; that's fine for the
   Claude Code path and claude.ai-web MCP isn't shipping yet anyway.)

4. Test:
   ```bash
   curl -sI https://degoog.itguys.ro/                       # 302 → SSO  ✓
   curl -sI https://searxng.itguys.ro/                      # 302 → SSO  ✓
   curl -sI https://degoog-mcp.itguys.ro/mcp                # 401/302 (Access wants the token)  ✓
   curl -s -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET" \
     -X POST -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"p","version":"0"}}}' \
     https://degoog-mcp.itguys.ro/mcp
   # ↑ with valid creds: MCP initialize result. Without: Access 401/302.
   ```

### Phase 5 — Backups

**Locked-in decision**: same-node, K8s-native backups on `asus-laptop`.
No cross-node mirroring, no off-site. User rationale: `asus-laptop` is
the control-plane — if it dies, the cluster's down anyway, so storing
the backup tarball next to the live data is acceptable for this
workload's value.

The current `scripts/backup.sh` writes tarballs to `./backups/`. K8s
equivalent:

1. Add a second PVC `degoog-backups` (RWO, ~5 Gi to start, default
   storage class — local-path, same node as the data PVC since both
   pin to `asus-laptop`).
2. Add a `CronJob backup-degoog` in ns `degoog` running on schedule
   (e.g., `0 3 * * *`):
   - `nodeSelector: kubernetes.io/hostname=asus-laptop` (same as everything
     else — also necessary so it can mount both PVCs, which both live on
     this node).
   - Mounts `degoog-data` PVC at `/src` as `readOnly: true`.
   - Mounts `degoog-backups` PVC at `/dst`.
   - Command: `tar -czf /dst/degoog-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /src .`
     then prune older than N days (`find /dst -name 'degoog-*.tar.gz'
     -mtime +14 -delete`).
   - Image: `busybox:1` or `alpine:3` — small, has tar+find+date.
   - `concurrencyPolicy: Forbid`, `successfulJobsHistoryLimit: 1`,
     `failedJobsHistoryLimit: 3`.
3. Quiescing the source: a `readOnly: true` mount is good enough for
   degoog's workload (SQLite isn't involved; data is mostly cache files).
   If you ever need a true point-in-time snapshot, switch to scaling
   `degoog` to 0 before the tar and back to 1 after.

There is no off-box copy. If you later want one (B2/R2 via restic),
add it as a separate CronJob — out of scope for this migration.

### Phase 6 — Cutover and decommission

1. Confirm K3s stack works end-to-end via the public URLs.
2. Update any external clients/integrations pointing at the old MCP URL
   (if it changed at all).
3. `cd ~/projects/degoog && docker compose down` — stop the old stack.
4. Optionally: delete the old image and remove the docker-compose stack
   from this repo (or keep it as a local-dev fallback — see Phase 8).
5. Update this repo's `README.md` and `RUNBOOK.md` to reflect the new
   deployment model.

### Phase 7 — Verification

Run after every phase, not just the end:

```bash
kubectl --context=k3s-itguys -n degoog get pods,svc,pvc,cm
kubectl --context=k3s-itguys -n degoog logs deploy/degoog --tail=20
kubectl --context=k3s-itguys -n degoog logs deploy/degoog-mcp --tail=20
kubectl --context=k3s-itguys -n degoog logs deploy/searxng --tail=20

# In-cluster reachability
kubectl --context=k3s-itguys -n degoog run -it --rm probe --image=curlimages/curl --restart=Never -- \
  sh -c 'curl -sI http://degoog:4444/; curl -sI http://searxng:8080/; curl -sI http://valkey:6379/'

# Public reachability (302 = CF Access redirect, expected)
curl -sI https://degoog-mcp.itguys.ro/
curl -sI https://searxng.itguys.ro/
```

### Phase 8 — Docker-compose cleanup

**Locked-in decision**: once Phase 6 cutover is verified green for at
least 24 hours, delete the compose stack outright (user choice).

Concretely, in a final cleanup PR:

- Remove `docker-compose.yml`, `.env.example`, the `cloudflared` config
  in this repo if any, and the `scripts/backup.sh`/`scripts/restore.sh`
  scripts (they target the compose layout). Replace `scripts/` with
  whatever the K8s equivalents are, or delete the directory.
- Remove the `data/`, `searxng-config/`, `backups/` bind-mount
  directories from the repo's `.gitignore` if they only existed because
  of compose.
- Update `README.md` and `RUNBOOK.md` to describe K3s deployment only.
  Leave a single line near the top: "Historical compose setup is in the
  git history; see commit `<cutover-commit-SHA>`."

If devs later want a local stack for iteration, they can use a local
k3d/kind cluster against the same manifests in `k8s/`, not a separate
compose path. Don't add a `k8s/local/` overlay until someone actually
needs it.

### Phase 9 — Local Claude Code → cluster MCP (Option C, via Service Token)

**Locked-in decision**: local Claude Code talks to the cluster MCP via
its remote streamable-HTTP transport at
`https://degoog-mcp.itguys.ro/mcp`, NOT via a local stdio child process.
It authenticates with a **Cloudflare Access Service Token** — two
headers (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) on every
request — not the interactive OAuth-SSO flow. No local Node.js runtime,
no port-forward, no WARP, no browser handshake.

(Rationale: a CLI client is headless. The MCP server's OAuth-PRM bridge
in `src/server.ts` is the right tool for *interactive* clients like
claude.ai web; for Claude Code a service token is simpler and durable.
The bridge stays in place, just unused by this plugin.)

**Prerequisites** (must be true before this works):

1. Phase 4 done, including: the `degoog-mcp.itguys.ro` Access app exists
   with a **Service Auth** policy referencing the `degoog-mcp` service
   token, and the tunnel ingress + CNAME for `degoog-mcp.itguys.ro` are
   in place.
2. The cluster Deployment `degoog-mcp` is Running (image
   `ghcr.io/itguys-ro/degoog-mcp:latest`, package public). `POST /mcp`
   with valid Service-Token headers returns an `initialize` result.
3. Two env vars exported wherever Claude Code reads its environment
   (the user's `~/.bashrc` / `~/.profile`):
   ```sh
   export DEGOOG_MCP_CF_ACCESS_CLIENT_ID="<client-id>.access"
   export DEGOOG_MCP_CF_ACCESS_CLIENT_SECRET="<client-secret>"
   ```

**Change in this repo**: `claude-degoog-plugin/.mcp.json` becomes:

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

The plugin's `PreToolUse` deny on `WebSearch`/`WebFetch` and the
`UserPromptSubmit` context injection stay unchanged — they don't depend
on the MCP transport.

**Validation** (do this on first deploy):

```bash
# Without creds — Access should reject:
curl -sI -X POST https://degoog-mcp.itguys.ro/mcp        # expect 401/302 from Access

# With creds — should get an MCP initialize result:
curl -s -H "CF-Access-Client-Id: $DEGOOG_MCP_CF_ACCESS_CLIENT_ID" \
        -H "CF-Access-Client-Secret: $DEGOOG_MCP_CF_ACCESS_CLIENT_SECRET" \
        -X POST -H 'Content-Type: application/json' \
        -H 'Accept: application/json, text/event-stream' \
        --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"p","version":"0"}}}' \
        https://degoog-mcp.itguys.ro/mcp

# Then reload the plugin in Claude Code and run a search-y prompt —
# mcp__degoog__degoog_search should answer with no browser popup.
```

**Risk / fallbacks**:
- If a Claude Code build doesn't expand `${VAR}` inside `.mcp.json`
  `headers`: put the literal values in `.mcp.json` and DON'T commit that
  change, or front the MCP with a tiny local header-injecting proxy.
  Never commit the client secret.
- If the whole HTTP-MCP path misbehaves: temporary fallback is stdio +
  `kubectl port-forward -n degoog svc/degoog 4444:4444` against the
  upstream degoog (Option A from the original design discussion — see
  git history of this file).

**What gets deleted** under Option C, beyond Phase 8:

- `claude-degoog-plugin/.mcp.json`'s old `command` / `args` / `env`
  stdio block (replaced with `type` + `url` + `headers`).
- The local `degoog-mcp/dist/` build is no longer needed for plugin
  function. The `degoog-mcp/` SOURCE tree stays — the build workflow
  uses it as the Docker build context.

---

## 5. Locked-in decisions (resolved 2026-05-11 with user)

| # | Decision | Choice | Notes |
|---|---|---|---|
| 1 | GHCR package visibility | **Public** | No imagePullSecret. Flip in Settings → Packages after first push (first push defaults to private). |
| 2 | Backup strategy | **Same-node CronJob → backup PVC on asus-laptop** | No off-site, no cross-node mirror. See Phase 5. |
| 3 | `searxng-config/settings.yml` ownership (`977:977`) | Move to ConfigMap, normalize ownership on the host file with `sudo chown $USER:$USER searxng-config/settings.yml` before generating the ConfigMap | After ConfigMap migration the host file becomes inert; delete it in the Phase 8 cleanup. |
| 4 | Compose stack cleanup | **Delete after Phase 6 cutover** | See revised Phase 8. |
| 5 | Manifest layout | Plain YAML in `k8s/` | No Helm, no Kustomize. Apply with `kubectl apply -f k8s/`. |
| 6 | `wsl` node usage | All workloads pin to `asus-laptop` | No tolerations, no scheduling to wsl. Section 2 covers rationale. |
| 7 | Public hostnames on the tunnel | Three: `degoog-mcp.itguys.ro`, `searxng.itguys.ro`, `degoog.itguys.ro` | All Access-gated with SSO. `degoog.itguys.ro` exposes the search UI so it works in any browser without WARP. |
| 8 | Local Claude Code → MCP after migration | **Option C: remote HTTP MCP** at `https://degoog-mcp.itguys.ro/mcp`, authed with a **CF Access Service Token** (`CF-Access-Client-Id`/`-Secret` headers, sourced from env vars) | No stdio child, no port-forward, no browser SSO. Requires an Access app on `degoog-mcp.itguys.ro` with a Service Auth policy for the `degoog-mcp` token. See Phase 9. The server's OAuth-PRM bridge stays for interactive clients (claude.ai web) but is unused by the plugin. |

---

## 6. Rollback

If anything breaks during cutover and you want to revert:

```bash
# Stop the K3s stack (pods only — keep PVCs/ConfigMaps so we can retry)
kubectl --context=k3s-itguys -n degoog scale deployment --all --replicas=0

# Remove the public hostnames in CF dashboard (degoog-mcp.itguys.ro, searxng.itguys.ro)
# OR temporarily point them at a maintenance-page worker.

# Restart docker-compose
cd ~/projects/degoog && docker compose up -d
```

The old `./data` directory is NOT modified by the migration (we only
COPY from it). Rolling back to compose just restarts the old containers.

To fully wipe the K3s deployment when truly done:
```bash
kubectl --context=k3s-itguys delete namespace degoog
```
This deletes everything including PVCs.

---

## 7. Watch out for

- **`docker compose` on WSL still runs**. As long as both stacks are up,
  CF Access will route traffic to whichever the public hostname points at.
  Do not skip the cutover step — you can have stale state in the old stack.
- **Image pull on first deploy**. Pulling `searxng/searxng` (~300 MB) and
  `degoog` over the cluster's outbound is fine now (WARP profile is
  Include-mode, traffic bypasses the Cloudflare edge). If you see
  `ImagePullBackOff` lasting more than a couple minutes, check
  `kubectl describe pod ...` for the actual error — don't guess.
- **`kubectl cp` permissions**. The PVC is owned by whatever user the pod
  runs as. If `degoog` runs as `1002:1002`, post-`cp` the files are owned
  by your host user — `kubectl exec ... chown -R 1002:1002 /app/data`
  before restarting.
- **Time skew on `wsl` node** can break TLS to CF. Not a worry for now
  but if anything mysterious fails after a long sleep, check
  `timedatectl` on both nodes.
- **Don't pin specific image SHAs unless you have a reason**. `:latest`
  for `searxng`, `valkey`, `tor`, `cloudflared` is fine for a homelab.
  For `degoog-mcp` (your own build), prefer pinning to the git SHA the
  workflow pushed.
