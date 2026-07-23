# Runtime Dependency Ownership

This document defines dependency ownership for NoteVerse backend runtimes. It is
an architecture contract, not a temporary packaging note. The goal is to keep
runtime images small, explicit, auditable, and aligned with Kubernetes workload
boundaries.

NoteVerse uses one backend codebase with multiple runtime deployments:

| Runtime | Image | Kubernetes workload | Purpose |
| --- | --- | --- | --- |
| API | `backend-api` | Deployment | HTTP API, auth, scores, review, share/public, billing, ops, realtime SSE, fingering |
| Practice | `backend-practice` | Deployment | Realtime practice HTTP/WebSocket and browser-audio alignment |
| Worker | `backend-worker` | Deployment | Import, OMR, render, playback, mail, cleanup, async operation processing |
| Beat | `backend-beat` | Deployment | Singleton Celery schedule publisher |
| Practice Deps | `backend-practice-deps` | image base only | Shared practice dependency base with native matchmaker wheel |
| Quality | `backend-quality` | CI/local only | Compile, ruff, mypy, model-layer mypy, and core pytest |
| Practice Quality | `backend-practice-quality` | CI/local only | Practice realtime tests that require the matchmaker runtime |

The repository stays a modular monolith. Runtime isolation is achieved through
requirements composition, Dockerfiles, and Kubernetes workloads instead of
splitting the backend into separate repositories.

## Rules

1. Runtime images install only runtime dependencies.
2. Quality tools such as ruff, mypy, pytest, and pre-commit belong only in
   quality images.
3. API must not install OCR, Legato, Paddle, practice alignment, or worker-only
   ML dependencies.
4. Worker must not install FastAPI just to process Celery tasks. If worker code
   needs shared helpers, move those helpers to runtime-neutral modules.
5. Practice owns realtime alignment dependencies. Do not add practice Cython or
   audio alignment packages to API or generic quality images.
6. Beat publishes schedule entries and scans durable outbox state. It must not
   install API, worker, practice, OCR, or ML dependencies.
7. Runtime checks must reflect the active runtime path. Do not keep checks for
   libraries that are no longer used by that runtime.
8. New dependencies must be added to the narrowest capability file first, then
   composed into the runtime files that truly need them.

## Requirement Layers

Requirements are split into two layers:

### Capability Files

Capability files express a reusable runtime capability. They are small on
purpose.

| File | Owner | Purpose |
| --- | --- | --- |
| `core.txt` | all backend runtimes | settings and shared logging |
| `db.txt` | API, practice, worker, quality | SQLModel, SQLAlchemy, PostgreSQL drivers |
| `migrations.txt` | API, quality | Alembic migrations |
| `storage.txt` | API, practice, worker, quality | object storage client |
| `cache.txt` | practice and selected shared runtime checks | Redis client |
| `celery.txt` | API, worker, beat, quality | Celery dispatch and broker integration |
| `http.txt` | API, practice, quality | FastAPI, Uvicorn, metrics, tracing |
| `auth.txt` | API, practice, quality | JWT, password hashing, session helpers |
| `image.txt` | API, worker, quality | Pillow image inspection and processing |
| `fingering.txt` | API | fingering generation, kept in API for now |
| `render.txt` | worker, quality | Verovio score rendering |
| `ocr.txt` | worker | PaddleOCR package only; PaddlePaddle is installed by the worker Dockerfile |
| `practice-runtime.txt` | practice, practice quality | matchmaker and realtime alignment dependencies |
| `practice-runtime-constraints.txt` | practice dependency base | locked transitive dependencies for the matchmaker/audio-science runtime |
| `quality-tools.txt` | quality images only | ruff, mypy, pytest, httpx, pre-commit |

### Runtime Composition Files

Runtime composition files express deployable or checkable execution units.

