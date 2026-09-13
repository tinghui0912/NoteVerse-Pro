# NoteVerse Documentation

This directory is organized by audience. Keep the root small: active reference
documents live in category folders, and completed migration plans live under
`archive/`.

## Start Here

- Product and UX context: `product/`
- Current technical architecture and ADRs: `adr/`, `architecture/`
- Developer workflows, implementation plans, reviews, and test guidance: `engineering/`
- Kubernetes, CI/CD, observability, runtime operations: `operations/`
- Authentication, authorization, storage access, and product security notes: `security/`
- Completed or historical migration plans: `archive/`

## Product

Documents for product behavior, information architecture, user-facing flows, and
collaboration semantics.

- [Library And My Scores](product/library-and-my-scores.md)
- [Score Invite Collaboration](product/score-invite-collaboration.md)

## Architecture

Documents that define long-lived system boundaries, external dependencies, and
runtime contracts.

- [ADR 0002: Job, Score, And Linear Revisions](adr/0002-job-score-and-linear-revisions.md)
- [ADR 0003: Score Artifacts And Metadata Projection](adr/0003-score-artifacts-and-metadata-projection.md)
- [ADR 0004: Score Access, Sharing, And Publication](adr/0004-score-access-sharing-and-publication.md)
- [ADR 0005: Review Pipeline Before Score](adr/0005-review-pipeline-before-score.md)
- [ADR 0007: Editor Domain Model](adr/0007-editor-domain-model.md)
- [Architecture Index](architecture/README.md)
- [External Dependencies](architecture/integrations/external-dependencies.md)
- [Kubernetes Application Runtime Contract](architecture/runtime/k8s-application-runtime-contract.md)
- [Backend Settings Ownership](architecture/runtime/settings-ownership.md)

## Engineering

Documents for developers working on the application codebase, product logic, and
quality gates.

- [Engineering Index](engineering/README.md)
- [Repository Quality Checks](engineering/guides/repository-quality-checks.md)
- [Import Job Reliability](engineering/plans/import-job-reliability.md)
- [Editor Workbench Plan](engineering/plans/editor-workbench-plan.md)
- [Automatic Beam v2 Plan](engineering/plans/automatic-beam-v2-plan.md)
- [Editor Domain Model Refactoring Plan](engineering/plans/editor-domain-model-refactoring-plan.md)
- [Pending Invites And Notifications Plan](engineering/plans/pending-invites-notifications-plan.md)
- [Practice Score Following Optimization Plan](engineering/plans/practice-score-following-optimization-plan.md)
- [Backend Structured Logging Audit](engineering/reviews/backend-structured-logging-audit.md)

## Security

Documents for security architecture, product security boundaries, and security
cleanup plans.

- [Security Index](security/README.md)
- [Codebase Simplification And Security Plan](security/codebase-simplification-and-security-plan.md)

## Operations

Documents for local Kubernetes validation, deployment, release, observability,
container images, and production readiness.

- [Operations Index](operations/README.md)
- [Docker Backend Runtime Runbook](operations/runbooks/docker-backend-runtime-runbook.md)
- [Container Image Build Strategy](operations/release/container-image-build-strategy.md)
- [CI/CD Release Strategy](operations/release/cicd-release-strategy.md)
- [Production Deployment Guide](operations/deployment/production-deployment-guide.md)
- [Kubernetes Deployment Runbook](operations/deployment/k8s-deployment-runbook.md)
- [Kubernetes Gateway API And TLS](operations/deployment/k8s-gateway-and-tls.md)
- [Kubernetes Production Preflight Checklist](operations/deployment/k8s-production-preflight-checklist.md)
- [Kubernetes Secrets And Storage Template](operations/deployment/k8s-secrets-and-storage-template.md)
- [Minikube From Zero Runbook](operations/runbooks/minikube-from-zero.md)
- [Minikube Local Kubernetes Runbook](operations/runbooks/minikube-local-k8s-runbook.md)
- [Minikube Observability Runbook](operations/observability/minikube-observability-runbook.md)
- [Kubernetes Observability Deployment Skeleton](operations/observability/k8s-observability-deployment-skeleton.md)
- [Kubernetes Logging Plan: Fluent Bit + Loki + Grafana](operations/observability/k8s-logging-loki-fluent-bit-plan.md)
- [OpenTelemetry + Tempo Tracing Plan](operations/observability/opentelemetry-tempo-tracing-plan.md)
- [Observability And Logging Roadmap](operations/observability/observability-and-logging-roadmap.md)
- [Grafana Loki Query Runbook](operations/observability/grafana-loki-query-runbook.md)
- [Grafana Dashboard Requirements](operations/observability/grafana-dashboard-requirements.md)

## Archive

Archive documents record completed migrations and old decision context. They are
not the source of truth for current architecture, but they are useful when
auditing how the project evolved.

- [Archive Index](archive/README.md)
