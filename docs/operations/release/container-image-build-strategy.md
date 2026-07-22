# Container Image Build Strategy

This document defines the intended container image build strategy for
NoteVerse backend and frontend workloads.

Related documents:

- `docs/operations/release/cicd-release-strategy.md`
- `docs/operations/deployment/k8s-deployment-runbook.md`
- `docs/operations/runbooks/docker-backend-runtime-runbook.md`
- `deploy/application/`

## Goals

- build immutable backend and frontend images from a Git commit;
- promote the same tested image from staging to production;
- make image tags traceable to source;
- keep GPU/ML runtime dependencies explicit;
- avoid production deployments from development Dockerfiles;
- leave room for SBOM and vulnerability scanning.

## Current Image Inventory

Current Dockerfiles:

| File | Purpose | Production-ready |
| --- | --- | --- |
| `docker/backend/Dockerfile.ml-base` | CUDA/Python/PyTorch ML base image | yes, as a base image |
| `docker/backend/Dockerfile.api` | FastAPI API, beat, and migration runtime image | yes |
| `docker/backend/Dockerfile.worker` | Celery worker and model-cache-agent ML runtime image | yes, after ML base is published |
| `docker/frontend/Dockerfile.dev` | Next.js development runtime | no |
| `docker/frontend/Dockerfile.runtime` | Next.js production runtime | initial production path |
| `docker/transcoda/*` | Transcoda experimental/runtime images | not part of main deployment path |

Frontend runtime path:

- `docker/frontend/Dockerfile.runtime` exists;
- browser API and realtime traffic use same-origin `/api/v1`;
- environment-specific backend routing belongs in ingress and
  `NEXT_BACKEND_ORIGIN`, not in browser-bundled `NEXT_PUBLIC_*` values.

## Image Names

Recommended registry paths:

```text
<registry>/noteverse/backend-api
<registry>/noteverse/backend-worker
<registry>/noteverse/frontend
<registry>/noteverse/ml-base
```

The current CI workflow uses GitHub Container Registry:

```text
ghcr.io/<github-owner>/noteverse/backend-api
ghcr.io/<github-owner>/noteverse/backend-worker
ghcr.io/<github-owner>/noteverse/frontend
```

GHCR package visibility is controlled by GitHub package settings. Keep
production images private unless there is an explicit decision to publish them.
Kubernetes pulls private images through `Secret/noteverse-registry-credentials`.

The ML base image is a dependency for backend runtime builds, not a directly
deployed application workload.

## Tagging Policy

Every deployable image must have an immutable source tag:

```text
<registry>/noteverse/backend-api:<git-sha>
<registry>/noteverse/backend-worker:<git-sha>
<registry>/noteverse/frontend:<git-sha>
```

Recommended additional metadata tags:

```text
<registry>/noteverse/backend-api:build-<run-id>
<registry>/noteverse/backend-worker:build-<run-id>
<registry>/noteverse/frontend:build-<run-id>
```

Optional mutable aliases:

```text
<registry>/noteverse/backend-api:staging
<registry>/noteverse/backend-worker:staging
<registry>/noteverse/frontend:staging
<registry>/noteverse/backend-api:production
<registry>/noteverse/backend-worker:production
<registry>/noteverse/frontend:production
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
<registry>/noteverse/backend-worker@sha256:<digest>
<registry>/noteverse/frontend@sha256:<digest>
```

If using tags in manifests, release metadata must record the resolved digest.

Production release records should include:

- Git commit SHA;
- backend API image tag;
- backend API image digest;
- backend worker image tag;
- backend worker image digest;
- frontend image tag;
- frontend image digest;
- build run ID;
- migration revision;
- approver.

## Backend Image Build

### ML Base Image

`docker/backend/Dockerfile.ml-base` builds the Python/CUDA/PyTorch base image.

Inputs:

- `CUDA_IMAGE`
- `PYTHON_VERSION`
- `TORCH_CUDA_INDEX`

Recommended build:

```bash
docker build \
  -f docker/backend/Dockerfile.ml-base \
  -t <registry>/noteverse/ml-base:py312-torch260-cu124 \
  .
```

Rules:

- build ML base images infrequently;
- scan and pin the base image digest;
- update runtime images after base image changes;
- do not install project code in the ML base image.

CI entry point:

- run the `ML Base Image` workflow manually when the CUDA/Python/PyTorch base
  changes or when a fresh environment does not yet have the base image in GHCR;
