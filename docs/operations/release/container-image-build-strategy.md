# Container Image Build Strategy

This document defines the intended container image build strategy for
NoteVerse backend and frontend workloads.

Related documents:

- `docs/operations/release/cicd-release-strategy.md`
- `docs/operations/deployment/k8s-deployment-runbook.md`
- `docs/operations/runbooks/docker-backend-runtime-runbook.md`
- `deploy/application/`

## Goals

- build immutable backend and Customer Web images from a Git commit;
- promote the same tested image from staging to production;
- make image tags traceable to source;
- keep GPU/ML runtime dependencies explicit;
- avoid production deployments from development Dockerfiles;
- leave room for SBOM and vulnerability scanning.

## Current Image Inventory

Current Dockerfiles:

| File | Purpose | Production-ready |
| --- | --- | --- |
| `docker/backend/Dockerfile.ml-base` | Python/PyTorch CUDA wheel ML base image | yes, as a base image |
| `docker/backend/Dockerfile.api` | FastAPI API and migration runtime image | yes |
| `docker/backend/Dockerfile.practice-deps` | Shared realtime practice dependency base image | yes, as a base image |
| `docker/backend/Dockerfile.practice` | Realtime practice API/WebSocket runtime image | yes |
| `docker/backend/Dockerfile.beat` | Celery beat scheduler runtime image | yes |
| `docker/backend/Dockerfile.worker-deps` | Shared worker dependency base image | yes, as a base image |
| `docker/backend/Dockerfile.worker` | Celery worker and model-cache-agent runtime image | yes, after worker deps are published |
| `docker/backend/Dockerfile.quality` | Backend quality-check image for local/CI checks | no, not deployed |
| `docker/customer-web/Dockerfile.dev` | Next.js development runtime | no |
| `docker/customer-web/Dockerfile.runtime` | Next.js production runtime | initial production path |
| `docker/transcoda/*` | Transcoda experimental/runtime images | not part of main deployment path |

Frontend runtime path:

- `docker/customer-web/Dockerfile.runtime` exists;
- browser API and realtime traffic use same-origin `/api/v1`;
- environment-specific backend routing belongs in Gateway/HTTPRoute rules and
  `NEXT_BACKEND_ORIGIN`, not in browser-bundled `NEXT_PUBLIC_*` values.

## Image Names

Recommended registry paths:

```text
<registry>/noteverse/backend-api
<registry>/noteverse/backend-practice-deps
<registry>/noteverse/backend-practice
<registry>/noteverse/backend-beat
<registry>/noteverse/backend-worker-deps
<registry>/noteverse/backend-worker
<registry>/noteverse/customer-web
<registry>/noteverse/ml-base
```

The current CI workflow uses GitHub Container Registry:

```text
ghcr.io/<github-owner>/noteverse/backend-api
ghcr.io/<github-owner>/noteverse/backend-practice-deps
ghcr.io/<github-owner>/noteverse/backend-practice
ghcr.io/<github-owner>/noteverse/backend-beat
ghcr.io/<github-owner>/noteverse/backend-worker-deps
ghcr.io/<github-owner>/noteverse/backend-worker
ghcr.io/<github-owner>/noteverse/customer-web
```

GHCR package visibility is controlled by GitHub package settings. Keep
production images private unless there is an explicit decision to publish them.
Kubernetes pulls private images through `Secret/noteverse-registry-credentials`.

CI publishes to GHCR with this priority:

1. `secrets.GHCR_USERNAME` and `secrets.GHCR_TOKEN`;
2. the workflow `GITHUB_TOKEN`.

Use `GITHUB_TOKEN` only when the GHCR packages are owned by this repository and
the package settings grant this repository write access. If a push fails with
`403 Forbidden` during a blob `HEAD` or `PUT` request, either connect the GHCR
package to this repository with write permission or create:

