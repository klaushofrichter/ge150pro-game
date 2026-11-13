#!/usr/bin/env bash
# Brings games-service (public) into .games-service/: the table host, SDK and test helpers these games are tested
# against. The ref it checks out is in games-service.ref (a branch, tag or commit), so a games-service change that
# breaks a game shows up here as a failing check, not on a table.
#
#   scripts/games-service.sh               clone or update .games-service to the ref, then npm ci in it
#   GAMES_SERVICE_REF=main scripts/games-service.sh
#                                          another ref for this run (the weekly check uses main)
#   GAMES_SERVICE_DIR=../games-service scripts/games-service.sh
#                                          use a local checkout instead (symlinked; nothing is fetched)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=.games-service
REF=${GAMES_SERVICE_REF:-$(tr -d '[:space:]' < games-service.ref)}
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "games-service.ref: '$REF' is not a branch, tag or commit" >&2; exit 1; }

if [ -n "${GAMES_SERVICE_DIR:-}" ]; then
  [ -f "$GAMES_SERVICE_DIR/packages/sdk/src/index.ts" ] || { echo "$GAMES_SERVICE_DIR is not a games-service checkout" >&2; exit 1; }
  rm -rf "$DIR"
  ln -s "$(cd "$GAMES_SERVICE_DIR" && pwd)" "$DIR"
  echo "using the local games-service at $GAMES_SERVICE_DIR ($(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo '?'))"
else
  if [ -L "$DIR" ]; then rm "$DIR"; fi
  if [ ! -d "$DIR/.git" ]; then
    rm -rf "$DIR"
    git clone --quiet --filter=blob:none https://github.com/klaushofrichter/games-service "$DIR"
  fi
  git -C "$DIR" fetch --quiet origin "$REF"
  git -C "$DIR" checkout --quiet --detach FETCH_HEAD
  echo "games-service $REF at $(git -C "$DIR" rev-parse --short HEAD)"
fi
# Its own dependencies (zod, ws, jszip, …) for the host code the tests import.
[ -d "$DIR/node_modules" ] && [ "${FORCE_NPM_CI:-0}" != 1 ] || (cd "$DIR" && npm ci --no-audit --no-fund --loglevel=error)
