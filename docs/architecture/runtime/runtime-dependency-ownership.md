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
| API | `backend-api` | Deployment | Customer API, control plane, observability exporter, and migration entrypoints; customer HTTP includes auth, scores, practice source bundles, review/share, billing, SSE, and bounded interactive fingering |
| Worker | `backend-worker` | Deployment | Import, OMR, render, playback, mail, cleanup, async operation processing |
| Beat | `backend-beat` | Deployment | Singleton Celery schedule publisher with PostgreSQL advisory-lock capability |
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
| `beat.txt` | `Dockerfile.beat` | Celery/Redis, shared configuration, and psycopg for PostgreSQL advisory locking |
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

- Celery schedule publisher and Redis broker client;
- psycopg PostgreSQL advisory-lock capability;
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

## Image CI Trust and Packaging Contracts

API and Beat PR validation jobs have only `contents: read`, build locally without
registry authentication, then check the final artifact, generate an SBOM, and run
the existing `os,library / CRITICAL / ignore-unfixed=true / exit-code=1` Trivy gate.
Separate publication jobs receive `packages: write` only for main pushes or
explicit manual execution on main. The small local API/Beat composite action
shares build/check mechanics; credentials and permissions stay in the caller.

Worker PR validation is automatic for Worker-relevant paths and has only
`contents: read` / `packages: read`. The job token resolves the existing private
ML Base to an OCI digest; missing images/read access fail closed. It never
rebuilds ML Base or publishes images. The manual-only trusted Worker workflow
receives package write permission only on main. Worker-specific v2 resolution,
identity, qualification and promotion rules are defined below.

`backend/scripts/check_image_contract.py --role api|beat|worker` runs offline in
the final artifact with `--network none`. It first runs `pip check`. API checks
customer, control-plane and observability app imports plus migration command and
revision modules without starting lifespans or executing migrations. Beat checks
Celery and scheduler-lock imports without loading Worker tasks, and rejects
Worker/OCR/render dependency leakage. Worker delegates task import/registration
to `app.core.runtime_checks.check_celery_tasks()`, the existing source of truth
for all 16 required tasks, then imports Verovio, OTLP, Paddle, PaddleOCR and PaddleX.

The checker supplies synthetic, valid CI-only settings and temporary writable
paths to satisfy import-time configuration; it does not relax production settings
validation. No database, Redis, S3, production secrets, model files, network or GPU
is needed. It never runs the full deployment `run_runtime_checks` path or creates
OCR models. Packaging/import/security validation is not production readiness;
model-cache, GPU hardware and external infrastructure remain deployment concerns.

API/Beat PR checks evaluate the locally loaded final image. PR event image tags identify
GitHub's synthetic merge source, not necessarily the reviewed head SHA. Trusted
publication checks pull the Buildx output's immutable published digest and run
smoke/SBOM/Trivy against that artifact. Source SHAs, tags, OCI digests and Actions
artifact ZIP digests remain distinct identities. Publication currently precedes
these post-build gates; a failed gate fails CI and must not be treated as a
qualified artifact.

PR Governance enforces current-main ancestry for open, unmerged PRs, including
metadata edits. Closed/merged PR metadata edits skip that pre-merge rule; they
cannot meaningfully be asked to refresh a branch before an already completed merge.

## Worker Python Resolution and Artifact Identity v2

### Ownership and generated resolution

The capability files remain human-maintained direct-dependency ownership. They
are not a flat inventory of everything pip happens to install. In particular,
`multidict` and `pycryptodome` remain transitives, not new application declarations.
`backend/requirements/worker-image.in` is the human-owned image assembly input:
it includes `worker-app.txt` and `ocr.txt`, declares former Docker-owned Python
packages, packaging/build tooling, and the existing Torch/cu124 base contract.
Paddle CPU and Torch use exact official-index wheel URLs and artifact hashes,
so an alternate index cannot supply unrelated packages under the same names.

