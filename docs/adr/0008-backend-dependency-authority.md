# ADR 0008: Backend Dependency Authority

Status: Accepted

## Context and Rationale

The backend is one modular monolith with shared capabilities and several runtime
processes. One dependency authority keeps direct intent, upstream constraints and
transitive resolution coherent. Deployable processes are dependency compositions,
not separate Python packages.

## Dependency Authority

`backend/pyproject.toml` is the virtual/non-package project's direct dependency,
source and build configuration. `backend/uv.lock` is its universal resolution.
uv is pinned to 0.13.5 and Python to the 3.12 line. Virtual-project version
`0.0.0` is project metadata, not an application release version.

PEP 735 capability groups express ownership. Nested runtime groups select API,
Beat, Worker application, complete Worker and Quality environments. The default
developer group selects Quality. Transitive versions follow direct declarations,
upstream metadata, uv resolution and the reviewed lock.

Stable releases are preferred. Prerelease eligibility is bounded to the direct
OpenTelemetry instrumentation beta and its upstream-required beta family.
First-index resolution is enforced. Only Torch uses the explicit CUDA 12.4
index; CPU Paddle uses the approved CPython 3.12 Linux wheel. Heavy Worker roots
are Linux x86_64-scoped. Source-only `fire` and `zss` use isolated PEP 517 builds
with exact hashed build constraints. Build tooling is distinct from runtime
dependency ownership.

## Docker and Artifact Identity

Docker copies the project and lock into `/opt/noteverse/project` and performs
role-specific `uv sync --locked` into `/opt/noteverse/venv`. Stale authority pairs
fail inside the build. Python downloads are disabled. The immutable uv OCI
supplies installation and offline dependency integrity checks.

Worker-deps is the reusable heavy dependency artifact. Its build key binds the
full project and lock, resolved Python base OCI, immutable uv tool identity,
dependency recipe, embedded packaging contract, Legato authority and identity
algorithm. uv's locked text tree supplies the resolution representation with
explicit CPython 3.12 and Linux x86_64/manylinux 2.36 targets. uv interprets
markers; the representation is hashed directly. The identity type is
`noteverse-worker-deps`; its canonical tag is `deps-<64hex-build-key>`.
A build key identifies governed inputs. An OCI digest identifies content.

## Publication Trust

CI policy lives under `.github/scripts/`, separate from backend runtime commands
and repository/platform orchestration. Shared OCI mechanics implement semantic
manifest absence, digest validation, qualified attachment and exact verification.
Separate service and Worker policies own their bounded repositories and canonical
rules. Registry policy code is outside the Worker dependency key.

Core trusted publication refuses existing source/candidate tags, pushes
only an attempt-specific candidate, pulls its exact OCI, and runs offline contract,
SPDX and CRITICAL Trivy gates before source-SHA promotion. Worker reuses an
existing qualified dependency key or qualifies a dependency candidate, then builds
the final candidate from the exact dependency OCI and applies the same gates.
Final Worker source tags refuse recomposition.

Promotion uses `--prefer-index=false`, refuses an observed different winner,
accepts an identical winner without repush, and verifies the canonical OCI.
PR validation is local and read-only. Trusted publication serializes without
cancelling active qualification. Runner disk cleanup follows completed lifecycle steps.

## Boundaries

Packaging contracts establish dependency/import composition without production
infrastructure, model initialization or GPU hardware. They are not deployment
readiness. Registry-server CAS, OCI byte reproducibility, OCI-native attestations,
OS package locking, base-image reproducibility and candidate retention are
separate concerns.
