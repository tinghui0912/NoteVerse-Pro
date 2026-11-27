# ADR 0006: Control-Plane API Boundary

Status: Accepted

## Context

Customer product APIs and privileged operator remediation have different identity,
exposure and audit requirements. They share domain rules and persistence without
sharing HTTP authority.

## Decision

The backend has customer, control-plane and observability composition roots.
They share the modular backend, database and Alembic stream. The API image ships
all three entrypoints, selected by runtime command. Customer OpenAPI excludes
operator routes. The internal observability exporter owns database-backed metrics.

Platform Admin is an independent Next.js application with a same-origin BFF.
Its BFF calls the internal control-plane Service. Operator identity, sessions,
cookie names, CSRF and authorization are separate from customer sessions.
Customer host-only cookies are not widened to a shared parent domain.

The control-plane Deployment/Service is dark by default. A route prefix is not
network isolation. Exposure requires explicit Gateway routing and enforced
NetworkPolicy, in addition to endpoint authorization. NetworkPolicy cannot
identify the originating browser. The customer host must not route operator APIs.

Operations endpoints delegate state changes to owning domain services. They
enforce explicit actions and bounded state validation. Remediation commands
require attributable audit, a bounded reason and appropriate idempotency.
High-impact production actions require step-up/MFA policy before exposure;
the existence of a local operator provider does not establish that qualification.

## Invariants and consequences

- No generic administrative module duplicates domain transaction ownership.
- Operator and customer clients use separate generated OpenAPI contracts. Platform
  Admin consumes the Control Plane SDK; each app has an independently versioned
  browser identity protocol. Success representations are direct and operator errors
  use the Control Plane-owned `ControlPlaneErrorCode` enum and code/request-ID
  schema. Shared HTTP mechanics consume composition-root error policy. See
  [HTTP error contracts](../architecture/http-error-contracts.md).
- Internal diagnostics never become ordinary customer errors or stdout dumps.
- Control-plane rollback and availability can be managed separately from customer
  API, Worker and the internal metrics exporter.
- A deployment must validate its identity/network boundary; a checked-in manifest
  is not proof of enforced reachability or production readiness.

See [Control-Plane Identity Contract](../security/control-plane-identity-contract.md)
and [Kubernetes Runtime Contract](../architecture/runtime/k8s-application-runtime-contract.md).
