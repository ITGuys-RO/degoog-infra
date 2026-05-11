# K8s manifests for the degoog stack

Target cluster: `k3s-itguys` (context name). All workloads pin to node
`asus-laptop` via `nodeSelector`. The full migration plan lives at
`../K3S_MIGRATION_PLAN.md` — read that first.

## Layout

| File | Contents |
|---|---|
| `00-namespace.yaml` | `Namespace degoog` |
| `10-pvcs.yaml` | PVCs `degoog-data` (1Gi) and `degoog-backups` (5Gi), both `local-path` |
| `20-degoog.yaml` | `Deployment + Service` for the upstream `ghcr.io/fccview/degoog` image |
| `30-valkey.yaml` | `Deployment + Service` for valkey (ephemeral, no PVC) |
| `40-tor.yaml` | `Deployment + Service` for `dperson/torproxy` |
| `50-searxng.yaml` | `Deployment + Service`. Mounts `settings.yml` from `ConfigMap searxng-settings` — generate that separately, see below |
| `60-mcp.yaml` | `Deployment + Service` for `ghcr.io/itguys-ro/degoog-mcp:latest` (built by `.github/workflows/build-mcp.yml`) |
| `70-backup-cronjob.yaml` | Nightly tar of `degoog-data` to `degoog-backups`, 14-day retention |

## Apply order

```bash
kubectl --context=k3s-itguys apply -f k8s/00-namespace.yaml
kubectl --context=k3s-itguys -n degoog apply -f k8s/10-pvcs.yaml

# Generate + apply the searxng settings ConfigMap from the local file.
# searxng-config/settings.yml is gitignored — keep it on the host, mirror
# it into the cluster via a ConfigMap. Re-run this whenever you change it.
kubectl --context=k3s-itguys -n degoog create configmap searxng-settings \
  --from-file=settings.yml=searxng-config/settings.yml \
  --dry-run=client -o yaml \
  | kubectl --context=k3s-itguys -n degoog apply -f -

kubectl --context=k3s-itguys -n degoog apply \
  -f k8s/20-degoog.yaml \
  -f k8s/30-valkey.yaml \
  -f k8s/40-tor.yaml

# Wait for those Deployments to be Ready, then:
kubectl --context=k3s-itguys -n degoog apply \
  -f k8s/50-searxng.yaml \
  -f k8s/60-mcp.yaml \
  -f k8s/70-backup-cronjob.yaml
```

## Updating the searxng ConfigMap

The Deployment doesn't auto-reload when the ConfigMap changes. After
re-applying the ConfigMap, restart the pod:

```bash
kubectl --context=k3s-itguys -n degoog rollout restart deployment/searxng
```

## Public exposure

Both `degoog-mcp.itguys.ro` and `searxng.itguys.ro` are added to the
existing `itguys-cluster` cloudflared tunnel (UUID
`1a6623ce-1e68-4898-bcc3-a69b0a7abee2`) via the Cloudflare Zero Trust
dashboard — no in-cluster ingress object. The tunnel runs in the
`cloudflare-tunnel` namespace; do not deploy a second cloudflared in
this namespace.

## Verifying in-cluster reachability

```bash
kubectl --context=k3s-itguys -n degoog run -it --rm probe \
  --image=curlimages/curl --restart=Never -- \
  sh -c 'curl -sI http://degoog:4444/; curl -sI http://searxng:8080/'
```
