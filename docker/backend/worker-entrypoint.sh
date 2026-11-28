#!/usr/bin/env bash
set -euo pipefail
cd /app
export PYTHONPATH="/app:${PYTHONPATH:-}"

case "${1:?Explicit runtime command is required}" in
  worker)
    test "$#" -eq 1
    python scripts/check_runtime.py --role worker
    exec python -m celery -A app.runtime.worker.main:celery_app worker \
      --loglevel="${CELERY_LOGLEVEL:-info}" \
      --concurrency="${CELERY_WORKER_CONCURRENCY:-1}"
    ;;
  model-cache)
    shift
    exec python scripts/prepare_model_assets.py "$@"
    ;;
  contract)
    shift
    exec python scripts/check_image_contract.py --role worker "$@"
    ;;
  *)
    echo "Unsupported worker runtime command" >&2
    exit 64
    ;;
esac
