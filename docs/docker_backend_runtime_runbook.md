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
See `docs/external_dependencies.md` for the pinned commit and update process.

## Files

- `docker/backend/Dockerfile.runtime`: backend runtime image.
- `docker/backend/entrypoint.sh`: service command switch.
- `docker-compose.backend-dev.yml`: API, worker, and beat only.
- `backend/.env.docker.example`: Docker-specific backend environment template.
- `.dockerignore`: prevents caches, data, models, and external repos from being copied into the image.

## Prepare Environment

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

## Prepare Model Volume

The compose file mounts a host model directory to:

```text
/opt/noteverse/models
```

When running Docker Compose from Windows PowerShell, set a Windows-accessible
host path:

```powershell
$env:NOTEVERSE_MODEL_ROOT="C:\noteverse\models"
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
New-Item -ItemType Directory -Force C:\noteverse\models\soundfonts
New-Item -ItemType Directory -Force C:\noteverse\models\paddleocr\official_models
New-Item -ItemType Directory -Force C:\noteverse\models\huggingface\hub
```

Copy model assets into this layout:

```text
FluidR3_GM.sf2
  -> C:\noteverse\models\soundfonts\FluidR3_GM.sf2

PP-OCRv6_medium_det
  -> C:\noteverse\models\paddleocr\official_models\PP-OCRv6_medium_det

PP-OCRv6_medium_rec
  -> C:\noteverse\models\paddleocr\official_models\PP-OCRv6_medium_rec

PP-LCNet_x1_0_textline_ori
  -> C:\noteverse\models\paddleocr\official_models\PP-LCNet_x1_0_textline_ori

models--guangyangmusic--legato
  -> C:\noteverse\models\huggingface\hub\models--guangyangmusic--legato

models--meta-llama--Llama-3.2-11B-Vision
  -> C:\noteverse\models\huggingface\hub\models--meta-llama--Llama-3.2-11B-Vision
```

For Hugging Face cache directories, preserve symlinks when copying. If a Windows
copy tool breaks snapshots, copy the cache as a tar archive and extract it into
`C:\noteverse\models\huggingface`.

## Build Runtime Image

Runtime image with PyTorch, PaddlePaddle GPU, PaddleOCR, and LEGATO inference
dependencies:

```powershell
docker compose -f docker-compose.backend-dev.yml build
```

The default build installs the runtime dependencies used by the application:

- PyTorch 2.6.0 for LEGATO inference.
- PaddlePaddle GPU 3.2.0 for PaddleOCR.
- PaddleOCR.
- Transformers 4.54.0.
- Accelerate and LEGATO inference helpers.

Installation order is intentional:

1. Core backend dependencies are installed first, excluding `pymatchmaker` and
   `paddleocr`.
2. `pymatchmaker` is built separately with conservative C compiler flags. It
   contains Cython extensions and can fail with GCC internal compiler errors
   under aggressive optimization.
3. PyTorch and `paddlepaddle-gpu` are installed.
4. `paddleocr` is installed after `paddlepaddle-gpu` so it does not pull or
   prefer a CPU Paddle runtime.

The Dockerfile also keeps a small set of system build/runtime packages:

- `git`: required while installing pinned Git dependencies such as `pymatchmaker`.
- `build-essential`, `ninja-build`, `pkg-config`, `*-dev`: required for Python packages with C/Cython/native extensions.
- `fluidsynth`, `fluid-soundfont-gm`, `libfluidsynth-dev`, `libsndfile1`: required by practice audio synthesis.
- `ffmpeg`, `libgl1`, `libglib2.0-0`, `libgomp1`: required by image/audio/ML packages such as OpenCV, PaddleOCR, and audio processing libraries.
- `tini`: provides correct signal handling for API, worker, and beat processes.

LEGATO's upstream repository documents PyTorch 2.6.0 and notes CUDA 12.4 testing.
This Dockerfile keeps the PyTorch version aligned with LEGATO and defaults both
PyTorch and PaddlePaddle to the `cu126` wheel family. PaddlePaddle's official
installation guide documents `paddlepaddle-gpu==3.2.0` for `cu126` when the
NVIDIA driver is at least `550.54.14`. PyTorch also provides `torch==2.6.0` for
`cu126`.

If the host driver is too old for CUDA 12.6 wheels, build a compatibility image
with CUDA 11.8 wheels:

```powershell
$env:TORCH_CUDA_INDEX="cu118"
$env:PADDLE_CUDA_INDEX="cu118"
docker compose -f docker-compose.backend-dev.yml build
```

Use the CUDA 11.8 fallback only when the driver cannot support CUDA 12.x wheels.

Optional LEGATO training/evaluation dependencies such as `deepspeed`, `datasets`,
and `wandb` are not installed by default because the application only runs
inference. To include them:

```powershell
$env:INSTALL_LEGATO_EXTRA_DEPS="true"
docker compose -f docker-compose.backend-dev.yml build
```

Lightweight image without GPU/ML runtime packages:

```powershell
$env:INSTALL_GPU_DEPS="false"
docker compose -f docker-compose.backend-dev.yml build
```

The default build is large and depends on network access. Build it once, then
reuse the image for normal development. Use the lightweight build only when you
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
cd frontend
npm run dev
```

## Run Checks

Check runtime dependencies inside the container:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api check
```

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

- NVIDIA Windows driver with Docker GPU support. The default `cu126` build expects a driver compatible with CUDA 12.6 wheels.
- Docker Desktop Linux containers.
- GPU support enabled for Docker Desktop.

Verify inside the container:

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
- Use `scripts/check_runtime.py` as the first diagnostic command after changing image, env, or model mounts.
