# Docker Backend Runtime Runbook

This is the container-based local backend runtime workflow. Native Quality/API
development also uses the locked uv project described in the backend README. Redis
and the database remain installed on the Windows host. Docker runs only the
backend API, Celery worker, and Celery beat.

## Architecture

```text
Windows workspace
  backend source code    -> bind mounted to /app
  model directory        -> bind mounted to /opt/noteverse/models:ro
  Windows Redis          -> reached through host.docker.internal
  Windows database       -> reached through host.docker.internal

Docker services
  api                    -> FastAPI API image
  worker                 -> ML worker image
  beat                   -> lightweight Celery beat image
  quality                -> local quality-check image, not a runtime workload
```

This keeps code iteration fast while making the backend runtime Linux-like.
API uses the HTTP runtime image. Beat uses its own scheduler image so it does
not inherit API, fingering, or ML dependencies. The worker uses the
worker dependency image because it runs OCR/OMR, rendering, playback generation,
and model-cache checks.

When `UVICORN_RELOAD=true`, HTTP services watch `/app/app` only. Runtime data
under `/app/data` is intentionally excluded: Worker uploads and inference
artifacts must never restart the API or control-plane process.

LEGATO is a pinned external source dependency cloned into the backend worker
image at `/opt/noteverse/legato` during image build. See
`docs/architecture/integrations/external-dependencies.md` for the pinned commit
and update process.

## Files

- `docker/backend/Dockerfile.api`: API and migration runtime image.
- `docker/backend/Dockerfile.beat`: Celery beat scheduler runtime image.
- `docker/backend/Dockerfile.worker-deps`: shared worker dependency base image.
- `docker/backend/Dockerfile.worker`: Celery worker and model-cache-agent runtime image.
- `docker/backend/Dockerfile.quality`: local core backend quality-check image.
- `docker/backend/entrypoint.sh`: service command switch.
- `docker-compose.backend-dev.yml`: API, worker, beat, and quality services.
- `backend/.env.docker.example`: Docker-specific backend environment template.
- `backend/.env.docker.worker.example`: Worker-process-only local environment
  template.
- `.dockerignore`: prevents caches, data, models, and local external checkouts
  from being copied into images.

## Prepare Environment

`backend/.env.docker` is required. Docker Compose fails before starting services
when this file is missing.

Copy both Docker environment templates:

```powershell
Copy-Item backend/.env.docker.example backend/.env.docker
Copy-Item backend/.env.docker.worker.example backend/.env.docker.worker
```

Update database and Redis URLs if your Windows host does not expose them through
`host.docker.internal`:

```dotenv
DATABASE_URL=postgresql+asyncpg://postgres:password@host.docker.internal:5432/noteverse_pro
SYNC_DATABASE_URL=postgresql+psycopg://postgres:password@host.docker.internal:5432/noteverse_pro
SCHEDULER_LOCK_DATABASE_URL=postgresql+psycopg://postgres:password@host.docker.internal:5432/noteverse_pro
REDIS_URL=redis://host.docker.internal:6379/0
CELERY_BROKER_URL=redis://host.docker.internal:6379/0
CELERY_RESULT_BACKEND=redis://host.docker.internal:6379/0
```

If `host.docker.internal` cannot reach Redis or the database, use the Windows
LAN IP:

```dotenv
REDIS_URL=redis://192.168.31.59:6379/0
DATABASE_URL=postgresql+asyncpg://postgres:password@192.168.31.59:5432/noteverse_pro
```

Do not commit `backend/.env.docker`.

The backend settings loader does not read `backend/.env`. Local development and
tests must run through Docker with environment provided by `backend/.env.docker`
or deployment-level environment variables.

### Local configuration boundary

`backend/.env.docker` is an untracked local runtime manifest. It may contain
developer-specific infrastructure endpoints, local credentials, and non-secret
development tuning such as Task reliability intervals, retry limits, and batch
sizes. Keep the shared developer baseline in
`backend/.env.docker.example`; do not commit the local copy.

Keep each local file synchronized with its committed example when changing the
local contract. Both examples are checked against the application settings
schema in CI, so they cannot silently accumulate obsolete variables.
`CELERY_WORKER_CONCURRENCY` belongs only in `.env.docker.worker`: it is
consumed by the Worker entrypoint rather than Pydantic settings and must not be
injected into API, Beat, or quality containers.

