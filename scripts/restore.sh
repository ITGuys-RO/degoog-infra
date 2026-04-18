#!/usr/bin/env bash
# Restore runtime state from a backup tarball.
#
# Usage: ./scripts/restore.sh path/to/degoog-YYYYMMDDTHHMMSSZ.tar.gz
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/backup.tar.gz" >&2
  exit 2
fi

ARCHIVE="$1"
if [[ ! -f "$ARCHIVE" ]]; then
  echo "no such file: $ARCHIVE" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [[ -e data || -e wireguard-config || -e searxng-config ]]; then
  echo "ERROR: data/, wireguard-config/, or searxng-config/ already exists." >&2
  echo "Move them aside before restoring to avoid merging state." >&2
  exit 1
fi

echo "Extracting ${ARCHIVE}..."
tar xzf "$ARCHIVE"

echo "Fixing ownership (container runs as UID 1002)..."
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R 1002:1002 data wireguard-config searxng-config
else
  sudo chown -R 1002:1002 data wireguard-config searxng-config
fi

echo "Done. Next: ensure .env is in place, then 'docker compose up -d'."