| File | Installed by | Includes |
| --- | --- | --- |
| `api.txt` | `Dockerfile.api` | HTTP, DB, migrations, storage, Celery, auth, image, fingering |
| `practice-app.txt` | `Dockerfile.practice-deps` | HTTP, DB, storage, cache, auth |
| `practice.txt` | aggregate reference | practice app plus practice runtime |
| `worker-app.txt` | `Dockerfile.worker` | DB, storage, Celery, image, render |
| `worker.txt` | aggregate reference | worker app plus OCR package |
| `beat.txt` | `Dockerfile.beat` | Celery only |
| `quality-core.txt` | `Dockerfile.quality` | API, beat, shared worker-contract dependencies, render, quality tools |
| `quality-practice.txt` | aggregate reference | practice app plus quality tools |
| `quality.txt` | aggregate reference | quality core plus practice quality |
| `base.txt` | compatibility aggregate | shared backend infrastructure baseline |

`base.txt`, `practice.txt`, `worker.txt`, and `quality.txt` are aggregate
references. New Dockerfiles should prefer explicit runtime composition files.

`practice-runtime-constraints.txt` is intentionally not a full backend lock
file. It exists because `pymatchmaker` pulls a large scientific/audio dependency
graph (`librosa`, `partitura`, `parangonar`, `numba`, `scipy`, and friends).
Keep this file scoped to that graph so API, worker, and generic quality
dependencies remain independently owned.

## Runtime Boundaries

### API

Allowed:

- FastAPI, metrics, tracing;
- database, storage, auth, migrations;
- Celery client for submitting work;
- image processing for avatars and lightweight API-side inspection;
- fingering generation while it remains a synchronous API capability.

Forbidden:

- PaddleOCR, PaddlePaddle, Legato, Transformers, torch;
- practice alignment packages such as `pymatchmaker`;
- quality tools.

If a future API endpoint needs heavy rendering, OCR, model inference, or
long-running audio processing, it should submit work to the worker or a
dedicated service instead of expanding the API image.

### Practice

Allowed:

- FastAPI/WebSocket serving for practice routes;
- database, storage, Redis/cache, auth;
- realtime alignment and browser-audio practice runtime dependencies;
- system audio packages needed by practice runtime.

Forbidden:

- OCR and Legato model inference dependencies;
- worker outbox processors;
- generic quality tools.

Practice is split from API because WebSocket lifetime, realtime alignment
runtime, and Cython-heavy dependencies have different scaling and failure
profiles from the normal SaaS API.

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
- practice realtime matchmaker dependencies;
- quality tools.

PaddlePaddle must be installed before PaddleOCR so CPU/GPU wheel selection is
controlled by the Dockerfile and not by transitive dependency resolution.

### Beat

Allowed:

- Celery schedule publisher;
- minimal shared config and logging.

Forbidden:

- API, worker, practice, OCR, render, playback, or quality dependencies.

Beat state is the database/outbox model. Do not add a beat PVC for a local
Celery schedule file unless the scheduler design changes and an ADR explains
the tradeoff.

### Quality Images

Generic quality checks use `Dockerfile.quality` and `quality-core.txt`.
Practice runtime and practice quality images share
`Dockerfile.practice-deps`. Practice realtime tests use
`Dockerfile.practice-quality`, which installs quality tools on top of that
dependency base.

This separation is intentional:

- core lint/type/test checks should not compile `pymatchmaker`;
- practice tests can still exercise the realtime alignment runtime;
- `backend-practice` and `backend-practice-quality` use the same native
  dependency layer;
- runtime images remain free of test/static-analysis tools.

The deployed practice dependency base is tagged by dependency hash:

```text
backend-practice-deps:deps-<dependency-hash>
```

Application-only changes must reuse the existing dependency base. Changes to
`Dockerfile.practice-deps`, `practice-app.txt`, `practice-runtime.txt`, or
`practice-runtime-constraints.txt` create a new dependency hash and require a
new base image.

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
6. For practice runtime changes, update `practice-runtime-constraints.txt` from
   a successful `backend-practice-deps` build and review that only
   practice/alignment transitive packages changed.
7. Run the relevant Docker quality check:

```powershell
.\scripts\backend_quality_docker.ps1 -Check all
```

For practice-only dependency changes, also watch the `practice-deps` image build
time and confirm the matching `backend-practice-deps:deps-<dependency-hash>`
image is published before application release images are built.

## Known Future Improvements

- Re-evaluate `fingering.txt` after score fingering becomes async. At that
  point, move fingering generation from API to worker or a dedicated capability.
- Add a `worker-quality` image only when tests must load real Paddle/Legato
  models or execute production-level worker smoke tests.
