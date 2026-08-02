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
| Required now | Protect the isolated `/ops` surface. | Explicit action checks, safe diagnostics, and the documented boundary. |
| Required for first operator UI | Make the first real admin client a secure, independently deployable slice. | Control-plane API, independent admin application, operator identity contract, and read-only operation search. |
| Required before production exposure | Permit real operator access beyond local engineering or internal verification. | MFA, dedicated host/session/cookies, Gateway and NetworkPolicy verification; workforce OIDC is optional when a managed identity provider is adopted. |
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

1. [x] Define the provider-neutral operator identity and action-policy contract in
   [Control-Plane Identity Contract](../../security/control-plane-identity-contract.md). The first
   provider is a separate local-password operator domain; a future OIDC binding keeps the same
   authorization and session boundary. Local and CI tests may use deterministic operator identities,
   but they must exercise the same action checks and session boundaries as production rather than
   introduce a permissive bypass.
2. [x] Define the initial concrete role and action mapping. `platform_operator` is explicitly
   authorized for `operations.read` and the existing low-risk `operations.retry` action; do not introduce
   a generic permission table until another real role has a distinct action set.
3. Define the diagnostic allowlist for this slice. The UI may receive only: component, safe category,
   queue or operation type, attempt count, timestamps, stable public code, retryability, and opaque
   request or trace IDs. Raw exceptions, secrets, SQL, full object keys, endpoint URLs, provider-specific
   internals, and unredacted third-party content are forbidden.

### Production Exposure Prerequisites

1. Define the production operator identity model:
   - a dedicated operator identity domain, optionally bound to a workforce OIDC client;
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

- [x] Create a `control_plane_api` FastAPI composition root with only health,
  process metrics, operator authentication, and control-plane routers.
- [x] Move the existing `ops` router out of the customer API as a clean cut.
- [x] Create isolated operator, identity, password-credential, and opaque-session
  persistence models. The TTY-only `backend/scripts/create_operator.py` command
  bootstraps a local-password operator without accepting a password through a
  command argument or environment variable.
- [x] Declare the `control` runtime as a separate, dark-by-default Deployment
  and Service. It remains at zero replicas and internal-only until operator
  authentication and network-policy acceptance tests run against a rendered
  environment.
- [x] Create an internal `observability_exporter` composition root for the
  authoritative database-backed scheduler and asynchronous-operation metrics.
  The customer API retains only request and process metrics; the exporter has
  an internal Service and must be restricted to Prometheus with NetworkPolicy
  before production exposure.
- [x] Remove durable database-backed metrics from the customer API. The exporter
  is the single authoritative scrape target for scheduler and asynchronous-operation state.
- [x] Add a `control` runtime command to the existing image entrypoint and deploy
  it as a separate Kubernetes Deployment and Service.
- Deploy the new runtime dark or internal-only first, verify it, then expose
  only the dedicated control host and remove the old customer `/api/v1/ops`
  route in the same bounded rollout. There is no compatibility route because
  the project is pre-release.

### 2. OpenAPI And Client Contracts

- [x] Publish independent customer and control-plane OpenAPI schemas.
- [x] Maintain separate `customer-api-client` and
  `control-plane-api-client` packages.
- [x] Ensure the customer frontend has no dependency on control-plane types or
  client code.

### 3. Platform Admin Web Application

- [x] Create `apps/platform-admin` as an independent Next.js application with
  its own build and runtime image.
- [x] Implement a minimal `AdminShell`: product identity, environment
  indicator, and sign-out; no customer navigation or workspace components.
- [x] Implement the initial asynchronous-operation search screen with a
  maintained, independent Control Plane client and bounded diagnostics.
- [x] Add a separate Content Security Policy for the independent Admin application.
- [ ] Add browser E2E coverage before any external operator host is enabled.

### 4. Authorization And Audit

- [x] Require `operations.read` at every control-plane query endpoint.
- [x] Enforce authorization through the shared security authorization-policy layer;
  adapters must not own independent authorization rules.
- [x] Keep the explicit diagnostic allowlist from the prerequisites. No raw
  exception, SQL, object key, storage provider, broker, worker, renderer, or
  third-party implementation detail reaches the UI.
- [x] Always record login, authentication failure, and authorization denial in
  security or access logs. Persist durable audit events for sensitive reads,
  exports, and all commands; routine operation listing stays in access logs
  unless the compliance or abuse model requires durable read auditing.

### 5. Verification

- [x] Contract-test every control-plane route for unauthenticated, customer-only,
  and insufficient-operator-action callers.
- Add E2E tests for operator login, unauthorized denial, search, pagination,
  and sign-out.
- Verify Gateway routes only the `control` host to the control-plane Service,
  with no path on the customer `app` or `api` hosts. Verify NetworkPolicy
  admits only selected Gateway data-plane workloads plus required egress
  dependencies; endpoint authorization remains mandatory because NetworkPolicy
  cannot identify the originating browser.
- [x] Verify customer OpenAPI does not list control-plane operations and the
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
