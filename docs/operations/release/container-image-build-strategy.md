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
| `docker/backend/Dockerfile.api` | FastAPI API and migration runtime image | yes |
| `docker/backend/Dockerfile.beat` | Celery beat scheduler runtime image | yes |
| `docker/backend/Dockerfile.worker-deps` | Shared worker dependency base image | yes, as a base image |
| `docker/backend/Dockerfile.worker` | Celery worker and model-cache-agent runtime image | yes, after worker deps are published |
| `docker/backend/Dockerfile.quality` | Backend quality-check image for local/CI checks | no, not deployed |
| `docker/customer-web/Dockerfile.dev` | Next.js development runtime | no |
| `docker/customer-web/Dockerfile.runtime` | Next.js production runtime | initial production path |
| `docker/platform-admin/Dockerfile.dev` | Platform Admin Next.js development runtime | no |
| `docker/platform-admin/Dockerfile.runtime` | Platform Admin Next.js production runtime | yes |
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
<registry>/noteverse/backend-beat
<registry>/noteverse/backend-worker-deps
<registry>/noteverse/backend-worker
<registry>/noteverse/customer-web
```

The current CI workflow uses GitHub Container Registry:

```text
ghcr.io/<github-owner>/noteverse/backend-api
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

The backend quality image is also not a deployed workload. It exists so ruff,
mypy, pytest, and model-layer checks run in a deterministic Linux environment
without adding development tooling to runtime images.

Backend runtime and quality Docker contexts exclude `backend/research` through
Dockerfile-specific ignore files that retain the root exclusions. Research Docker
builds keep their separately owned contexts and use the root `.dockerignore`.

## Tagging Policy

Qualified deployable images use source tags; OCI digests identify content:

```text
<registry>/noteverse/backend-api:<git-sha>
<registry>/noteverse/backend-beat:<git-sha>
<registry>/noteverse/backend-worker:<git-sha>
<registry>/noteverse/customer-web:<git-sha>
```

Customer Web retains its separate additional metadata tag policy:

```text
<registry>/noteverse/customer-web:build-<run-id>
```

Optional mutable aliases:

```text
<registry>/noteverse/backend-api:staging
<registry>/noteverse/backend-beat:staging
<registry>/noteverse/backend-worker:staging
<registry>/noteverse/customer-web:staging
<registry>/noteverse/backend-api:production
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
<registry>/noteverse/backend-beat@sha256:<digest>
<registry>/noteverse/backend-worker@sha256:<digest>
<registry>/noteverse/customer-web@sha256:<digest>
```

If using tags in manifests, release metadata must record the resolved digest.

Production release records should include:

- Git commit SHA;
- backend API image tag;
- backend API image digest;
- backend beat image tag;
- backend beat image digest;
- backend worker image tag;
- backend worker image digest;
- Customer Web image tag;
- Customer Web image digest;
- build run ID;
- migration revision;
- approver.

## Backend Image Build

### Backend Dependency Authority

All backend images use the one virtual uv project and universal lock. Each
Docker build selects its runtime group with `uv sync --locked`; a stale pair
fails inside the build. The immutable uv tool OCI is governed in the project.
Worker-deps directly installs the complete Worker graph on a resolved Python
base. See [Runtime Dependency Ownership](../../architecture/runtime/runtime-dependency-ownership.md).

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
  Worker task execution is separate from HTTP composition roots.

LEGATO, PaddleOCR and worker model-cache tooling belong to worker images.

### Backend Beat Image

`docker/backend/Dockerfile.beat` builds the deployed Celery beat scheduler image.
It syncs only the `beat` uv group, including shared configuration, Celery/Redis
and PostgreSQL advisory-lock capability. Beat publishes scheduled task names and does not import
worker task implementations.

Recommended beat image build:

```bash
docker build \
  -f docker/backend/Dockerfile.beat \
  -t <registry>/noteverse/backend-beat:<git-sha> \
  .
```

### Backend Worker Dependency Image

Worker-deps is the sole reusable heavy dependency artifact. It installs the
locked `worker` group directly on the governed Python base. CPU Paddle is the
supported target; no GPU qualification is implied. Legato source authority stays
in the tracked execution manifest, and models are not baked into images.