`worker-image-py312-linux-amd64.lock` is generated full transitive resolution,
not another ownership file. Every selected distribution has an exact version or
exact wheel URL and SHA-256 artifact hashes. The supported target is Linux amd64,
Bookworm/glibc 2.36, CPython 3.12, CPU Paddle, and no optional LEGATO extra installs.
GPU/alternate Paddle indexes and extra-dependency flags fail closed; this lock
makes no GPU hardware qualification claim.

The only selected resolver is hash-pinned uv 0.13.5 in `worker-lock-tool.txt`.
Both uv pip compile and pip-tools support full hashed requirements; uv's explicit
Python/platform selection and standalone pip interface avoid a project/workspace
migration. A native Linux/3.12 uv probe qualified this actual package graph.
Initial lock preferences came from the incident SBOM's actual resolution, avoiding
unrelated transitive upgrades (including an incidental fresh filelock major).
No upstream dependency range was overridden and no transitive became a fake root.

Run in Linux amd64 CPython 3.12 (the repository quality container is suitable):

```sh
python backend/scripts/worker_lock.py --generate
python backend/scripts/worker_lock.py --check
```

For example, from a checkout with the standard quality image built:

```sh
docker run --rm -v "$PWD:/repo" --entrypoint python noteverse-backend-quality:ci \
  /repo/backend/scripts/worker_lock.py --repo /repo --generate
```

The helper bootstraps only the pinned, hash-verified resolver in a temporary venv.
Generation/checking never falls back to a different Python or downloads a managed
interpreter. Ordinary regeneration seeds a temporary output with the checked-in
lock, preserving its selected versions. CI regenerates and compares bytes without
writing the checkout. A stale lock fails with the generation command. `--upgrade`
is allowed only with explicit `--generate`, as a separately reviewed dependency
change. Never hand-edit the generated lock or hashes.

The Worker Dockerfile installs packaging/build tools from a slice of that same
lock, then installs the full hash-checked lock with build isolation disabled.
This avoids an untracked ephemeral setuptools/wheel resolution for pure-Python
sdists; their source archives retain their artifact hashes. Installed distribution
versions must match the complete lock, including inherited ML-base packages.
`pip check` and bounded OTLP/Paddle/PaddleOCR/PaddleX imports remain mandatory.
The lock does not claim bit-for-bit reproducible native/OCI builds.

### Input identity, candidate qualification and canonical tags

`worker_image_identity.py` is the sole v2 build-key/registry-policy helper. It
hashes canonical JSON with an explicit schema version, full lock and recursive
ownership input bytes, Dockerfile/helper/generator/tool identities, resolved ML
Base OCI digest, platform/CPU flags, and LEGATO source/commit authority. The
mutable ML Base alias is resolved after appropriate login; builds use its
`repository@sha256:...` reference. A changed alias target necessarily changes the
build key. The key names inputs; only the OCI digest names image content.

The trusted workflow is serialized with cancellation disabled. Its only manual
input is the ML Base alias; no arbitrary Worker dependency-tag override remains.
For `backend-worker-deps:deps-v2-<full-build-key>`:

1. Resolve the canonical tag after login. If it exists, reuse its immutable OCI
   reference without rebuilding or repushing it; requalify under current policy.
2. If absent, build/push only `candidate-<run-id>-<attempt>` in that repository.
3. Qualify that exact candidate OCI: built-in dependency consistency/import gate,
   installed-version lock check, standalone SPDX SBOM and CRITICAL Trivy scan.
4. Only after every dependency gate succeeds, attach the canonical v2 tag to the
   same OCI manifest. Recheck/refuse any different canonical winner; an identical
   existing winner is a no-op, never a repush.

