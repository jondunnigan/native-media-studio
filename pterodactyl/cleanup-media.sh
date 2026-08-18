#!/usr/bin/env bash
set -euo pipefail

media_root="${MEDIA_WORK_DIR:-/home/container/data/media-jobs}"

cleanup_once() {
  local now_ms marker expiry_ms job_dir
  now_ms="$(( $(date +%s) * 1000 ))"
  [ -d "$media_root" ] || return 0
  while IFS= read -r marker; do
    expiry_ms="$(cat "$marker" 2>/dev/null || true)"
    case "$expiry_ms" in
      *[!0-9]*|"") continue ;;
    esac
    if [ "$now_ms" -ge "$expiry_ms" ]; then
      job_dir="$(dirname "$marker")"
      rm -rf "$job_dir"
      echo "[cleanup] removed expired media job $(basename "$job_dir")"
    fi
  done < <(find "$media_root" -mindepth 2 -maxdepth 2 -type f \( -name .ready -o -name .failed \) -print 2>/dev/null)
}

if [ "${1:-}" = "--watch" ]; then
  while true; do
    cleanup_once
    sleep 5
  done
else
  cleanup_once
fi