The manual, main-only Worker workflow resolves the Python base OCI before
computing `deps-<64hex-build-key>`. It reuses an existing canonical OCI without
rebuilding, or pushes an attempt-specific candidate. Offline contract, SPDX
SBOM and exact CRITICAL Trivy gates bind to the candidate OCI before canonical
promotion. A key names inputs, not OCI bytes; no registry-server CAS is claimed.

### Backend Worker Image

Final Worker is built from the selected dependency OCI and adds current source
and entrypoint. Its candidate OCI passes the canonical 16-task/import contract,
SBOM and Trivy before source-SHA promotion. Existing source tags fail closed.
Candidates are not qualified release identities. Disk hygiene is scoped to completed lifecycle steps.

Automatic Worker PR validation resolves the public Python base, computes explicit-target dependency
identity, builds both images locally, checks packaging, emits both SPDX SBOMs
and runs both unchanged CRITICAL scans. It cannot push or promote.
Trusted Worker publication is a main-only manual operation requiring explicit authorization.

### Backend Quality Image

The non-deployed Quality image syncs the `quality` uv group for Ruff, mypy,
OpenAPI, migrations, Practice contracts and full pytest. It excludes the heavy
Worker ML graph. Native developer commands use the default `dev` group.

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

Platform Admin follows the same Node image pattern. It currently has no
dedicated quality image: its development image runs `npm ci`, including the
lint, typecheck, and Vitest toolchain; GitHub Actions installs that toolchain
in an isolated Node runner. Production runtime images prune development
dependencies and do not contain test tools. Add a dedicated web quality image
only if a real native or browser-system dependency requires Docker-specific
test parity.

Important Next.js config note:

- `apps/customer-web/next.config.ts` requires `NEXT_BACKEND_ORIGIN`;
- staging and production can use a stable internal backend Service origin such
  as `http://noteverse-backend-api:8000`;
- browser-facing API and realtime traffic use same-origin `/api/v1`, with
  Gateway/HTTPRoute rules routing that path to the backend API.

Customer Web runtime build:

```bash
docker build \
  -f docker/customer-web/Dockerfile.runtime \
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 \
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

- reuse the qualified Worker-deps OCI by dependency build key;
- keep Python dependency installation before application code copy;
- avoid baking model assets into runtime images;
- mount model assets through read-only PVCs in Kubernetes.

Frontend:

- cache npm dependencies by `package-lock.json`;
- do not copy local `.next` or `node_modules`;
- keep npm itself pinned inside Customer Web images; app-level `package.json`
  overrides do not remediate vulnerabilities in the base image's global npm
  installation;
- keep runtime image smaller than the build image as defined by the production Dockerfile.

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
- scanner: Trivy GitHub Action pinned by commit;
- failing severity: `CRITICAL`;
- unfixed vulnerabilities are ignored until a remediation path exists.

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
2. build or reuse qualified Worker-deps by its dependency build key;
3. build and qualify final Worker from that dependency OCI;
4. build backend API, backend beat, and Customer Web images with
   their dedicated image workflows;
5. push commit SHA tags;
6. capture image digests;
7. render private staging overlay with the captured digests;
8. run strict manifest validation;
9. deploy staging and run smoke tests;
10. promote the same digests to production after approval.

The public templates under `deploy/application/overlays/*` intentionally keep
placeholder image tags. Deployable overlays must replace them.

### Backend Service Qualification Before Canonical Tags

Trusted API/Beat main jobs preflight source-SHA and run-attempt candidate tags,
refusing either if present. Buildx pushes only the candidate. The selected OCI
is explicitly pulled, checked offline, described by SPDX and scanned with
`os,library / CRITICAL / ignore-unfixed=true / exit-code=1`. Only then may the
shared OCI primitive attach it to the source SHA using `--prefer-index=false`,
with exact post-attachment OCI verification. No API/Beat build-run aliases remain.
A failed candidate stays unqualified; canonical assignment cannot precede gates.

Worker and API/Beat retain separate policy helpers over those shared mechanics.
API and Beat PR jobs are local-only and unauthenticated to GHCR. Trusted runs
serialize by role without cancellation; PR runs may cancel earlier validation of the same PR.
Registry-server CAS, attestations and candidate retention remain separate concerns.
