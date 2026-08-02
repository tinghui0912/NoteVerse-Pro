# Operations Control Plane Governance Plan

## Purpose

Keep platform operations in the modular monolith while enforcing a clear
security boundary between customer APIs, platform operator controls, and
observability. This plan deliberately avoids prematurely splitting services or
repositories.

## Current Boundary

`/api/v1/ops` is a platform operator control plane. It is not a customer API
and is currently protected by the platform administrator dependency. It owns
asynchronous-operation inspection, retry commands, and operator audit events.

Prometheus metrics and application telemetry are observability concerns. They
must not be used as a substitute for an operator API, and raw technical logs
must not be returned by either surface.

## Priority Plan

## Delivery Gates

| Gate | Definition | Current interpretation |
| --- | --- | --- |
| Required now | Required to safely operate the existing transitional `/api/v1/ops` routes. | Public error contracts, explicit actions, and safe diagnostics are already in place. |
| Required for first operator UI | Required before a formal platform-admin client is introduced. | ADR 0006 composition root, independent client contract, and control-plane authorization tests. |
| Required before production exposure | Required before a real workforce audience can use the control plane. | MFA-capable identity, dedicated sessions and host, restrictive Gateway/NetworkPolicy, and rollout verification. |
| Deferred until demonstrated need | A future capability with no current concrete workflow or risk trigger. | Generic permissions, external tamper-evident audit, and broader access infrastructure. |

### P0 - Safe Error and Diagnostic Contracts

- [x] Remove path-based `internal_details` responses from all HTTP errors.
- [x] Ensure authentication, CSRF, validation, application, and unhandled
  errors expose only stable public fields and a request ID.
- [x] Remove raw failure text from operator operation and audit read models.
- [x] Keep only structured operator diagnostics: stable code, stable stage,
  retryability, error class, operation status, attempts, and timestamps.
- [x] Stop persisting raw retry error details in the operator audit table.
- [x] Add contract tests covering unauthenticated and non-admin access to
  every operator route.

### P1 - Operator Authorization and Audit Semantics

- [x] Introduce explicit policy actions for `operations.read` and
  `operations.retry` before adding more operator mutations.
- [ ] Require a bounded, audited reason for destructive or high-impact
  operator actions such as delete, restore, and forced state transitions.
- [x] Extend retry audit events with request ID, peer address, optional bounded
  reason, and previous/new state without duplicating raw request bodies or logs.
- [x] Implement a strict trusted-proxy policy: untrusted peers cannot supply a
  forwarding-header address, while audits retain the proxy peer and resolved
  client address separately.
- [ ] Configure and verify the exact Gateway data-plane CIDR allowlist in each
  rendered environment before relying on resolved client addresses for an
  operator investigation.

### P1 - Exposure Review

- [x] Verify every environment's Gateway/HTTPRoute treatment of `/api/v1/ops`.
  Current staging and production overlays route the broad public `/api/v1`
  prefix to the API Deployment, so `/ops` is currently protected by
  application authorization rather than network isolation.
- [ ] Define the production access policy: strong administrator authentication
  now; internal hostname, network policy, and restricted ingress when an
  operator UI or automation client is introduced. ADR 0006 defines the target
  identity, host, and deployment boundaries; implementation remains gated on
  the first real control-plane vertical slice.

### P2 - Module Boundary Refinement

- [x] Move Prometheus projection code from `modules/ops` to an
  `observability` package, keeping operator commands and audit services in
  `modules/ops`.
- [x] Document the distinction between platform operations, future platform
  administration, and customer product APIs in ADR 0006.

### P3 - Dedicated Control-Plane Delivery

- [ ] Before a formal operator client or high-impact command is exposed, ship
  the ADR 0006 control-plane vertical slice: separate composition root,
  workforce identity, `control` host, restrictive Gateway/NetworkPolicy, and
  independent rollback verification.
- [ ] Move database-backed scheduler and asynchronous-operation metrics from
  the customer API into the internal `observability_exporter` composition root
  as part of that same exercised delivery slice when it does not materially
  increase delivery risk. Otherwise record an owned, release-bounded migration
  and complete it before high-impact control-plane commands are introduced.
- [ ] Do not split repositories or databases solely because an operations API
  exists.

## Non-Goals

- No immediate microservice split.
- No generic role/permission database schema until multiple platform operator
  roles have concrete, distinct responsibilities.
- No raw exception, stack trace, storage key, secret, SQL, or third-party
  response content in HTTP API responses.
