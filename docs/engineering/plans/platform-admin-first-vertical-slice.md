# Platform Admin First Vertical Slice Plan

## Purpose

Deliver the first real platform-management capability without turning the
customer API, the operations module, or a future admin application into a
catch-all control surface.

This plan implements the delivery sequence in ADR 0006. It is deliberately a
vertical slice: identity, authorization, contract, audit, UI, deployment, and
tests must be exercised together before any high-impact operator action is
added.

## Delivery Gates

| Gate | Meaning | Scope in this plan |
| --- | --- | --- |
| Required now | Protect the existing transitional `/ops` surface. | Explicit action checks, safe diagnostics, and the documented boundary. |
| Required for first operator UI | Make the first real admin client a secure, independently deployable slice. | Control-plane API, independent admin application, operator identity contract, and read-only operation search. |
| Required before production exposure | Permit a real workforce audience beyond local engineering or internal verification. | Production identity provider, MFA, dedicated host/session/cookies, Gateway and NetworkPolicy verification. |
| Deferred until demonstrated need | Do not build platform machinery without a concrete risk or workflow. | Generic RBAC/ABAC, tamper-evident external audit, Zero Trust/VPN/WAF policy, and multi-role administration. |

## Scope

The first slice is a **read-only asynchronous-operation search** for platform
operators. The underlying `ops` query capabilities already exist, so this
slice validates the new control-plane boundary without inventing a duplicate
user-management query model.

It does not add retry, delete, restore, billing correction, user suspension,
or content moderation to the new management UI.

## Preconditions

### Development Contract Prerequisites

1. Define a provider-neutral operator identity and action-policy contract. Local and CI tests may use
   deterministic operator identities, but they must exercise the same audience, action checks, and
   session boundaries as production rather than introduce a permissive bypass.
2. Define the initial concrete roles and action mapping. The minimum role is `platform_operator` with
   `operations.read`; do not introduce a generic permission table until another real role has a distinct
   action set.
3. Define the diagnostic allowlist for this slice. The UI may receive only: component, safe category,
   queue or operation type, attempt count, timestamps, stable public code, retryability, and opaque
   request or trace IDs. Raw exceptions, secrets, SQL, full object keys, endpoint URLs, provider-specific
   internals, and unredacted third-party content are forbidden.

### Production Exposure Prerequisites

1. Define the workforce identity model:
   - a dedicated operator audience/client;
   - MFA-capable authentication;
   - host-only control-plane session and CSRF cookie names;
   - short operator session lifetime;
   - a step-up policy for future high-impact commands.
2. Define the control-plane production access policy:
   - `admin.<environment-domain>` for the management web application;
   - `control.<environment-domain>` for the control-plane API;
   - dedicated Gateway/HTTPRoute and NetworkPolicy;
   - trusted-proxy configuration before recording a real forwarded source IP.

## Delivery Steps

### 1. Control-Plane Runtime

- Create a `control_plane_api` FastAPI composition root with only health,
  process metrics, operator authentication, and control-plane routers.
- Move the existing `ops` router out of the customer API as a clean cut.
- Create an internal `observability_exporter` composition root for the
  authoritative database-backed scheduler and asynchronous-operation metrics.
  The customer API retains only request and process metrics; the exporter is
  exposed only to Prometheus through an internal Service and NetworkPolicy.
- The exporter migration is conditional for the first slice: ship it with the
  slice when it does not materially increase delivery risk; otherwise retain
  the current customer API projection temporarily, create a tracked migration
  issue with an owner and due release, and complete the move before the
  control-plane surface receives high-impact commands.
- Add a `control` runtime command to the existing image entrypoint and deploy
  it as a separate Kubernetes Deployment and Service.
- Deploy the new runtime dark or internal-only first, verify it, then expose
  only the dedicated control host and remove the old customer `/api/v1/ops`
  route in the same bounded rollout. There is no compatibility route because
  the project is pre-release.

### 2. OpenAPI And Client Contracts

- Publish independent customer and control-plane OpenAPI schemas.
- Generate or maintain separate `customer-api-client` and
  `control-plane-api-client` packages.
- Ensure the customer frontend has no dependency on control-plane types or
  client code.

### 3. Platform Admin Web Application

- Create `apps/platform-admin` as an independent Next.js application.
- Implement a minimal `AdminShell`: product identity, signed-in operator,
  environment indicator, and sign-out; no customer navigation or workspace
  components.
- Implement only the asynchronous-operation search screen, with bounded
  diagnostics and pagination from the control-plane contract.
- Use a separate Content Security Policy, environment configuration, test
  suite, and deployment pipeline.

### 4. Authorization And Audit

- Require `operations.read` at every control-plane query endpoint.
- Enforce authorization through the shared security authorization-policy layer;
  adapters must not own independent authorization rules.
- Keep the explicit diagnostic allowlist from the prerequisites. No raw
  exception, SQL, object key, storage provider, broker, worker, renderer, or
  third-party implementation detail reaches the UI.
- Always record login, authentication failure, and authorization denial in
  security or access logs. Persist durable audit events for sensitive reads,
  exports, and all commands; routine operation listing stays in access logs
  unless the compliance or abuse model requires durable read auditing.

### 5. Verification

- Contract-test every control-plane route for unauthenticated, customer-only,
  and insufficient-operator-action callers.
- Add E2E tests for operator login, unauthorized denial, search, pagination,
  and sign-out.
- Verify Gateway routes only the `control` host to the control-plane Service,
  with no path on the customer `app` or `api` hosts. Verify NetworkPolicy
  admits only selected Gateway data-plane workloads plus required egress
  dependencies; endpoint authorization remains mandatory because NetworkPolicy
  cannot identify the originating browser.
- Verify customer OpenAPI does not list control-plane operations and the
  customer bundle does not import the control-plane API client.
- Test a rollback of the control-plane Deployment independently of customer
  API and worker workloads.

## Follow-up Slices

1. Low-risk command: retry only an allowlisted, proven-idempotent failed
   operation type. Revalidate state server-side; require a bounded reason;
   persist an idempotency relation or key; and link the retry audit event to
   the original operation.
2. Security command: revoke a user session with idempotency and before/after
   state audit.
3. High-impact platform actions only after step-up authentication, required
   reason, state-machine validation, and review requirements are implemented.

## Non-Goals

- No separate repository, database, or Alembic migration stream.
- No control-plane microservice split.
- No shared customer/operator cookie domain.
- No generic RBAC or ABAC schema before real roles and resource scopes demand
  it.
- No admin UI that exposes raw operational logs or internal failure text.