Task reliability values belong in this local file because Docker Compose must
pass the same values to API, Worker, and Beat while developing. They are not a
production source of truth. Production reliability policy must be reviewed and
versioned with its deployment configuration, tuned against throughput and SLO
evidence, and released with the affected workloads. Kubernetes uses a shared
backend ConfigMap for cross-role baseline values and role-specific ConfigMaps
for Worker/model assets and Control Plane browser security settings. Keep
database URLs, Redis URLs, object-storage keys, mail keys, and cookie secrets in
the deployment secret store rather than a ConfigMap or repository file.

## Prepare Model Volume

The compose file mounts a host model directory to:

```text
/opt/noteverse/models
```

By default Docker Compose mounts the workspace `models` directory:

```text
C:\Users\12631\Downloads\NoteVerse-Pro\models
```

Set `NOTEVERSE_MODEL_ROOT` only when you want to use a different host path, such
as a production-like persistent volume mount:

```powershell
$env:NOTEVERSE_MODEL_ROOT="D:\noteverse\models"
```

The mounted directory must contain:

```text
soundfonts/FluidR3_GM.sf2
paddleocr/official_models/PP-OCRv6_medium_det
paddleocr/official_models/PP-OCRv6_medium_rec
paddleocr/official_models/PP-LCNet_x1_0_textline_ori
huggingface/hub/models--guangyangmusic--legato
huggingface/hub/models--meta-llama--Llama-3.2-11B-Vision
```

Create the host directories:

```powershell
New-Item -ItemType Directory -Force models\soundfonts
New-Item -ItemType Directory -Force models\paddleocr\official_models
New-Item -ItemType Directory -Force models\huggingface\hub
```

Copy model assets into this layout:

```text
FluidR3_GM.sf2
  -> models\soundfonts\FluidR3_GM.sf2

PP-OCRv6_medium_det
  -> models\paddleocr\official_models\PP-OCRv6_medium_det

PP-OCRv6_medium_rec
  -> models\paddleocr\official_models\PP-OCRv6_medium_rec

PP-LCNet_x1_0_textline_ori
  -> models\paddleocr\official_models\PP-LCNet_x1_0_textline_ori

models--guangyangmusic--legato
  -> models\huggingface\hub\models--guangyangmusic--legato

models--meta-llama--Llama-3.2-11B-Vision
  -> models\huggingface\hub\models--meta-llama--Llama-3.2-11B-Vision
```

The required Hugging Face cache directories are determined by the source-owned
LEGATO execution manifest. It currently requires both `guangyangmusic/legato`
and `meta-llama/Llama-3.2-11B-Vision` because Legato loads the Llama vision
encoder at runtime. The Llama repository is gated; the Hugging Face account
behind `HF_TOKEN` must accept its license.

For Hugging Face cache directories, preserve symlinks when copying. If a Windows
copy tool breaks snapshots, copy the cache as a tar archive and extract it into
`models\huggingface`.

## Runtime Directories

The local Docker profile uses explicit runtime directories:

```text
ObjectStorage          durable objects in the configured private namespace
backend/data/work      worker scratch space, storage cache, and Celery beat state
models                 mounted read-only model assets
```

Inside the containers these paths are:

```text
/app/data/work
/opt/noteverse/models
/opt/noteverse/legato
```

Backend services write logs to stdout/stderr. In Kubernetes, Fluent Bit should
collect container logs and send them to Loki for Grafana exploration. Production
containers must not depend on persistent local log files.

Celery beat state is stored under:

```text
backend/data/work/celerybeat/celerybeat-schedule
```

It must not be written to the source root.

## Build Images

Every backend dependency image uses the same `backend/pyproject.toml` and
`backend/uv.lock` with uv 0.13.5 and `--locked`. Dependencies live in the image
venv at `/opt/noteverse/venv`, outside the `/app` source bind mount.

```powershell
docker compose -f docker-compose.backend-dev.yml build api beat quality worker-deps
docker compose -f docker-compose.backend-dev.yml build worker
```

Worker-deps syncs the complete Linux x86_64 CPU-Paddle Worker group directly on
`python:3.12-slim-bookworm`. Torch 2.6.0+cu124, Paddle 3.2.0, OCR and Transformers
are governed by the project/lock, not image-install literals. Legato source is
cloned from the tracked manifest. Model assets remain externally mounted.

