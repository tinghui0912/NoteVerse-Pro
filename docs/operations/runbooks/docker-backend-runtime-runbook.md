# Docker Backend Runtime Runbook

This is the only supported local backend runtime workflow going forward. Redis
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
  practice               -> realtime practice image
  worker                 -> ML worker image
  beat                   -> lightweight Celery beat image
  quality                -> local quality-check image, not a runtime workload
```

This keeps code iteration fast while making the backend runtime Linux-like.
API uses the HTTP runtime image. Beat uses its own scheduler image so it does
not inherit API, practice, fingering, or ML dependencies. The worker uses the
worker dependency image because it runs OCR/OMR, rendering, playback generation,
and model-cache checks.

When `UVICORN_RELOAD=true`, HTTP services watch `/app/app` only. Runtime data
under `/app/data` is intentionally excluded: Worker uploads and inference
artifacts must never restart the API, Practice, or control-plane process.

LEGATO is a pinned external source dependency cloned into the backend worker
image at `/opt/noteverse/legato` during image build. See
`docs/architecture/integrations/external-dependencies.md` for the pinned commit
and update process.

## Files

- `docker/backend/Dockerfile.ml-base`: Python 3.12 + PyTorch 2.6 CUDA wheel base image.
- `docker/backend/Dockerfile.api`: API and migration runtime image.
- `docker/backend/Dockerfile.beat`: Celery beat scheduler runtime image.
- `docker/backend/Dockerfile.practice-deps`: shared practice dependency base image.
- `docker/backend/Dockerfile.worker-deps`: shared worker dependency base image.
- `docker/backend/Dockerfile.worker`: Celery worker and model-cache-agent runtime image.
- `docker/backend/Dockerfile.quality`: local core backend quality-check image.
- `docker/backend/Dockerfile.practice-quality`: local practice quality-check
  image for realtime alignment tests.
- `docker/backend/entrypoint.sh`: service command switch.
- `docker-compose.backend-dev.yml`: API, practice, worker, beat, and quality services.
- `backend/.env.docker.example`: Docker-specific backend environment template.
- `.dockerignore`: prevents caches, data, models, and local external checkouts
  from being copied into images.

## Prepare Environment

`backend/.env.docker` is required. Docker Compose fails before starting services
when this file is missing.

Copy the Docker env template:

```powershell
Copy-Item backend/.env.docker.example backend/.env.docker
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

Keep the local file synchronized with the committed example when changing the
local contract. The example is checked against the application settings schema
in CI, so it cannot silently accumulate obsolete variables. The sole current
exception is `CELERY_WORKER_CONCURRENCY`: it is consumed by the Worker
entrypoint rather than Pydantic settings. It is a known transitional exception
until role-specific Compose environment projections replace the current shared
runtime manifest.

Task reliability values belong in this local file because Docker Compose must
pass the same values to API, Worker, and Beat while developing. They are not a
production source of truth. Production reliability policy must be reviewed and
versioned with its deployment configuration (for example the non-secret
`backend-config.env` consumed by a Kubernetes ConfigMap), tuned against
throughput and SLO evidence, and released with the affected workloads. Keep
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

The required Hugging Face cache directories are determined by
`HF_MODEL_REPOSITORIES`. The current production/staging configuration requires
both `guangyangmusic/legato` and `meta-llama/Llama-3.2-11B-Vision` because
Legato loads the Llama vision encoder at runtime. The Llama repository is gated;
the Hugging Face account behind `HF_TOKEN` must accept its license.

For Hugging Face cache directories, preserve symlinks when copying. If a Windows
copy tool breaks snapshots, copy the cache as a tar archive and extract it into
`models\huggingface`.

## Runtime Directories

The local Docker profile uses explicit runtime directories:

```text
backend/data/storage   durable local file storage when FILE_STORAGE_BACKEND=local
backend/data/work      worker scratch space, storage cache, and Celery beat state
models                 mounted read-only model assets
```

Inside the containers these paths are:

```text
/app/data/storage
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

Build the ML base image first. It provides Python 3.12 and the PyTorch 2.6.0
CUDA wheel for LEGATO. CUDA libraries come from the PyTorch wheel stack; the GPU
driver is provided by the host through the NVIDIA container runtime.

```powershell
docker build `
  -f docker/backend/Dockerfile.ml-base `
  -t noteverse-ml-base:py312-torch260-cu124-slim `
  .
```

