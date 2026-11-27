# Architecture

These references define current boundaries and runtime contracts. ADRs describe
accepted current decisions and their rationale.

## Runtime and Integrations

- [Security and Runtime Foundation](../adr/0010-security-and-runtime-foundation.md)
- [Control Plane Authentication](control-plane-auth.md)
- [Realtime change delivery](realtime-changes.md)
- [Runtime Dependency Ownership](runtime/runtime-dependency-ownership.md)
- [Durable Asynchronous Delivery](durable-asynchronous-delivery.md)
- [Backend Settings Ownership](runtime/settings-ownership.md)
- [Database Role and Secret Ownership](runtime/database-role-ownership.md)
- [Import Processing](runtime/import-processing.md)
- [Kubernetes Application Runtime](runtime/k8s-application-runtime-contract.md)
- [External Dependencies](integrations/external-dependencies.md)

## Storage Resources

- [Resource Governance](storage-resource-governance.md)
- [Business Resource Lifecycle and Ownership](business-resource-lifecycle.md)
- [Storage Schema Execution and Recovery](storage-resource-execution.md)
- [Object Storage](object-storage.md)
- [Media Storage Contract](../adr/0009-media-storage-refoundation.md)
- [Storage Usage](storage-usage.md)
- [Storage Quota](storage-quota.md)

## Score

- [Written Score Semantics](score-semantics.md)
- [Score Tempo Semantics](score-tempo.md)

## Practice

- [Product Contract](practice-product-contract.md)
- [Piano-Key Domain](practice-piano-key-contract.md)
- [Practice Bundle](practice-bundle.md)
- [Performance Take Reservations](performance-take-reservations.md)
- [Practice Score Compiler](practice-score-compiler.md)
- [Session and Resource Planning](practice-session-planning.md)
- [Failure Boundaries](practice-failures.md)
- [Canonical Moment Artifact](practice-moment-artifact.md)
- [STEP Evidence Admission](practice-step-pitch-evidence-bounds.md)
- [Acoustic Domain Identity Admission](practice-acoustic-domain-identity-bounds.md)
- [Acoustic Evidence Identity Boundary](practice-acoustic-identity-boundary.md)
- [Resource and Liveness Semantics](practice-acoustic-resource-semantics.md)
- [Parameter Evidence](practice-acoustic-parameter-provenance.md)

## Editor

- [Editor Workbench](editor/editor-workbench.md)
- [Automatic Beaming](editor/automatic-beaming.md)
- [Editor Domain Model](../adr/0007-editor-domain-model.md)

## Accepted Decisions

- [ADR 0002: Jobs, Scores and Linear Revisions](../adr/0002-job-score-and-linear-revisions.md)
- [ADR 0003: Sources, Assets and Metadata](../adr/0003-score-artifacts-and-metadata-projection.md)
- [ADR 0004: Access, Collaboration and Guest Preview](../adr/0004-score-access-collaboration-and-guest-preview.md)
- [ADR 0005: Review Before Score Creation](../adr/0005-review-pipeline-before-score.md)
- [ADR 0006: Control-Plane API Boundary](../adr/0006-control-plane-api-boundary.md)
- [ADR 0007: Editor Domain Model](../adr/0007-editor-domain-model.md)
- [ADR 0008: Backend Dependency Authority](../adr/0008-backend-dependency-authority.md)

## Security Boundaries

- [Consumer Sessions](consumer-sessions.md)

- [Control-Plane Identity](../security/control-plane-identity-contract.md)
- [Score Access](../security/score-access-contract.md)
