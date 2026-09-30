# Runtime Dependency Ownership

This document defines dependency ownership for NoteVerse backend runtimes. It is
an architecture contract, not a compatibility note. Runtime images should stay
small, explicit, auditable, and aligned with the workloads that still exist.

NoteVerse currently uses a browser-local practice architecture. The backend no
longer runs a separate realtime practice execution service. Backend practice
responsibilities are part of the API surface and are limited to immutable score
source delivery:

- exact revision MusicXML;
- `PracticeScoreArtifact` generation and retrieval;
- source identity validation for Review, saving, and historical share video.

## Runtime Images

| Runtime | Image | Workload | Purpose |
| --- | --- | --- | --- |
| API | `backend-api` | Deployment | HTTP API, auth, scores, practice source bundle endpoints, review, share/public, billing, ops, realtime SSE, bounded interactive fingering |
| Worker | `backend-worker` | Deployment | Import, OMR, render, playback, mail, cleanup, async operation processing |
| Beat | `backend-beat` | Deployment | Singleton Celery schedule publisher |
| Worker Deps | `backend-worker-deps` | image base only | Shared worker dependency base with OCR/OMR/runtime ML dependencies |
| Quality | `backend-quality` | CI/local only | Compile, ruff, mypy, model-layer mypy, API/worker contract tests, and backend pytest |

The repository stays a modular monolith. Runtime isolation is achieved through
requirements composition, Dockerfiles, and deployment boundaries, not by keeping
unused runtime images around.

## Rules

1. Runtime images install only runtime dependencies.
2. Quality tools such as ruff, mypy, pytest, and pre-commit belong only in
   quality images.
3. API must not install OCR, Legato, Paddle, worker-only ML dependencies, or old
   realtime practice alignment packages.
4. Worker must not install FastAPI just to process Celery tasks. If worker code
   needs shared helpers, move those helpers to runtime-neutral modules.
5. Beat publishes schedule entries and scans durable outbox state. It must not
   install API, worker, OCR, ML, or quality dependencies.
6. Runtime checks must reflect the active runtime path. Do not keep checks for
   libraries or services that are no longer used by that runtime.
7. New dependencies must be added to the narrowest capability file first, then
   composed into the runtime files that truly need them.

## Requirement Layers

### Capability Files

Capability files express a reusable runtime capability. They are small on
purpose.

| File | Owner | Purpose |
| --- | --- | --- |
| `core.txt` | all backend runtimes | settings and shared logging |
| `db.txt` | API, worker, quality | SQLModel, SQLAlchemy, PostgreSQL drivers |
| `migrations.txt` | API, quality | Alembic migrations |
| `storage.txt` | API, worker, quality | object storage client |
| `cache.txt` | selected shared runtime checks | Redis client |
| `celery.txt` | API, worker, beat, quality | Celery dispatch and broker integration |
| `http.txt` | API, quality | FastAPI, Uvicorn, metrics, tracing |
| `auth.txt` | API, quality | JWT, password hashing, session helpers |
| `image.txt` | API, worker, quality | Pillow image inspection and processing |
| `fingering.txt` | API | bounded interactive fingering generation |
| `practice-score.txt` | API, quality | MusicXML timeline parsing for practice source/artifact generation |
| `render.txt` | worker, quality | Verovio score rendering |
| `ocr.txt` | worker | PaddleOCR package only; PaddlePaddle is installed by the worker Dockerfile |
| `quality-tools.txt` | quality image only | ruff, mypy, pytest, httpx, pre-commit |

### Runtime Composition Files

Runtime composition files express deployable or checkable execution units.

| File | Installed by | Includes |
| --- | --- | --- |
| `api.txt` | `Dockerfile.api` | HTTP, DB, migrations, storage, Celery, auth, image, fingering, practice source generation |
| `worker-app.txt` | `Dockerfile.worker-deps` | DB, storage, Celery, image, render |
| `worker.txt` | aggregate worker runtime reference | worker app plus OCR package |
| `beat.txt` | `Dockerfile.beat` | Celery only |
| `quality-core.txt` | `Dockerfile.quality` | API, beat, shared worker-contract dependencies, render, quality tools |

There is no backend practice runtime composition file. Browser local practice
uses frontend dependencies and exact backend source/artifact endpoints.

## Runtime Boundaries

### API

Allowed:

- FastAPI, metrics, tracing;
- database, storage, auth, migrations;
- practice source bundle endpoints for exact MusicXML and artifacts;
- Celery client for submitting work;
- image processing for avatars and lightweight API-side inspection;
- bounded interactive fingering generation. The blocking engine runs outside
  the event loop behind a process-local concurrency gate; it returns an
  unsaved editor suggestion and never creates revisions or derived assets.

Forbidden:

- PaddleOCR, PaddlePaddle, Legato, Transformers, torch;
- old realtime practice alignment packages and server-side practice runtime
  dependencies;
- quality tools.

If a future API endpoint needs heavy rendering, OCR, model inference, or
long-running audio processing, it should submit work to the worker or a
dedicated service instead of expanding the API image.

### Worker

Allowed:

- Celery worker runtime;
- sync database access;
- object storage and durable file materialization;
- Pillow, Verovio, FluidSynth, soundfont access;
- PaddlePaddle and PaddleOCR;
- Legato code and model access;
- cleanup and async operation processors.

Forbidden:

- FastAPI serving dependencies unless a real worker health/metrics HTTP
  endpoint is introduced by design;
- old realtime practice alignment packages;
- quality tools.

PaddlePaddle must be installed before PaddleOCR so CPU/GPU wheel selection is
controlled by the Dockerfile and not by transitive dependency resolution.

### Beat

Allowed:

- Celery schedule publisher;
- minimal shared config and logging.

Forbidden:

- API, worker, OCR, render, playback, or quality dependencies.

Beat state is the database/outbox model. Do not add a beat PVC for a local
Celery schedule file unless the scheduler design changes and an ADR explains
the tradeoff.

### Quality Image

Generic quality checks use `Dockerfile.quality` and `quality-core.txt`.
Worker-related contract tests currently belong to the core quality suite. Add a
separate `worker-quality` image only when tests need the full production
ML/OCR/model runtime, not merely because a test mentions Celery or outbox
behavior.

## Adding A Dependency

Use this checklist:

1. Identify which runtime actually imports or executes the dependency.
2. Add it to the narrowest capability file.
3. Compose that capability into the needed runtime file only.
4. Keep quality tools in `quality-tools.txt`.
5. If the package has C/Cython/GPU/native build requirements, consider whether
   it needs a dedicated runtime image or prebuilt wheelhouse.
6. Run the relevant Docker quality check:

```powershell
.\scripts\backend_quality_docker.ps1 -Check all
```

## Known Future Improvements

- Keep fingering in the API while its bounded execution metrics remain within
  the interactive latency budget. Move it to a dedicated CPU worker capability
  only when sustained queue rejections, p95 latency, batch generation, or
  heavier models make asynchronous work necessary. Do not introduce a separate
  HTTP microservice merely to isolate this CPU-bound capability.
- Add a `worker-quality` image only when tests must load real Paddle/Legato
  models or execute production-level worker smoke tests.
