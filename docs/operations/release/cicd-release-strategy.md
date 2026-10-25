# CI/CD Release Strategy

## Artifact and release identities

Component CI validates the applicable source paths. API and Beat trusted builds
preflight source/candidate absence, push an attempt-specific candidate, select
and pull its immutable OCI, and run offline packaging, SPDX and CRITICAL Trivy
gates before source-SHA promotion. Worker qualifies or reuses a dependency
artifact and composes its final candidate from that exact OCI. Final qualification
precedes source-tag promotion. PR image jobs are read-only and local-only.

Canonical promotion verifies exact OCI equality and refuses an observed different
winner. These checks do not provide registry-server CAS. Candidates are not
qualified release identities. See [Image Build Strategy](container-image-build-strategy.md).

Release packages select complete component OCI references and environment
configuration. Staging and production package workflows render and validate
manifests and publish package artifacts; package generation is not cluster
deployment. Staging can open a GitOps desired-state PR. Production desired-state
population is not established by its directory placeholder.

## Deployment gates

Use the same tested OCI references for promotion rather than rebuilding from
source. Keep environment secrets outside Git and package artifacts. Validate
configuration ownership, storage, Gateway/TLS, probes, resource requests and
runtime prerequisites before rollout.

Database migration is a one-shot deployment gate using the selected backend
API image. A failed migration blocks workloads. Review schema/outbox/storage
compatibility explicitly; runtime rollback cannot undo a destructive data change.
After migration succeeds, roll out the active workloads and verify readiness,
application smoke, asynchronous processing and observability.

Release evidence identifies source, each component OCI, migration revision,
environment, operator/approval, smoke result and rollback decision. No credential
or raw secret belongs in that evidence.

## Recovery

Frontend-only recovery can select a tested frontend OCI independently when its
API contract remains compatible. API/Worker/Beat rollback additionally requires
schema, queued-work and storage-format compatibility. If compatibility is
unknown, pause affected work and establish a data recovery procedure before
changing workloads. Preserve release metadata and audit evidence.

GitOps staging sync is manual and scoped by AppProject. Operators validate drift
and smoke results before treating sync as delivery success. External approvals
and receiver health must be verified in the actual environment, not inferred
from repository files.

See [Release Package Runbook](release-package-runbook.md),
[GitOps Delivery](gitops-delivery-strategy.md),
[Deployment Runbook](../deployment/k8s-deployment-runbook.md) and
[Production Preflight](../deployment/k8s-production-preflight-checklist.md).
