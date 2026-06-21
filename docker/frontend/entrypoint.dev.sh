#!/bin/sh
set -eu

stamp_file="node_modules/.noteverse-package-lock.sha256"
lock_hash="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
installed_hash=""

if [ -f "$stamp_file" ]; then
  installed_hash="$(cat "$stamp_file")"
fi

if [ ! -x node_modules/.bin/next ] || [ "$installed_hash" != "$lock_hash" ]; then
  echo "package-lock.json changed; refreshing frontend dependencies..."
  npm ci --prefer-offline
  printf '%s\n' "$lock_hash" > "$stamp_file"
fi

exec "$@"
