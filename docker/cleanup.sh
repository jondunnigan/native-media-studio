#!/bin/sh
set -eu

# The application writes the Unix-millisecond expiry into .ready only after
# recording the same expiry in the database. This never deletes a file early.
while true; do
  now_ms="$(($(date +%s) * 1000))"
  find /media-jobs -mindepth 2 -maxdepth 2 -type f \( -name .ready -o -name .failed \) -print 2>/dev/null | while IFS= read -r marker; do
    expiry_ms="$(cat "$marker" 2>/dev/null || true)"
    case "$expiry_ms" in
      *[!0-9]*|'') continue ;;
    esac
    if [ "$now_ms" -ge "$expiry_ms" ]; then
      rm -rf "$(dirname "$marker")"
    fi
  done
  sleep 1
done
