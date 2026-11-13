#!/usr/bin/env bash
# Every browser check, as CI runs them. Each starts its own Table Host from .games-service (run scripts/games-service.sh
# first). Usage: scripts/e2e/run-all.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:-e2e-out}
mkdir -p "$OUT"
[ -d .games-service ] || { echo "run scripts/games-service.sh first" >&2; exit 1; }
status=0
for check in scripts/e2e/ge150_pro.py; do
  echo "== $check"
  python3 "$check" "$OUT" || status=1
done
exit $status
