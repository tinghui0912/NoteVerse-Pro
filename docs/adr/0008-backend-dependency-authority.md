# ADR 0008: Backend Dependency Authority

Status: Accepted

## Context

The backend is one modular monolith with overlapping capabilities and several
runtime processes. Independently resolved runtime environments allowed transitive
drift. Separate source/lock checks did not make image builds self-enforcing.
The project is pre-release: maintaining two architectures would add cost without
a compatibility need.

Historical transitive versions are evidence, not dependency ownership. A historical
API selected PyYAML 6.0.3, while PaddleX 3.7.2 requires exactly 6.0.2. PyYAML is
not NoteVerse-owned. Universal convergence follows direct declarations, upstream
metadata, uv's resolver and the reviewed lock, rather than preserving old drift
with overrides, fake roots or artificial group conflicts.

## Decision

Use one virtual/non-package project under `backend/`. `pyproject.toml` owns exact
direct intent; `uv.lock` owns the exact universal resolution. Pin uv to 0.13.5
and Python to the 3.12 line. Project version `0.0.0` is required virtual-project
metadata, not an application/release version. Introduce no Python build backend.

PEP 735 capability groups compose API, Beat, Worker application, full Worker,
Quality and default developer environments. Deployable processes are not separate
Python packages. No workspace is justified without a real package boundary.
Runtime groups remain independently installable from the same lock.

Docker copies the project/lock into `/opt/noteverse/project` and runs
`uv sync --locked` into `/opt/noteverse/venv`. Stale pairs fail inside the build,
independent of workflows or branch protection. Python downloads are disabled.
The approved uv binary is copied from one immutable OCI reference and remains
for offline dependency integrity checks against the active interpreter.

Stable candidates are preferred. Prerelease eligibility is bounded to the direct
OpenTelemetry beta instrumentation and its upstream-required beta family. Secure
first-index behavior remains. Only Torch uses the explicit CUDA 12.4 index;
CPU Paddle uses its approved CPython 3.12 Linux wheel. Heavy Worker roots are
Linux x86_64 only, without restricting ordinary development to Linux.

Build-only tools are not application ownership. Source-only production packages
`fire` and `zss` use isolated setuptools PEP 517 builds, with exact hashed build
constraints enforced by stable uv. Do not disable build isolation globally.

Worker-deps becomes the sole reusable heavy dependency image, directly on a
resolved Python base OCI. Schema 3 identity hashes uv's stable locked text graph with explicit CPython
3.12 and Linux x86_64/manylinux 2.36 targets, full project/lock bytes, resolved
Python base, uv tool identity, dependency recipe, embedded contract and Legato
authority. uv 0.13.5 export has no target switch; native target-filtered tree
output supplies the representation without experimental JSON or hand marker parsing. It excludes final application payload.
A build key names inputs; an OCI digest names content. Trusted publication keeps
candidate-first gates, first-build-wins dependency reuse and immutable composition. Dependency identity
code is separate from Worker-specific registry policy. API/Beat and Worker use
one CI-only OCI primitive for semantic absence, digest checks and exact promotion;
registry-policy edits do not invalidate dependency keys.
PR validation is local/read-only. New trusted v3 qualification follows merge.
Previously qualified v2 artifacts remain historical evidence, never fallback inputs.

## Rejected Alternatives

1. Capability text inputs plus generated per-role locks retain custom parsers and
   source/lock binding that native locked sync already owns.
2. uv plus requirements compatibility creates two authorities and ambiguous commands.
3. One project/lock per runtime preserves unnecessary transitive divergence.
4. A workspace without package boundaries confuses deployments with packages.
5. Keeping a custom Worker lock leaves the heavy runtime outside the same authority.
6. Keeping Torch ownership in a separate backend base Dockerfile splits the graph.

## Consequences and Boundaries

Delete the legacy dependency files, custom lock/fingerprint code and independent
backend ML dependency-base recipe/workflow. No compatibility path remains.
Superseded PRs #140/#141 preserve their historical evidence without being merged.
The runtime ownership document describes only the resulting architecture.

This does not claim OCI byte reproducibility, OS locking, registry-server CAS,
attestations, GPU/model readiness or base-image reproducibility. Python 3.14, Redis 8, TypeScript 7,
candidate retention, release-set governance and container hardening remain separate.

API/Beat trusted main publication also plans before mutation, pushes only an
attempt-specific candidate, pulls its immutable OCI, runs offline packaging,
SPDX and CRITICAL Trivy, then attaches the same OCI to its source-SHA canonical.
Existing canonical/candidate tags fail preflight. Promotion refuses an observed
different winner, accepts an identical winner without repush, and verifies exact
OCI preservation. PRs remain local-only; trusted runs serialize without cancelling.
This ordering is the main publication behavior, not a transitional hold.
