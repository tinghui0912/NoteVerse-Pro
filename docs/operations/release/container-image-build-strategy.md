# Container Image Build Strategy

## Production topology

NoteVerse is a modular monolith with four production images and four long-lived
backend Deployments: Customer API, Control Plane, Worker and Beat. The migrator
is a short-lived Job. Five PostgreSQL roles and five runtime DB Secrets remain
separate. Image sharing grants no shared runtime authority.

| Image | Recipe | Workloads / explicit command |
| --- | --- | --- |
| `noteverse-backend-core` | `docker/backend/Dockerfile.core` | Customer API `customer-api`; Control Plane `control-plane`; Beat `beat`; migrator `migrator` |
| `noteverse-backend-worker` | `docker/backend/Dockerfile.worker` | Worker `worker`; model preparation `model-cache --check-scope assets` |
| `noteverse-customer-web` | `docker/customer-web/Dockerfile.runtime` | Next.js standalone Customer Web |
| `noteverse-platform-admin` | `docker/platform-admin/Dockerfile.runtime` | Next.js standalone Platform Admin |

Registry repositories use `ghcr.io/<owner>/noteverse/` followed by `backend-core`,
`backend-worker`, `customer-web` and `platform-admin`. Deployed workloads use
immutable `@sha256:` references. The four core workloads share the exact same
core digest; Worker and model preparation share the exact same Worker digest.
The model-cache holder uses the separately pinned minimal BusyBox utility image.

## Build-only and development recipes

| Recipe | Active purpose |
| --- | --- |
| `docker/backend/Dockerfile.worker-deps` | Internal dependency cache consumed by the Worker build; qualified by dependency identity; never a deployed application workload image |
| `docker/backend/Dockerfile.quality` | Linux CI/developer test runner with quality and rendering tools |
| `docker/customer-web/Dockerfile.dev` | Compose development server |
| `docker/platform-admin/Dockerfile.dev` | Compose development server |

All eight Dockerfiles finish with numeric `USER 10001:10001`. Python disables
bytecode writes. Production root filesystems are read-only; bounded scratch
mounts are defined by the [container contract](../../architecture/runtime/container-and-network-hardening.md).
Dockerfile-specific ignore files exclude research, environment credentials,
model assets and generated caches from backend runtime contexts.

## Backend dependency authority

The sole dependency authority is `backend/pyproject.toml` plus `backend/uv.lock`.
Builds use the governed immutable uv tool, `uv sync --locked`, and `uv pip check`.
Core selects the `api` and `beat` groups, which include HTTP, database, migrations, Celery,
security, storage and API-side fingering. It contains no Torch, Paddle, OCR,
Verovio, Transformers, FFmpeg or FluidSynth. Beat resolves using those same lean
dependencies without importing Worker execution or either HTTP composition root.

Worker-deps selects the complete Worker graph on the governed Python base.
The dependency identity includes its recipe, lock/declarations, identity helper,
packaging checker and pinned Legato manifest. Qualified cache reuse avoids
reinstalling the heavy processing graph; final Worker receives current source.
See [dependency ownership](../../architecture/runtime/runtime-dependency-ownership.md).

## Local build and qualification

```powershell
docker build -f docker/backend/Dockerfile.core -t noteverse-backend-core:check .
python .github/scripts/backend_core_image_smoke.py --image noteverse-backend-core:check
docker build -f docker/backend/Dockerfile.worker-deps -t noteverse-backend-worker-deps:check .
docker build -f docker/backend/Dockerfile.worker --build-arg WORKER_DEPS_IMAGE=noteverse-backend-worker-deps:check -t noteverse-backend-worker:check .
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,exec,nosuid,nodev,size=2g,mode=1777 noteverse-backend-worker:check contract
```

Core smoke verifies numeric identity, root-write rejection, writable bounded
scratch and four composition roots in independent offline subprocesses. It uses
no live database, broker, object storage or production credentials and does not
claim deployment readiness. Worker packaging verifies its canonical task
registration and native imports without loading models or requiring a GPU.
Core has explicit `database-bootstrap`, `seed-integration`, `create-operator`
commands for separately credentialed administrative invocations. Unknown
commands fail instead of executing arbitrary shell commands.

## Publication policy

`.github/workflows/backend-core-image.yml` owns core publication through the
backend-service composite action. PR validation is contents-read and local-only:
no registry login, planning, push or canonical promotion. Trusted main push/manual
runs serialize without cancellation and refuse pre-existing canonical/candidate
tags before mutation. Worker uses its dedicated trusted workflow and dependency
cache policy. Frontend image workflows own their respective images.

Buildx publishes a run-attempt candidate. Qualification pulls that exact OCI,
runs the offline contract, emits SPDX JSON and scans the same OCI with Trivy
`os,library / CRITICAL / ignore-unfixed=true / exit-code=1`. All three successful
gate outcomes are required before attaching the source-SHA canonical. Shared
OCI promotion preserves the exact digest, verifies it afterwards and refuses to
overwrite a different winner. Registry-server CAS is not claimed. BuildKit
attestations are disabled; explicit SPDX artifacts remain mandatory.

## Release and GitOps

Staging and production package workflows resolve exactly four registry image
inputs to immutable digests. `scripts/render_k8s_release_overlay.py` validates
image ownership, copies a self-contained base and verifies explicit commands and
digest equality. `scripts/promote_release_package_to_gitops.py` validates the
same snapshot before promotion. ConfigMaps, five runtime Secrets, PostgreSQL
authority and Cilium policies remain workload-specific.

GitOps without a qualified publication contains an explicit publication gate.
Its missing `published-release` resource prevents Kustomize generation and an
empty pruning sync. `check_gitops_manifests.py` reports BLOCKED;
`--require-published` rejects that state. Promotion replaces the gate only with a
qualified four-image package. No digest is invented, relabelled or inferred from
a different image. Staging and production use the same qualified digests.

See the [release runbook](release-package-runbook.md),
[deployment runbook](../deployment/k8s-deployment-runbook.md) and
[ADR 0010](../../adr/0010-security-and-runtime-foundation.md).
