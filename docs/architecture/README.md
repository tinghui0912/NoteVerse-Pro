# Architecture

These references define current boundaries and runtime contracts. ADRs describe
accepted current decisions and their rationale.

## Runtime and Integrations

- [Runtime Dependency Ownership](runtime/runtime-dependency-ownership.md)
- [Backend Settings Ownership](runtime/settings-ownership.md)
- [Import Processing](runtime/import-processing.md)
- [Kubernetes Application Runtime](runtime/k8s-application-runtime-contract.md)
- [External Dependencies](integrations/external-dependencies.md)

## Practice

- [Product Contract](practice-product-contract.md)
- [Piano-Key Domain](practice-piano-key-contract.md)
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
- [ADR 0004: Access, Sharing and Publication](../adr/0004-score-access-sharing-and-publication.md)
- [ADR 0005: Review Before Score Creation](../adr/0005-review-pipeline-before-score.md)
- [ADR 0006: Control-Plane API Boundary](../adr/0006-control-plane-api-boundary.md)
- [ADR 0007: Editor Domain Model](../adr/0007-editor-domain-model.md)
- [ADR 0008: Backend Dependency Authority](../adr/0008-backend-dependency-authority.md)

## Security Boundaries

- [Control-Plane Identity](../security/control-plane-identity-contract.md)
- [Score Access](../security/score-access-contract.md)
