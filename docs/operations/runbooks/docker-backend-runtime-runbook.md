# Docker Backend Runtime Runbook

This is the only supported local backend runtime workflow going forward. Redis
and the database remain installed on the Windows host. Docker runs only the
backend API, Celery worker, and Celery beat.

## Architecture

```text
Windows workspace
  backend source code    -> bind mounted to /app
  external/legato        -> bind mounted to /external/legato:ro
  model directory        -> bind mounted to /opt/noteverse/models:ro
  Windows Redis          -> reached through host.docker.internal
  Windows database       -> reached through host.docker.internal

Docker services
  api                    -> uvicorn app.main:app --reload
  worker                 -> celery worker
  beat                   -> celery beat
```

This keeps code iteration fast while making the backend runtime Linux-like.

LEGATO is a pinned external source dependency, not backend application code.
See `docs/architecture/integrations/external-dependencies.md` for the pinned commit and update process.

## Files

- `docker/backend/Dockerfile.ml-base`: Python 3.12 + CUDA 12.4 + PyTorch 2.6 base image.
- `docker/backend/Dockerfile.runtime`: backend runtime image.
- `docker/backend/entrypoint.sh`: service command switch.
- `docker-compose.backend-dev.yml`: API, worker, and beat only.
- `backend/.env.docker.example`: Docker-specific backend environment template.
- `.dockerignore`: prevents caches, data, models, and external repos from being copied into the image.

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

For Hugging Face cache directories, preserve symlinks when copying. If a Windows
copy tool breaks snapshots, copy the cache as a tar archive and extract it into
`models\huggingface`.

## Runtime Directories

The local Docker profile uses explicit runtime directories:

```text
backend/data/storage   durable local file storage when FILE_STORAGE_BACKEND=local
backend/data/work      worker scratch space, storage cache, and Celery beat state
models                 mounted read-only model assets
external/legato        mounted read-only LEGATO source dependency
```

Inside the containers these paths are:

```text
/app/data/storage
/app/data/work
/opt/noteverse/models
/external/legato
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

Build the ML base image first. It provides Python 3.12, CUDA 12.4, and PyTorch
2.6.0 for LEGATO:

```powershell
docker build -f docker/backend/Dockerfile.ml-base -t noteverse-ml-base:py312-torch260-cu124 .
```

The ML base image installs Python through Miniforge/conda-forge, not Anaconda
defaults. This keeps the Docker build non-interactive and avoids Anaconda
channel Terms-of-Service prompts during CI or local image builds.

Then build the backend runtime image:

```powershell
docker compose -f docker-compose.backend-dev.yml build api
```

If Docker cannot reach Docker Hub while resolving the base image, pre-pull the
NVIDIA CUDA image and retry:

```powershell
docker pull nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
docker build -f docker/backend/Dockerfile.ml-base -t noteverse-ml-base:py312-torch260-cu124 .
docker compose -f docker-compose.backend-dev.yml build api
```

The runtime base image can also be overridden for local mirrors or preloaded
images:

```powershell
$env:PYTHON_IMAGE="noteverse-ml-base:py312-torch260-cu124"
docker compose -f docker-compose.backend-dev.yml build api
```

An error such as `Head "https://registry-1.docker.io/...": EOF` happens before
the project Dockerfile starts installing dependencies. Treat it as a Docker
Desktop registry/proxy/network issue.

The runtime Dockerfile does not install PyTorch manually; the selected base image
is the source of truth for Python, PyTorch, and CUDA. This moves the largest
PyTorch/CUDA filesystem layer into a reusable base image instead of asking
Docker Desktop to recreate it for every backend runtime build.

The default dev build installs the runtime dependencies used by the application:

- PyTorch 2.6.0 for LEGATO inference.
- PaddlePaddle CPU 3.2.0 for PaddleOCR.
- PaddleOCR. Its subprocess is capped by `PADDLEOCR_TIMEOUT_SECONDS`, while
  `MAX_PROCESSING_TIME` controls the complete Celery pipeline deadline.
  `CELERY_TASK_SOFT_TIME_LIMIT` provides a graceful shutdown window before
  `CELERY_TASK_TIME_LIMIT` forcibly terminates a stuck worker process.
- Transformers 4.54.0.
- Accelerate and LEGATO inference helpers.
- Backend test and quality tools from `backend/requirements-dev.txt`.

Installation order is intentional:

1. Core backend dependencies are installed first, excluding `pymatchmaker` and
   `paddleocr`.
2. `pymatchmaker` is built in a dedicated wheel stage with conservative C
   compiler flags. The final runtime stage installs the wheel and does not keep
   build tools such as `build-essential` or `git`.
3. Python 3.12, PyTorch, and CUDA come from the selected ML base image.
4. PaddlePaddle CPU is installed for PaddleOCR.
5. `paddleocr` is installed after PaddlePaddle so it reuses the selected Paddle
   runtime.

Production-style builds can omit development tools:

```powershell
$env:INSTALL_DEV_DEPS="false"
docker compose -f docker-compose.backend-dev.yml build api
```

The runtime Dockerfile keeps only runtime system packages:

- `fluidsynth`, `fluid-soundfont-gm`, `libfluidsynth3`, `libsndfile1`: required by practice audio synthesis.
- `ffmpeg`, `libgl1`, `libglib2.0-0`, `libgomp1`: required by image/audio/ML packages such as OpenCV, PaddleOCR, and audio processing libraries.
- `tini`: provides correct signal handling for API, worker, and beat processes.

LEGATO's upstream repository documents PyTorch 2.6.0 and notes CUDA 12.4 testing.
The default base image therefore uses `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`,
Miniforge Python 3.12, and PyTorch 2.6.0 `cu124` wheels.
PaddleOCR intentionally uses CPU PaddlePaddle by default because PyTorch CUDA
runtimes and PaddlePaddle GPU runtimes can require incompatible exact NVIDIA
runtime packages in a single Python environment. This avoids an unstable
dependency graph while keeping the expensive LEGATO inference path on GPU.

PaddlePaddle GPU can be tested explicitly, but it is not the supported default
for the combined backend image:

```powershell
$env:INSTALL_PADDLE_GPU="true"
$env:PADDLE_CUDA_INDEX="cu126"
docker compose -f docker-compose.backend-dev.yml build api
```

Use this only when you have verified that the selected PyTorch and PaddlePaddle
wheel sets do not conflict on CUDA runtime packages such as `nvidia-nccl-cu12`.

Optional LEGATO training/evaluation dependencies such as `deepspeed`, `datasets`,
and `wandb` are not installed by default because the application only runs
inference. To include them:

```powershell
$env:INSTALL_LEGATO_EXTRA_DEPS="true"
docker compose -f docker-compose.backend-dev.yml build api
```

Lightweight image without GPU/ML runtime packages:

```powershell
$env:PYTHON_IMAGE="python:3.12-slim-trixie"
$env:INSTALL_GPU_DEPS="false"
docker compose -f docker-compose.backend-dev.yml build api
```

The ML base build is large and depends on network access. Build it once, then
reuse the base image for normal development. Use the lightweight build only when
you want to validate non-OMR/non-OCR backend code paths.

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
cd frontend
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

The backend compose profile requests GPU access for `api` and `worker` with
`gpus: all`. If Docker cannot provide a GPU, those services should fail early
instead of silently falling back to CPU.

Verify inside the container:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no cuda')"
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