- `GHCR_USERNAME`: GitHub user or bot account name;
- `GHCR_TOKEN`: a fine-grained or classic token allowed to write packages for
  the target owner.

The ML base image is a dependency for backend runtime builds, not a directly
deployed application workload.

The backend quality image is also not a deployed workload. It exists so ruff,
mypy, pytest, and model-layer checks run in a deterministic Linux environment
without adding development tooling to runtime images.

## Tagging Policy

Every deployable image must have an immutable source tag:

```text
<registry>/noteverse/backend-api:<git-sha>
<registry>/noteverse/backend-practice-deps:<git-sha>
<registry>/noteverse/backend-practice:<git-sha>
<registry>/noteverse/backend-beat:<git-sha>
<registry>/noteverse/backend-worker:<git-sha>
<registry>/noteverse/customer-web:<git-sha>
```

Recommended additional metadata tags:

```text
<registry>/noteverse/backend-api:build-<run-id>
<registry>/noteverse/backend-practice-deps:build-<run-id>
<registry>/noteverse/backend-practice:build-<run-id>
<registry>/noteverse/backend-beat:build-<run-id>
<registry>/noteverse/backend-worker:build-<run-id>
<registry>/noteverse/customer-web:build-<run-id>
```

Optional mutable aliases:

```text
<registry>/noteverse/backend-api:staging
<registry>/noteverse/backend-practice-deps:staging
<registry>/noteverse/backend-practice:staging
<registry>/noteverse/backend-beat:staging
<registry>/noteverse/backend-worker:staging
<registry>/noteverse/customer-web:staging
<registry>/noteverse/backend-api:production
<registry>/noteverse/backend-practice-deps:production
<registry>/noteverse/backend-practice:production
<registry>/noteverse/backend-beat:production
<registry>/noteverse/backend-worker:production
<registry>/noteverse/customer-web:production
```

Rules:

- Kubernetes deployable overlays should use commit SHA tags or digests;
- mutable aliases must not be the audit source of truth;
- never deploy `latest`;
- never deploy `replace-me`, `staging-replace-me`, or
  `production-replace-me`.

## Digest Policy

The safest production reference is an image digest:

```text
<registry>/noteverse/backend-api@sha256:<digest>
<registry>/noteverse/backend-practice-deps@sha256:<digest>
<registry>/noteverse/backend-practice@sha256:<digest>
<registry>/noteverse/backend-beat@sha256:<digest>
<registry>/noteverse/backend-worker@sha256:<digest>
<registry>/noteverse/customer-web@sha256:<digest>
```

If using tags in manifests, release metadata must record the resolved digest.

Production release records should include:

- Git commit SHA;
- backend API image tag;
- backend API image digest;
- backend practice dependency image tag;
- backend practice dependency image digest;
- backend beat image tag;
- backend beat image digest;
- backend practice image tag;
- backend practice image digest;
- backend worker image tag;
- backend worker image digest;
- Customer Web image tag;
- Customer Web image digest;
- build run ID;
- migration revision;
- approver.

## Backend Image Build

### ML Base Image

`docker/backend/Dockerfile.ml-base` builds the Python/PyTorch CUDA wheel base
image.

Inputs:

- `PYTHON_IMAGE`
- `TORCH_CUDA_INDEX`

Recommended build:

```bash
docker buildx build --push \
  -f docker/backend/Dockerfile.ml-base \
  -t <registry>/noteverse/ml-base:py312-torch260-cu124-slim \
  .
```

Rules:

- build ML base images infrequently;
- scan and pin the base image digest;
- update runtime images after base image changes;
- do not install project code in the ML base image.

CI entry point:

- run the `ML Base Image` workflow manually when the Python/PyTorch CUDA base
  changes or when a fresh environment does not yet have the base image in GHCR;
- use the published `ghcr.io/<github-owner>/noteverse/ml-base:<tag>` as the
  base input for the `Backend Worker Image` workflow.

The workflow also publishes a fingerprint tag:

