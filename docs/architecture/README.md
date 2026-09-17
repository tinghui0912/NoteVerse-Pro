# Architecture Documents

Architecture documents define long-lived system boundaries and runtime
contracts. If a decision has strong tradeoffs or must be preserved historically,
write an ADR under `../adr/`.

## Runtime

- [Kubernetes Application Runtime Contract](runtime/k8s-application-runtime-contract.md)
- [Runtime Dependency Ownership](runtime/runtime-dependency-ownership.md)
- [Backend Settings Ownership](runtime/settings-ownership.md)

## Control Plane

- [Control Plane API Boundary](../adr/0006-control-plane-api-boundary.md)
- [Control-Plane Identity Contract](../security/control-plane-identity-contract.md)

## Integrations

- [External Dependencies](integrations/external-dependencies.md)

## Related ADRs

- [ADR 0002: Job, Score, And Linear Revisions](../adr/0002-job-score-and-linear-revisions.md)
- [ADR 0003: Score Artifacts And Metadata Projection](../adr/0003-score-artifacts-and-metadata-projection.md)
- [ADR 0004: Score Access, Sharing, And Publication](../adr/0004-score-access-sharing-and-publication.md)
- [ADR 0005: Review Pipeline Before Score](../adr/0005-review-pipeline-before-score.md)
- [ADR 0006: Control Plane API Boundary](../adr/0006-control-plane-api-boundary.md)
- [ADR 0007: Editor Domain Model](../adr/0007-editor-domain-model.md)
