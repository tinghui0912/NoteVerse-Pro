#!/usr/bin/env bash
set -euo pipefail

cd /app

export PYTHONPATH="/app:${PYTHONPATH:-}"

enable_uvicorn_reload() {
  # Runtime data is bind mounted below /app/data. Watch only application source
  # so worker artifacts cannot restart an HTTP process during active work.
  uvicorn_args+=(--reload --reload-dir /app/app)
}

case "${1:-api}" in
  api)
    uvicorn_args=(app.runtime.customer_api.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log --no-proxy-headers)
    if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
      enable_uvicorn_reload
    fi
    exec python -m uvicorn "${uvicorn_args[@]}"
    ;;
  control)
    python scripts/check_runtime.py --role control
    uvicorn_args=(app.runtime.control_plane.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log --no-proxy-headers)
    if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
      enable_uvicorn_reload
    fi
    exec python -m uvicorn "${uvicorn_args[@]}"
    ;;
  observability-exporter)
    python scripts/check_runtime.py --role observability-exporter
    uvicorn_args=(app.runtime.observability.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log --no-proxy-headers)
    exec python -m uvicorn "${uvicorn_args[@]}"
    ;;
  worker)
    python scripts/check_runtime.py --role worker
    exec python -m celery -A app.runtime.worker.main:celery_app worker \
      --loglevel="${CELERY_LOGLEVEL:-info}" \
      --concurrency="${CELERY_WORKER_CONCURRENCY:-1}"
    ;;
  beat)
    python scripts/check_runtime.py --role beat
    exec python -m app.runtime.beat.leader -- \
      python -m celery -A app.runtime.beat.main:celery_app beat \
      --loglevel="${CELERY_LOGLEVEL:-info}"
    ;;
  check)
    shift
    exec python scripts/check_runtime.py "$@"
    ;;
  migrate)
    alembic upgrade head
    exec python scripts/provision_database.py grants
    ;;
  bash)
    exec /bin/bash
    ;;
  *)
    exec "$@"
    ;;
esac