```text
ghcr.io/<github-owner>/noteverse/ml-base:ml-<hash>
```

The hash is derived from `Dockerfile.ml-base` plus the selected Python image and
PyTorch CUDA wheel index. Human-readable tags such as
`py312-torch260-cu124-slim` are convenient aliases; release records should
still capture the resolved digest.

### Backend API Image

`docker/backend/Dockerfile.api` builds the deployed backend API image. This
image intentionally does not contain LEGATO source, PyTorch, PaddleOCR, or model
bootstrap tooling. It is the image for:

- `backend-api`;
- database migration jobs.

Recommended API image build:

```bash
docker build \
  -f docker/backend/Dockerfile.api \
  -t <registry>/noteverse/backend-api:<git-sha> \
  .
```

The API image includes:

- `Pillow` for account avatar processing;
- `pianoplayer` for bounded interactive fingering generation. The API execution
  gate keeps the blocking engine off the event loop and limits concurrent work;
  a dedicated CPU worker is a future scale decision, not a second HTTP service.

It does not include realtime practice alignment dependencies, LEGATO, PaddleOCR,
or worker model-cache tooling.

### Backend Practice Image

`docker/backend/Dockerfile.practice` builds the deployed realtime practice
runtime image. It inherits from `docker/backend/Dockerfile.practice-deps`, which
builds and installs the native practice alignment dependency layer. The runtime
image owns the practice HTTP/WebSocket process and application source.

The dependency base is a slower-moving image. Its canonical tag is derived from
the files that define the practice dependency layer:

```text
deps-<sha256(
  docker/backend/Dockerfile.practice-deps,
  backend/requirements/practice-app.txt,
  backend/requirements/practice-runtime.txt,
  backend/requirements/practice-runtime-constraints.txt
)>
```

Build the dependency base only when one of those files changes:

```bash
docker build \
  -f docker/backend/Dockerfile.practice-deps \
  -t <registry>/noteverse/backend-practice-deps:deps-<dependency-hash> \
  .
```

Recommended practice image build:

```bash
docker build \
  -f docker/backend/Dockerfile.practice \
  --build-arg PRACTICE_DEPS_IMAGE=<registry>/noteverse/backend-practice-deps:deps-<dependency-hash> \
  -t <registry>/noteverse/backend-practice:<git-sha> \
  .
```

The `Backend Practice Image` workflow computes this dependency hash. If the
practice dependency files changed, it builds the dependency base first. For
normal application-code changes it pulls the matching `backend-practice-deps`
image from GHCR and fails clearly if that dependency base has not been
published yet. This keeps normal application image builds fast while making
native dependency updates deliberate. Dependency base images may be pushed from
branch builds; deployable application images are pushed only from `main` or
manual dispatch.

### Backend Beat Image

`docker/backend/Dockerfile.beat` builds the deployed Celery beat scheduler image.
It installs `backend/requirements/beat.txt`, which inherits only shared backend
runtime infrastructure. Beat publishes scheduled task names and does not import
worker task implementations.

Recommended beat image build:

```bash
docker build \
  -f docker/backend/Dockerfile.beat \
  -t <registry>/noteverse/backend-beat:<git-sha> \
  .
```

### Backend Worker Dependency Image

`docker/backend/Dockerfile.worker-deps` builds the worker dependency base image.
This image contains the ML runtime dependencies needed by OCR/OMR, rendering,
playback generation, and model-cache-agent runtime checks. It does not contain
backend application source.

Inputs:

- `PYTHON_IMAGE`;
- `INSTALL_PADDLE_GPU`;
- `INSTALL_LEGATO_EXTRA_DEPS`;
- `PADDLE_CUDA_INDEX`;
- `LEGATO_REPO_URL`;
- `LEGATO_REPO_COMMIT`.

Production build rules:

- `INSTALL_PADDLE_GPU=false` unless compatibility with the selected PyTorch CUDA
  stack has been validated;
