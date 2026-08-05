# Operations Control Plane Governance Plan

## Purpose

Keep platform operations in the modular monolith while enforcing a clear
security boundary between customer APIs, platform operator controls, and
observability. This plan deliberately avoids prematurely splitting services or
repositories.

## Current Boundary

`/api/v1/ops` is a platform operator control-plane route namespace. It is
registered only by the isolated `control_plane_api` composition root, never by
the customer API. It owns asynchronous-operation inspection, retry commands,
and operator audit events. The database-backed metrics exporter is a separate,
internal runtime; it is not an operator API.

Prometheus metrics and application telemetry are observability concerns. They
must not be used as a substitute for an operator API, and raw technical logs
must not be returned by either surface.

## Priority Plan

## Delivery Gates

| Gate | Definition | Current interpretation |
| --- | --- | --- |
| Required now | Required to safely operate the isolated `/api/v1/ops` routes. | Public error contracts, explicit actions, safe diagnostics, and separate operator sessions are in place. |
| Required for first operator UI | Required before a formal platform-admin client is introduced. | Independent runtime, client, action checks, and bounded diagnostics are implemented; browser E2E and private-routing acceptance remain. |
| Required before production exposure | Required before real operators can use the control plane. | MFA-capable operator identity, dedicated sessions and host, restrictive Gateway/NetworkPolicy, and rollout verification. |
| Deferred until demonstrated need | A future capability with no current concrete workflow or risk trigger. | Generic permissions, external tamper-evident audit, and broader access infrastructure. |

### P0 - Safe Error and Diagnostic Contracts

- [x] Remove path-based `internal_details` responses from all HTTP errors.
- [x] Ensure authentication, CSRF, validation, application, and unhandled
  errors expose only stable public fields and a request ID.
- [x] Remove raw failure text from operator operation and audit read models.
- [x] Keep only structured operator diagnostics: stable code, stable stage,
  retryability, error class, operation status, attempts, and timestamps.
- [x] Stop persisting raw retry error details in the operator audit table.
- [x] Add contract tests covering unauthenticated and insufficient-operator-action
  access to every operator route.

### P1 - Operator Authorization and Audit Semantics

- [x] Introduce explicit policy actions for `operations.read` and
  `operations.retry` before adding more operator mutations.
- [x] Require a bounded, audited reason for asynchronous-operation retry.
- [ ] Require a bounded, audited reason for future destructive or high-impact
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

- [x] Record the current exposure state: no rendered environment routes the
  dedicated control host yet, so the isolated runtime is not externally
  exposed. The future control host must never be routed through the customer
  `app` or `api` hosts.
- [x] Define the deployment access policy: `admin.<environment-domain>` routes
  only to Platform Admin, whose same-origin BFF reaches the internal
  control-plane Service. `control.<environment-domain>` remains absent until a
  real automation client exists. Ingress NetworkPolicies restrict Platform
  Admin to the Gateway data plane and the control plane to Platform Admin.
- [ ] Before production exposure, bind a workforce identity provider with MFA,
  enforce the production ingress policy, and verify browser E2E over the
  dedicated admin host. NetworkPolicy is defense in depth, not proof of
  browser identity.

### P2 - Module Boundary Refinement

- [x] Move Prometheus projection code from `modules/ops` to an
  `observability` package, keeping operator commands and audit services in
  `modules/ops`.
- [x] Document the distinction between platform operations, future platform
  administration, and customer product APIs in ADR 0006.

### P3 - Dedicated Control-Plane Delivery

- [x] Establish an isolated local-password operator identity domain, opaque
  server-side operator sessions, and a dedicated `control_plane_api` composition
  root. Customer sessions and the customer `/api/v1/ops` route are removed from
  the control-plane authorization path.
- [x] Ship the internal portions of the ADR 0006 vertical slice: separate
  composition root, local-password operator identity, independent Platform Admin client,
  dedicated Admin Gateway route, and ingress NetworkPolicies. MFA-capable
  workforce identity binding, browser E2E, and independent rollback verification
  remain production-exposure gates.
- [x] Make the staging control-plane and Platform Admin replica counts declarative
  rather than relying on manual `kubectl scale`; production stays
  dark-by-default.
- [x] Verify the staging Admin HTTPRoute is accepted and its multi-SAN TLS
  certificate is issued after adding `admin.<environment-domain>`.
- [ ] Recreate the local production-like cluster with Cilium, then prove that
  only Platform Admin reaches the control-plane Service. The previous minikube
  bridge CNI accepted policy objects but did not enforce them.
- [x] Move database-backed scheduler and asynchronous-operation metrics from
  the customer API into the internal `observability_exporter` composition root.
- Keep the shared repository, domain modules, PostgreSQL database, and Alembic
  migration stream. An operations API alone is not a reason to split them.

## Non-Goals

- No immediate microservice split.
- No generic role/permission database schema until multiple platform operator
  roles have concrete, distinct responsibilities.
- No raw exception, stack trace, storage key, secret, SQL, or third-party
  response content in HTTP API responses.
