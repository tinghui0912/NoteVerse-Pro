#!/usr/bin/env bash
set -euo pipefail

cd /app

export PYTHONPATH="/app:${PYTHONPATH:-}"

case "${1:-api}" in
  api)
    exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --reload
    ;;
  worker)
    exec python -m celery -A app.worker.celery_config:celery_app worker --loglevel="${CELERY_LOGLEVEL:-info}"
    ;;
  beat)
    exec python -m celery -A app.worker.celery_config:celery_app beat --loglevel="${CELERY_LOGLEVEL:-info}"
    ;;
  check)
    exec python scripts/check_runtime.py
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