The ML base image intentionally does not install conda, torchvision, torchaudio,
PaddleOCR, LEGATO, or project code. Keep it as the narrow Python/PyTorch base
contract.

Then build the worker dependency image:

```powershell
docker build `
  -f docker/backend/Dockerfile.worker-deps `
  --build-arg PYTHON_IMAGE=noteverse-ml-base:py312-torch260-cu124-slim `
  --build-arg INSTALL_PADDLE_GPU=false `
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false `
  --build-arg LEGATO_REPO_URL=https://github.com/guang-yng/legato.git `
  --build-arg LEGATO_REPO_COMMIT=179c228d3d5f67113cf739b44891b3abe046f1dc `
  -t noteverse-backend-worker-deps:dev `
  .
```

Then build the runtime images:

```powershell
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml build practice
docker compose -f docker-compose.backend-dev.yml build worker
docker compose -f docker-compose.backend-dev.yml build beat
```

If Docker cannot reach Docker Hub while resolving the base image, pre-pull the
Python image and retry:

```powershell
docker pull python:3.12-slim-bookworm
docker build -f docker/backend/Dockerfile.ml-base -t noteverse-ml-base:py312-torch260-cu124-slim .
docker build -f docker/backend/Dockerfile.worker-deps --build-arg PYTHON_IMAGE=noteverse-ml-base:py312-torch260-cu124-slim -t noteverse-backend-worker-deps:dev .
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml build worker
```

The worker dependency image can also be overridden for local mirrors or
preloaded images:

```powershell
$env:WORKER_DEPS_IMAGE="noteverse-backend-worker-deps:dev"
docker compose -f docker-compose.backend-dev.yml build worker
```

An error such as `Head "https://registry-1.docker.io/...": EOF` happens before
the project Dockerfile starts installing dependencies. Treat it as a Docker
Desktop registry/proxy/network issue.

The worker Dockerfile does not install PyTorch, PaddleOCR, Transformers, or
LEGATO dependencies manually; the selected worker dependency image is the source
of truth for those runtime dependencies. This moves the largest filesystem
layers into reusable base images instead of asking Docker Desktop to recreate
them for every worker build.

CI worker dependency builds pull the selected ML base image before building:

```text
ghcr.io/<github-owner>/noteverse/ml-base:<ml-base-tag>
```

If this pull fails, run the `ML Base Image` workflow with the intended
Python/PyTorch CUDA inputs and rerun the worker workflow. Do not point
`Dockerfile.worker` at an ad hoc local image just to make CI pass; the published
worker dependency image is the contract between final worker builds and
deployment.

The worker image workflow is intentionally manual. A full CUDA/PyTorch worker
build can exceed GitHub-hosted runner disk space. If the GitHub Actions log
contains `no space left on device` under `/var/lib/buildkit` while unpacking
CUDA libraries, move the build to a self-hosted or larger runner instead of
making worker builds run on every push.

The API image installs API dependencies from `backend/requirements/api.txt`. It
does not contain LEGATO source, PyTorch, PaddleOCR, practice realtime alignment,
or model-cache tooling. Fingering generation remains an API capability for now.

The practice image installs practice dependencies from
`backend/requirements/practice.txt`. It owns realtime practice HTTP/WebSocket
runtime dependencies such as `pymatchmaker`.

The beat image installs scheduler dependencies from `backend/requirements/beat.txt`.
It does not import worker task implementations; scheduled task names are sent to
Celery by name and executed by worker pods.

The worker dependency image installs worker dependencies from
`backend/requirements/worker.txt`:

- PyTorch 2.6.0 for LEGATO inference, provided by `ml-base`.
- PaddlePaddle CPU 3.2.0 for PaddleOCR.
- PaddleOCR. Its subprocess is capped by `PADDLEOCR_TIMEOUT_SECONDS`, while
  `MAX_PROCESSING_TIME` controls the complete Celery pipeline deadline.
  `CELERY_TASK_SOFT_TIME_LIMIT` provides a graceful shutdown window before
  `CELERY_TASK_TIME_LIMIT` forcibly terminates a stuck worker process.
- Transformers 4.54.0.
- Accelerate and LEGATO inference helpers.
The final worker image does not install backend test or quality tools by default.
Core quality checks use `docker/backend/Dockerfile.quality`. Practice runtime
and practice quality checks both inherit from
`docker/backend/Dockerfile.practice-deps` because `pymatchmaker` is a Cython
extension and should not be duplicated in every practice image.
The practice dependency base uses
`backend/requirements/practice-runtime-constraints.txt` to keep the heavy
matchmaker/audio-science dependency graph reproducible.

CI publishes the practice dependency base as:

```text
ghcr.io/<github-owner>/noteverse/backend-practice-deps:deps-<dependency-hash>
```

The hash is computed from:

- `docker/backend/Dockerfile.practice-deps`;
- `backend/requirements/practice-app.txt`;
- `backend/requirements/practice-runtime.txt`;
- `backend/requirements/practice-runtime-constraints.txt`.

Normal application image builds pull this image instead of rebuilding native
practice dependencies. If the image is missing, publish the matching dependency
base first instead of silently rebuilding it in the application release path.

Installation order is intentional:

1. Core backend dependencies are installed first, excluding `paddleocr`.
2. Python 3.12 and PyTorch CUDA wheels come from the selected ML base image.
3. PaddlePaddle CPU is installed for PaddleOCR.
4. `paddleocr` is installed after PaddlePaddle so it reuses the selected Paddle
   runtime.

Worker builds contain only runtime dependencies:

```powershell
docker compose -f docker-compose.backend-dev.yml build worker
```

Use the quality image for backend checks:

```powershell
.\scripts\backend_quality_docker.ps1 -Check all
```

This command runs compile, ruff, mypy, model-layer mypy, core pytest, and
practice pytest. Worker-related tests are included in core pytest unless they
require the full production ML runtime.
The script builds `practice-deps` before running practice tests.

The worker dependency Dockerfile keeps only runtime system packages:

- `fluidsynth`, `fluid-soundfont-gm`, `libfluidsynth3`, `libsndfile1`: required by practice audio synthesis.
- `ffmpeg`, `libgl1`, `libglib2.0-0`, `libgomp1`: required by image/audio/ML packages such as OpenCV, PaddleOCR, and audio processing libraries.
- `tini`: provides correct signal handling for API, worker, and beat processes.

LEGATO's upstream repository documents PyTorch 2.6.0 and notes CUDA 12.4 testing.
The default base image therefore uses Python 3.12 and PyTorch 2.6.0 `cu124`
wheels without conda, torchvision, torchaudio, or a CUDA base image.
PaddleOCR intentionally uses CPU PaddlePaddle by default because PyTorch CUDA
runtimes and PaddlePaddle GPU runtimes can require incompatible exact NVIDIA
runtime packages in a single Python environment. This avoids an unstable
dependency graph while keeping the expensive LEGATO inference path on GPU.

PaddlePaddle GPU can be tested explicitly, but it is not the supported default
for the worker image:

```powershell
$env:INSTALL_PADDLE_GPU="true"
$env:PADDLE_CUDA_INDEX="cu126"
docker compose -f docker-compose.backend-dev.yml build worker
```

Use this only when you have verified that the selected PyTorch and PaddlePaddle
wheel sets do not conflict on CUDA runtime packages such as `nvidia-nccl-cu12`.

Optional LEGATO training/evaluation dependencies such as `deepspeed`, `datasets`,
and `wandb` are not installed by default because the application only runs
inference. To include them:

```powershell
$env:INSTALL_LEGATO_EXTRA_DEPS="true"
docker compose -f docker-compose.backend-dev.yml build worker
```

The ML base build is large and depends on network access. Build it once, then
reuse the base image for normal worker development. Use the API image when you
want to validate non-OMR/non-OCR backend code paths.

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

- `api`: async database, Redis, storage configuration, SoundFont, and practice runtime.
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
- `backend/data` is bind mounted to preserve local storage and work cache across container restarts.
- Use the role-aware `scripts/check_runtime.py` as the first diagnostic command after changing image, env, or model mounts.
