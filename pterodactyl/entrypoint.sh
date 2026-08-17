#!/usr/bin/env bash
set -euo pipefail

export PORT="${SERVER_PORT:-${PORT:-3000}}"
export MEDIA_WORK_DIR="${MEDIA_WORK_DIR:-/home/container/data/media-jobs}"
mkdir -p "$MEDIA_WORK_DIR"

if [ "${PTERODACTYL_STARTUP_DRY_RUN:-}" = "1" ]; then
  echo "[pterodactyl] dry-run accepted SERVER_PORT=${SERVER_PORT:-unset} effective PORT=$PORT"
  echo "[pterodactyl] persistent media path=$MEDIA_WORK_DIR"
  exit 0
fi

/opt/native-media-studio/pterodactyl/cleanup-media.sh --watch &
cleanup_pid=$!

shutdown() {
  kill "$cleanup_pid" 2>/dev/null || true
  wait "$cleanup_pid" 2>/dev/null || true
  exit 0
}
trap shutdown INT TERM

echo "[pterodactyl] starting Native Media Studio on port $PORT"
node /opt/native-media-studio/scripts/start-production.mjs &
app_pid=$!
wait "$app_pid"
status=$?
kill "$cleanup_pid" 2>/dev/null || true
wait "$cleanup_pid" 2>/dev/null || true
exit "$status"