For a direct local Worker build, provide the controlled dependency image:

```powershell
docker build -f docker/backend/Dockerfile.worker-deps -t noteverse-backend-worker-deps:dev .
docker build -f docker/backend/Dockerfile.worker --build-arg WORKER_DEPS_IMAGE=noteverse-backend-worker-deps:dev -t noteverse-backend-worker:dev .
```

Trusted Worker publication resolves the governed Python base to OCI, computes
dependency input identity from uv's explicit-target locked Worker graph and material inputs,
qualifies attempt-specific candidates, then promotes only passing OCI digests.
Final composition uses the dependency OCI. PR validation builds locally and
cannot publish. Security/SBOM work keeps lifecycle-scoped disk cleanup; disk
exhaustion is a failure, never a reason to skip a gate.

API selects only `api`; Beat selects only `beat`; Quality selects only `quality`.
API owns customer/control-plane/observability and migration entrypoints. Beat
owns PostgreSQL scheduler locking and Celery, without Worker task implementations.
Worker owns render and heavy OCR/ML.

Offline image contracts run the approved uv dependency check and bounded imports.
Final Worker uses the canonical 16-task registration checker. Contracts do not
initialize models, contact infrastructure or qualify GPU hardware. Full runtime
readiness remains separate.

```powershell
.\scripts\backend_quality_docker.ps1 -Check all
```

See [Runtime Dependency Ownership](../../architecture/runtime/runtime-dependency-ownership.md)
for exact group/source and developer command semantics.

## Start Backend Containers

```powershell
docker compose -f docker-compose.backend-dev.yml up api worker beat
```

API:

```text
http://localhost:8000
```

Frontend can keep running outside Docker:

```powershell
cd apps/customer-web
npm run dev
```

## Run Checks

Check runtime dependencies inside the container:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api check
```

The default is `--role all`. Role-specific checks are also available:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api check --role api
docker compose -f docker-compose.backend-dev.yml run --rm api check --role worker
docker compose -f docker-compose.backend-dev.yml run --rm api check --role beat
```

The roles intentionally have different boundaries:

- `api`: async database, Redis, storage configuration, SoundFont, and API runtime checks.
- `worker`: sync database, Redis, work directory, Celery task registration, selected OMR/render engines, and OCR/Hugging Face models.
- `beat`: Redis and the writable beat schedule directory only.

Worker and beat execute their role checks before starting Celery. A failed
required check exits the process; there is no bypass environment variable.
Model directory sizes are not recursively calculated during startup. Add
`--include-sizes` only for manual diagnostics.

API container probes use:

```text
GET /health/live   process liveness, no dependency calls
GET /health/ready  database readiness plus Redis status
```

Database failure returns `503`. Redis failure returns `200` with a `degraded`
status so login, history, profile, and other non-queue API traffic remains
available. Model and processing-engine checks do not run in FastAPI lifespan or
request probes.

Run migrations:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api migrate
```

Open a shell:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api bash
```

## GPU Notes

LEGATO requires GPU for practical performance. Docker Desktop on Windows needs:

- NVIDIA Windows driver with Docker GPU support. The default base image uses CUDA 12.4 runtime libraries.
- Docker Desktop Linux containers.
- GPU support enabled for Docker Desktop.

The backend compose profile requests GPU access for `worker` with `gpus: all`.
API and beat stay CPU-only. If Docker cannot provide a GPU, the worker should
fail early instead of silently falling back to CPU.

Verify inside the container:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm worker python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no cuda')"
```

Expected output starts with:

```text
True
```

The equivalent check from an interactive shell is:

```bash
python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no cuda')"
```

Or:

```bash
python - <<'PY'
import torch
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "no cuda")
PY
```

If CUDA is not visible, verify Docker Desktop GPU support before debugging
LEGATO itself.

## Operational Notes

- Redis and database are intentionally not containerized in this dev profile.
- The backend source is bind mounted, so code changes are visible immediately.
- The base image should contain dependencies, not business code or model files.
- Models are mounted read-only so application code cannot mutate them.
- `backend/data/work` holds transient worker scratch and cache; durable objects live in ObjectStorage.
- Use the role-aware `scripts/check_runtime.py` as the first diagnostic command after changing image, env, or model mounts.