The final Worker builds FROM the qualified dependency `repository@sha256:...`,
never a mutable dependency tag. It likewise uses an attempt-specific candidate,
explicitly pulls and runs its exact published OCI with `--network none`, generates
its SBOM and passes Trivy before assigning `${GITHUB_SHA}`. An existing final
source tag fails closed before composition: source SHA alone cannot establish
that existing image's edge to this run's selected dependency OCI. It is neither
rebuilt nor retagged. Dependency v2 keys still select immutable reuse.
Promotion preserves the single-manifest identity (`--prefer-index=false`) and
verifies the resulting OCI. The helper independently requires actual successful
contract/SBOM/Trivy outcomes; failed/skipped gates cannot promote.

This is first-build-wins **by this serialized governed workflow**, not registry
server CAS against arbitrary out-of-band writers. Identical build inputs do not
guarantee byte-for-byte OCI reproduction: the workflow instead never rebuilds or
repushes an established v2 key. Each image's canonical tag is attached only after
that image's gates pass. A final Worker failure does not invalidate a separately
qualified dependency image; no multi-component release transaction is implied.
Failed candidates may remain clearly quarantined. `build-<run-id>` aliases are
removed; attempt-specific candidates are not permanent release identities.
OCI-native provenance/SBOM attestations remain outside this contract.

The read-only PR workflow uses the same resolved base and build-key helper and
the same lock. It builds only local attempt-specific images, records Docker image
IDs, checks that the local dependency ID is unchanged across final composition,
and never pushes/promotes. Local Docker IDs are not published OCI digests.
Both dependency and final artifacts receive packaging checks, SPDX-2.3/CC0-1.0
SBOMs and unchanged `os,library / CRITICAL / ignore-unfixed=true / exit-code=1`
Trivy gates. Final task registration still delegates to the existing 16-task
`check_celery_tasks()` source of truth; no readiness/model/GPU probe is introduced.

### Heavy-image disk lifecycle and the legacy incident

Qualification is phase-oriented: finish dependency checks/SBOM/scan before final
Worker construction. `worker_image_disk.py` logs `df -h` and `docker system df`
before/after major phases, prunes completed builder cache, removes only named
no-longer-needed local image references, and owns separate temporary SBOM/scan
export/cache directories under the ephemeral runner temp root. It never removes
registry credentials or prunes an active build. PR local images are retained
until their consumers finish. Trusted scans use the immutable registry source
without a redundant daemon export; PR scans use their local daemon images.
Each completed scan/export is cleaned before the next large phase. Optional
Buildx history uploads are disabled so post actions do not retain pruned build
state; both standalone SBOM artifacts and all security gates remain required.
Destructive cleanup is restricted to ephemeral GitHub-hosted runners; local use
is report-only.
The full CUDA/Paddle image scans have an explicit bounded 20-minute analysis
budget: the first v2 PR probe preserved 23 GiB free but hit Trivy's default
five-minute analysis deadline. This changes resource allowance, not the
CRITICAL policy, scanners, scanned files or failure handling.

Run 40087924267/job 120854535187 (attempt 1, source 2e32c70b...) exposed actual
resolution drift under legacy v1 key `fd1036acf6cf624e`: historical OCI
`sha256:6839f22ec89f2ab7bec62df572896f127a8966a49317f81522cf7b33f4e7cd52`
became `sha256:cdc0ef7fa07d7e617a39c1774b2971635390e8326d82815094c5ed5a3dc9be37`,
with multidict 7.1.0→7.2.0 and pycryptodome 4.1.0→4.2.0 despite unchanged source
inputs and ML Base OCI. This was not merely OCI-byte nondeterminism. The run also
exhausted disk during dependency Trivy; final Trivy was skipped after both images
had already been pushed. That dependency OCI and final Worker OCI
`sha256:54c1b50a5a73a2d014494c173444f18689e9fdf17dcd9c03109baa1421bb8507`
remain **unqualified legacy artifacts**. v2 never reuses/promotes those v1 tags;
this change neither restores nor deletes them. It does not change migration
checkboxes or begin another dependency migration.

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
