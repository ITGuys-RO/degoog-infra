---
name: searxng-gotchas
description: |
  SearXNG gotchas (degoog instance) — engine `engine:` key must map to /usr/local/searxng/searx/engines/<engine>.py or "Cannot load engine"/FileNotFoundError silently sets it inactive (archive_org_web/wayback/archive_org_scholar/hackernews NOT shipped; enumerate engines first); google.py get_google_info() hardcodes gen_gsa_useragent() (Google Go UA) + CONSENT=YES+ and `params["headers"].update()` CLOBBERS settings.yml `headers:` block (bing/duckduckgo/brave/startpage DO honor it); JA3/JA4 TLS fingerprint is the real anti-bot ceiling (curl_cffi impersonate=chrome124). Container UID 977 owns settings.yml.
author: Claude Code
version: 1.0.0
date: 2026-05-31
---

# SearXNG Gotchas (degoog)

## SearXNG: verify engine names before editing settings.yml

**When:** Adding engines to `settings.yml`. Logs show:
```
ERROR:searx.engines: Cannot load engine "archive_org_web"
FileNotFoundError: [Errno 2] No such file or directory:
  '/usr/local/searxng/searx/engines/archive_org_web.py'
ERROR:searx.engines: loading engine wayback machine failed:
  set engine to inactive!
```
Engine silently set inactive, no UI flag. Common cause: copying from
blogs/AI/docs that don't match the image's registry.

**Root cause:** `engine:` key must map to a Python module at
`/usr/local/searxng/searx/engines/<engine>.py`. `name:` is arbitrary label;
`engine:` is the module name.

**Fix — enumerate first:**
```sh
docker compose exec -T searxng ls /usr/local/searxng/searx/engines/ \
  | sed 's/\.py$//' | grep -v __ | sort
```

NOT shipped in stock `searxng/searxng`: `archive_org_web` / Wayback Machine,
`archive_org_scholar`, `hackernews`. Shipped: `annas_archive`,
`public_domain_image_archive`. Options for missing engines: skip; write
custom Python module (~50 lines `request()`+`response()`) mounted at
`/usr/local/searxng/searx/engines/<name>.py`; community fork; SearXNG
`command` engine (security risk).

**Verify:**
```sh
docker compose restart searxng && sleep 5
docker compose logs --since 1m searxng \
  | grep -iE "cannot load|failed:|FileNotFoundError" | head -20
curl -s "http://127.0.0.1:<port>/search?q=test&format=json&engines=<new_name>" \
  | jq '.number_of_results'
```

Notes: `wikidata` raises `KeyError: 'name'` in `init()` recent builds;
`ahmia`/`torch` need Tor. Container UID 977 owns settings.yml — edit with
`sudo` or `docker compose exec -u root searxng sh`.

## SearXNG google engine: headers config is silently overridden

**When:** Adding `headers:` block under `- name: google` in `settings.yml`
has NO effect on outgoing `User-Agent` / `Accept`. Same for `google_images`,
`google_news`, `google_videos`, `google_scholar`.

**Root cause:** In `/usr/local/searxng/searx/engines/google.py`
`get_google_info()` (lines ~269-270):
```python
ret_val["headers"]["Accept"] = "*/*"
ret_val["headers"]["User-Agent"] = gen_gsa_useragent()
ret_val["cookies"]["CONSENT"] = "YES+"
```
And in `request()` (~line 320):
```python
params["cookies"] = google_info["cookies"]
params["headers"].update(google_info["headers"])   # ← clobbers settings.yml
```
`gen_gsa_useragent()` returns line from `searx/data/gsa_useragents.txt` with
suffix ` NSTNWV` — Google Search Appliance / "Google Go" mobile UAs, not
desktop Chrome. Deliberate: Google Go has lower anti-bot scrutiny than
desktop Chrome. Engine never sets `sec-ch-ua-*` (Google Go doesn't either —
sending would be mismatch signal). `CONSENT=YES+` bypasses EU consent wall.

**Fix (only when actually hitting CAPTCHAs/`sorry.google.com`):**
1. Bind-mount patched `google.py`:
   ```yaml
   volumes:
     - ./searxng-config/engines/google.py:/usr/local/searxng/searx/engines/google.py:ro
   ```
2. Fork+rebuild image.
3. Swap HTTP transport to `curl_cffi` with `impersonate="chrome124"` (fixes
   headers AND TLS/H2 fingerprint together — the only real defeater).

TLS/H2 fingerprint (JA3/JA4) is the actual ceiling — python `httpx`/`h11`
emits a distinct non-browser JA4. No header tweak hides this. IP reputation
usually matters more than fingerprint fidelity.

**Verify:**
```sh
docker compose exec searxng grep -nE 'Accept|User-Agent|gen_gsa_useragent' \
  /usr/local/searxng/searx/engines/google.py
```

Never bake logged-in Google session cookies (`SID`, `__Secure-1PSID`,
`SAPISID`, `NID`, `APISID`) — leaks identity across tenants. Only safe
session cookie is `CONSENT=YES+`. Engines without this hardcoded override
(`bing`, `duckduckgo`, `brave`, `startpage`) DO honor `headers:` config.

