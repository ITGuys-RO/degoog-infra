#!/usr/bin/env bash
# Snapshot runtime state (degoog data + wireguard config) into ./backups/.
# Run BEFORE migrating to a new box, or on a schedule.
#
# Usage: ./scripts/backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p backups

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/degoog-${STAMP}.tar.gz"

echo "Creating ${OUT}"
tar czf "${OUT}" \
  --numeric-owner \
  data \
  wireguard-config

echo
echo "Backup complete. Keep it somewhere safe:"
echo "  ${OUT} ($(du -h "${OUT}" | cut -f1))"
echo
echo "wireguard-config contains peer private keys. Treat this file as a secret."