- `INSTALL_LEGATO_EXTRA_DEPS=false` unless training/debug-only dependencies are
  explicitly needed;
- LEGATO source must be pinned by commit and fetched during the image build, or
  supplied as a tracked submodule/vendor directory. Do not rely on an untracked
  local `external/legato` directory.

Recommended worker dependency image build:

```bash
docker build \
  -f docker/backend/Dockerfile.worker-deps \
  --build-arg PYTHON_IMAGE=<registry>/noteverse/ml-base:py312-torch260-cu124-slim \
  --build-arg INSTALL_PADDLE_GPU=false \
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false \
  --build-arg LEGATO_REPO_URL=https://github.com/guang-yng/legato.git \
  --build-arg LEGATO_REPO_COMMIT=179c228d3d5f67113cf739b44891b3abe046f1dc \
  -t <registry>/noteverse/backend-worker-deps:deps-<dependency-hash> \
  .
```

### Backend Worker Image

`docker/backend/Dockerfile.worker` builds the deployed worker image. It inherits
from the published `backend-worker-deps` image and contains only the backend
application source plus the runtime entrypoint.

Recommended worker image build:

```bash
docker build \
  -f docker/backend/Dockerfile.worker \
  --build-arg WORKER_DEPS_IMAGE=<registry>/noteverse/backend-worker-deps:deps-<dependency-hash> \
  -t <registry>/noteverse/backend-worker:<git-sha> \
  .
```

The API, beat, practice, and Customer Web image workflows are split by runtime
boundary. The `Backend Worker Image` workflow builds the worker dependency image
and final worker image separately because they depend on the heavier ML base
image and should be promoted deliberately.

The worker workflow is manual-only. GitHub-hosted runners have limited
ephemeral disk space and are not a reliable place to automatically unpack CUDA,
PyTorch, PaddleOCR, Transformers, and worker runtime layers on every push. Use
one of these production-grade options for worker publication:

- run the workflow on a self-hosted Linux build runner with enough disk space;
- use a paid larger GitHub runner with sufficient disk;
- build and push the worker image from controlled release infrastructure.

Do not make normal pull requests depend on a full worker image build. Worker
contract tests belong in backend quality checks; the full worker image is a
release artifact.

The worker workflow pulls the selected ML base image before building
`backend-worker-deps`, then builds the final worker from that dependency image.
Do not let the worker build silently fall back to an unpublished local base.

### Backend Quality Image

Backend quality images are non-deployed check images:

- `docker/backend/Dockerfile.quality` installs
  `backend/requirements/quality-core.txt` for compile, ruff, mypy, model-layer
  mypy, and core pytest.
- `docker/backend/Dockerfile.practice-quality` installs
  `backend/requirements/quality-tools.txt` on top of
  `docker/backend/Dockerfile.practice-deps` for practice realtime tests.

`backend/requirements/quality.txt` is only an aggregate reference. Runtime
images must not install ruff, mypy, pytest, pre-commit, or practice-only Cython
dependencies just to satisfy quality checks.

## Customer Web Image Build

Current state:

- `docker/customer-web/Dockerfile.dev` is for local development only;
- `docker/customer-web/Dockerfile.runtime` is the production runtime path;
- frontend Dockerfiles use the Node 24 LTS image line, not `node:latest`;
- both frontend Dockerfiles use a pinned npm version on top of the Node base
  image so the globally bundled npm dependencies are deterministic and can be
  scanned;
- it builds dependencies with `npm ci`;
- it runs `npm run build`;
- it runs the production server with `npm run start`;
- it sets `NEXT_TELEMETRY_DISABLED=1`;
- build/runtime configuration remains explicit and fail-fast.

Important Next.js config note:

- `apps/customer-web/next.config.ts` requires `NEXT_BACKEND_ORIGIN`;
- staging and production can use a stable internal backend Service origin such
  as `http://noteverse-backend-api:8000`;
