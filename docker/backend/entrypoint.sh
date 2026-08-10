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
    uvicorn_args=(app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log)
    if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
      enable_uvicorn_reload
    fi
    exec python -m uvicorn "${uvicorn_args[@]}"
    ;;
  practice)
    python scripts/check_runtime.py --role practice
    uvicorn_args=(app.practice_main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log)
    if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
      enable_uvicorn_reload
    fi
    exec python -m uvicorn "${uvicorn_args[@]}"
    ;;
  control)
    python scripts/check_runtime.py --role control
    uvicorn_args=(app.control_plane_main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log)
    if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
      enable_uvicorn_reload
    fi
    exec python -m uvicorn "${uvicorn_args[@]}"
    ;;
  observability-exporter)
    python scripts/check_runtime.py --role observability-exporter
    uvicorn_args=(app.observability_main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log)
    exec python -m uvicorn "${uvicorn_args[@]}"
    ;;
  worker)
    export NOTEVERSE_CELERY_IMPORT_TASKS=true
    python scripts/check_runtime.py --role worker
    exec python -m celery -A app.worker.celery_config:celery_app worker \
      --loglevel="${CELERY_LOGLEVEL:-info}" \
      --concurrency="${CELERY_WORKER_CONCURRENCY:-1}"
    ;;
  beat)
    python scripts/check_runtime.py --role beat
    exec python -m app.modules.scheduler_lock.beat_leader -- \
      python -m celery -A app.worker.celery_config:celery_app beat \
      --loglevel="${CELERY_LOGLEVEL:-info}"
    ;;
  check)
    shift
    exec python scripts/check_runtime.py "$@"
    ;;
  migrate)
    exec alembic upgrade head
    ;;
  bash)
    exec /bin/bash
    ;;
  *)
    exec "$@"
    ;;
esac
