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
- [ ] Add a trusted-proxy policy before recording a separately named real
  client source IP from forwarded headers.

### P1 - Exposure Review

- [x] Verify every environment's Gateway/HTTPRoute treatment of `/api/v1/ops`.
  Current staging and production overlays route the broad public `/api/v1`
  prefix to the API Deployment, so `/ops` is currently protected by
  application authorization rather than network isolation.
- [ ] Define the production access policy: strong administrator authentication
  now; internal hostname, network policy, and restricted ingress when an
  operator UI or automation client is introduced. The production preflight
  checklist now makes these prerequisites explicit.

### P2 - Module Boundary Refinement

- [x] Move Prometheus projection code from `modules/ops` to an
  `observability` package, keeping operator commands and audit services in
  `modules/ops`.
- [ ] Document the distinction between platform operations, future workspace
  administration, and customer product APIs.

### P3 - Deployment Isolation When Justified

- [ ] Evaluate a separate operations Deployment from the same repository only
  when network isolation, release cadence, resource isolation, or compliance
  requires it.
- [ ] Do not split repositories or databases solely because an operations API
  exists.

## Non-Goals

- No immediate microservice split.
- No generic role/permission database schema until multiple platform operator
  roles have concrete, distinct responsibilities.
- No raw exception, stack trace, storage key, secret, SQL, or third-party
  response content in HTTP API responses.