- browser-facing API and realtime traffic use same-origin `/api/v1`, with
  Gateway/HTTPRoute rules routing that path to the backend API.

Recommended future build:

```bash
docker build \
  -f docker/customer-web/Dockerfile.runtime \
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 \
  --build-arg NEXT_PRACTICE_ORIGIN=http://noteverse-backend-practice:8000 \
  --build-arg SESSION_COOKIE_NAME=noteverse_session \
  --build-arg SESSION_REFRESH_COOKIE_NAME=noteverse_refresh \
  -t <registry>/noteverse/customer-web:<git-sha> \
  .
```

The Customer Web image build uses neutral build argument names for cookie names so
Docker does not confuse runtime cookie naming with secret material. Real secrets
must still be provided through Kubernetes Secrets and must not be passed as
Docker build args.

## Build Cache Strategy

Backend:

- cache the ML base image separately;
- keep Python dependency installation before application code copy;
- avoid baking model assets into runtime images;
- mount model assets through read-only PVCs in Kubernetes.

Frontend:

- cache npm dependencies by `package-lock.json`;
- do not copy local `.next` or `node_modules`;
- keep npm itself pinned inside Customer Web images; app-level `package.json`
  overrides do not remediate vulnerabilities in the base image's global npm
  installation;
- keep runtime image smaller than the build image when the production Dockerfile
  is added.

## Artifact Promotion

Use the same image digest across staging and production:

```text
build once -> deploy staging -> approve -> deploy production
```

Do not:

- rebuild production images from the same commit after staging;
- change dependencies between staging and production;
- use environment-specific source builds.

Environment-specific values belong in Kubernetes ConfigMaps/Secrets and private
overlays, not in different application images.

## Security And Supply Chain

The container image workflow now generates SBOM artifacts and scans runtime
images for critical vulnerabilities.

Current gate:

- SBOM format: SPDX JSON;
- scanner: Trivy GitHub Action with a pinned `v*` release tag;
- failing severity: `CRITICAL`;
- unfixed vulnerabilities are ignored until a remediation path exists.

Future CI should add:

- GitHub Actions JavaScript action versions should stay on Node 24-compatible
  majors;
- base image digest pinning;
- a reviewed baseline for moving from `CRITICAL` to `HIGH,CRITICAL`;
- signed image attestations if the registry/deployment platform supports them;
- registry retention policy for old commit images.

The current GitHub Packages view is kept simple by disabling BuildKit
provenance/SBOM attestations in `docker/build-push-action`. Without that,
GHCR can show attestation manifests as an extra `unknown/unknown` platform.
The workflow still generates explicit SPDX SBOM artifacts through the separate
SBOM step.

Do not disable the scan because a dependency is noisy. Either upgrade the base
image/dependency, document an accepted risk with expiry, or keep the release
blocked.

## Deployment Integration

CI/CD should:

1. run quality gates;
2. build or select the pinned ML base image;
3. build or select the pinned practice dependency base image;
4. build backend worker image from that ML base;
5. build backend API, backend practice, backend beat, and Customer Web images with
   their dedicated image workflows;
6. push commit SHA tags;
7. capture image digests;
8. render private staging overlay with the captured digests;
9. run strict manifest validation;
10. deploy staging and run smoke tests;
11. promote the same digests to production after approval.

The public templates under `deploy/application/overlays/*` intentionally keep
placeholder image tags. Deployable overlays must replace them.

## Open Implementation Items

P0 before production:

- connect the pushed GHCR image digests to private staging/production overlay
  generation;
- record backend/Customer Web image digests in release metadata;
- extend the environment-driven release package workflow from staging to
  production after approval rules are finalized;
- run strict manifest validation against private overlays.

P1 hardening:

- raise the vulnerability gate after the first production baseline;
- image signing/attestation;
- registry retention and cleanup policy;
- pin ML base by digest in worker builds after the first stable ML base release.
