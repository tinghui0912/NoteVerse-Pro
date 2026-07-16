# Container Image Build Strategy

This document defines the intended container image build strategy for
NoteVerse backend and frontend workloads.

Related documents:

- `docs/cicd-release-strategy.md`
- `docs/k8s-deployment-runbook.md`
- `docs/docker_backend_runtime_runbook.md`
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
| `docker/backend/Dockerfile.runtime` | FastAPI/Celery backend runtime image | mostly yes |
| `docker/frontend/Dockerfile.dev` | Next.js development runtime | no |
| `docker/transcoda/*` | Transcoda experimental/runtime images | not part of main deployment path |

Current gap:

- there is no dedicated production frontend runtime Dockerfile yet;
- production frontend deployments should not use `docker/frontend/Dockerfile.dev`;
- a future `docker/frontend/Dockerfile.runtime` should build with `npm ci`,
  `npm run build`, and run with `next start`.

## Image Names

Recommended registry paths:

```text
<registry>/noteverse/backend
<registry>/noteverse/frontend
<registry>/noteverse/ml-base
```

The ML base image is a dependency for backend runtime builds, not a directly
deployed application workload.

## Tagging Policy

Every deployable image must have an immutable source tag:

```text
<registry>/noteverse/backend:<git-sha>
<registry>/noteverse/frontend:<git-sha>
```

Recommended additional metadata tags:

```text
<registry>/noteverse/backend:build-<run-id>
<registry>/noteverse/frontend:build-<run-id>
```

Optional mutable aliases:

```text
<registry>/noteverse/backend:staging
<registry>/noteverse/frontend:staging
<registry>/noteverse/backend:production
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
<registry>/noteverse/backend@sha256:<digest>
<registry>/noteverse/frontend@sha256:<digest>
```

If using tags in manifests, release metadata must record the resolved digest.

Production release records should include:

- Git commit SHA;
- backend image tag;
- backend image digest;
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

### Backend Runtime Image

`docker/backend/Dockerfile.runtime` builds the deployed backend runtime image.

Inputs:

- `PYTHON_IMAGE`
- `INSTALL_DEV_DEPS`
- `INSTALL_GPU_DEPS`
- `INSTALL_PADDLE_GPU`
- `INSTALL_LEGATO_EXTRA_DEPS`
- `PADDLE_CUDA_INDEX`

Production build rules:

- `INSTALL_DEV_DEPS=false`;
- `INSTALL_GPU_DEPS=true` for worker-capable images;
- `INSTALL_PADDLE_GPU=false` unless compatibility with the selected PyTorch CUDA
  stack has been validated;
- `INSTALL_LEGATO_EXTRA_DEPS=false` unless training/debug-only dependencies are
  explicitly needed;
- build one backend image for API, worker, beat, and migration job unless a
  future split is justified by size or security.

Recommended build:

```bash
docker build \
  -f docker/backend/Dockerfile.runtime \
  --build-arg PYTHON_IMAGE=<registry>/noteverse/ml-base:py312-torch260-cu124 \
  --build-arg INSTALL_DEV_DEPS=false \
  --build-arg INSTALL_GPU_DEPS=true \
  --build-arg INSTALL_PADDLE_GPU=false \
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false \
  -t <registry>/noteverse/backend:<git-sha> \
  .
```

## Frontend Image Build

Current state:

- `docker/frontend/Dockerfile.dev` is for local development only;
- it runs `next dev` and should not be used in production.

Required next implementation:

- add `docker/frontend/Dockerfile.runtime`;
- build dependencies with `npm ci`;
- run `npm run build`;
- run production server with `npm run start` or `next start`;
- set `NEXT_TELEMETRY_DISABLED=1`;
- keep build/runtime configuration explicit and fail-fast.

Important Next.js config note:

- `frontend/next.config.ts` requires `NEXT_BACKEND_ORIGIN`;
- staging and production should use a stable internal backend Service origin
  such as `http://noteverse-backend-api:8000` so the same frontend image can be
  promoted across environments;
- browser-facing realtime config remains runtime/public configuration through
  `NEXT_PUBLIC_REALTIME_API_BASE_URL`.

Recommended future build:

```bash
docker build \
  -f docker/frontend/Dockerfile.runtime \
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 \
  -t <registry>/noteverse/frontend:<git-sha> \
  .
```

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

Future CI should add:

- SBOM generation for backend and frontend images;
- vulnerability scanning for OS and language dependencies;
- base image digest pinning;
- signed image attestations if the registry/deployment platform supports them;
- registry retention policy for old commit images.

Initial scanning can be added after production Dockerfile coverage is complete.

## Deployment Integration

CI/CD should:

1. run quality gates;
2. build backend and frontend images;
3. push commit SHA tags;
4. capture image digests;
5. render private staging overlay with the captured digests;
6. run strict manifest validation;
7. deploy staging and run smoke tests;
8. promote the same digests to production after approval.

The public templates under `deploy/application/overlays/*` intentionally keep
placeholder image tags. Deployable overlays must replace them.

## Open Implementation Items

P0 before production:

- add `docker/frontend/Dockerfile.runtime`;
- add CI image build workflow;
- record backend/frontend image digests in release metadata;
- create private staging/production overlay generation path;
- run strict manifest validation against private overlays.

P1 hardening:

- SBOM generation;
- image vulnerability scanning;
- image signing/attestation;
- registry retention and cleanup policy;
- optional split between API image and GPU worker image if runtime size or
  security boundaries require it.
