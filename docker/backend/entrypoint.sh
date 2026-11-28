#!/usr/bin/env bash
set -euo pipefail
cd /app
export PYTHONPATH="/app:${PYTHONPATH:-}"

http_runtime() {
  local module="$1"
  local -a server=("$module" --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log --no-proxy-headers)
  if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
    server+=(--reload --reload-dir /app/app)
  fi
  exec python -m uvicorn "${server[@]}"
}

case "${1:?Explicit runtime command is required}" in
  customer-api)
    test "$#" -eq 1
    http_runtime app.runtime.customer_api.main:app
    ;;
  control-plane)
    test "$#" -eq 1
    python scripts/check_runtime.py --role control
    http_runtime app.runtime.control_plane.main:app
    ;;
  beat)
    test "$#" -eq 1
    python scripts/check_runtime.py --role beat
    exec python -m app.runtime.beat.leader -- \
      python -m celery -A app.runtime.beat.main:celery_app beat \
      --loglevel="${CELERY_LOGLEVEL:-info}"
    ;;
  migrator)
    test "$#" -eq 1
    alembic upgrade head
    exec python scripts/provision_database.py grants
    ;;
  database-bootstrap)
    shift
    exec python scripts/provision_database.py bootstrap "$@"
    ;;
  seed-integration)
    shift
    exec python scripts/seed_integration_user.py "$@"
    ;;
  create-operator)
    shift
    exec python scripts/create_operator.py "$@"
    ;;
  contract)
    shift
    exec python scripts/check_image_contract.py --role core "$@"
    ;;
  *)
    echo "Unsupported core runtime command" >&2
    exit 64
    ;;
esac