- use the published `ghcr.io/<github-owner>/noteverse/ml-base:<tag>` as the
  `PYTHON_IMAGE` input for the `Backend Worker Image` workflow.

### Backend API Image

`docker/backend/Dockerfile.api` builds the deployed backend API image. This
image intentionally does not contain LEGATO source, PyTorch, PaddleOCR, or model
bootstrap tooling. It is the image for:

- `backend-api`;
- `backend-beat`;
- database migration jobs.

Recommended API image build:

```bash
docker build \
  -f docker/backend/Dockerfile.api \
  -t <registry>/noteverse/backend-api:<git-sha> \
  .
```

### Backend Worker Image

`docker/backend/Dockerfile.worker` builds the deployed worker image. This image
contains the ML runtime dependencies needed by OCR/OMR, rendering, playback
generation, and model-cache-agent runtime checks.

Inputs:

- `PYTHON_IMAGE`;
- `INSTALL_DEV_DEPS`;
- `INSTALL_PADDLE_GPU`;
- `INSTALL_LEGATO_EXTRA_DEPS`;
- `PADDLE_CUDA_INDEX`;
- `LEGATO_REPO_URL`;
- `LEGATO_REPO_COMMIT`.

Production build rules:

- `INSTALL_DEV_DEPS=false`;
- `INSTALL_PADDLE_GPU=false` unless compatibility with the selected PyTorch CUDA
  stack has been validated;
- `INSTALL_LEGATO_EXTRA_DEPS=false` unless training/debug-only dependencies are
  explicitly needed;
- LEGATO source must be pinned by commit and fetched during the image build, or
  supplied as a tracked submodule/vendor directory. Do not rely on an untracked
  local `external/legato` directory.

Recommended worker image build:

```bash
docker build \
  -f docker/backend/Dockerfile.worker \
  --build-arg PYTHON_IMAGE=<registry>/noteverse/ml-base:py312-torch260-cu124 \
  --build-arg INSTALL_DEV_DEPS=false \
  --build-arg INSTALL_PADDLE_GPU=false \
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false \
  --build-arg LEGATO_REPO_URL=https://github.com/guang-yng/legato.git \
  --build-arg LEGATO_REPO_COMMIT=179c228d3d5f67113cf739b44891b3abe046f1dc \
  -t <registry>/noteverse/backend-worker:<git-sha> \
  .
```

The standard `Container Images` workflow builds API and frontend images. The
`Backend Worker Image` workflow builds the ML worker image separately because it
depends on the heavier ML base image and should be promoted deliberately.

## Frontend Image Build

Current state:

- `docker/frontend/Dockerfile.dev` is for local development only;
- `docker/frontend/Dockerfile.runtime` is the production runtime path;
- it builds dependencies with `npm ci`;
- it runs `npm run build`;
- it runs the production server with `npm run start`;
- it sets `NEXT_TELEMETRY_DISABLED=1`;
- build/runtime configuration remains explicit and fail-fast.

Important Next.js config note:

- `frontend/next.config.ts` requires `NEXT_BACKEND_ORIGIN`;
- staging and production can use a stable internal backend Service origin such
  as `http://noteverse-backend-api:8000`;
- browser-facing API and realtime traffic use same-origin `/api/v1`, with
  ingress routing that path to the backend API.

Recommended future build:

```bash
docker build \
  -f docker/frontend/Dockerfile.runtime \
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 \
  --build-arg SESSION_COOKIE_NAME=noteverse_session \
  --build-arg SESSION_REFRESH_COOKIE_NAME=noteverse_refresh \
  -t <registry>/noteverse/frontend:<git-sha> \
  .
```

The frontend image build uses neutral build argument names for cookie names so
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
3. build backend worker image from that ML base;
4. build backend API and frontend images;
5. push commit SHA tags;
6. capture image digests;
7. render private staging overlay with the captured digests;
8. run strict manifest validation;
9. deploy staging and run smoke tests;
10. promote the same digests to production after approval.

The public templates under `deploy/application/overlays/*` intentionally keep
placeholder image tags. Deployable overlays must replace them.

## Open Implementation Items

P0 before production:

- connect the pushed GHCR image digests to private staging/production overlay
  generation;
- record backend/frontend image digests in release metadata;
- create private staging/production overlay generation path;
- run strict manifest validation against private overlays.

P1 hardening:

- raise the vulnerability gate after the first production baseline;
- image signing/attestation;
- registry retention and cleanup policy;
- pin ML base by digest in worker builds after the first stable ML base release.
