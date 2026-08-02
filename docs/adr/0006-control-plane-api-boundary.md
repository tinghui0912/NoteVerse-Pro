# ADR 0006: Establish A Separate Control Plane API Boundary

- Status: Accepted
- Date: 2026-08-02
- Scope: Platform administration, operations APIs, authentication audiences, and HTTP deployment boundaries

## Context

NoteVerse has two distinct internal use cases:

- customer product APIs serve accounts, scores, imports, collaboration, sharing, and practice;
- the control plane serves platform operators who inspect or remediate asynchronous operations and will
  later manage users, content, subscriptions, and security events.

The `/api/v1/ops` routes are correctly protected by explicit action policies and are registered only
by the isolated control-plane composition root. A dedicated runtime and Service
are declared dark-by-default, but no Gateway route exposes a dedicated control
host yet. A path prefix is not a security or deployment boundary, and route
obscurity is not a security control.

The current customer authentication cookies are host-only cookies issued by the customer API. They must
not be widened to `Domain=.noteverse.com` to make a future `admin` host work. Doing so would couple a
high-privilege control plane to the customer session boundary.

At the same time, the platform administration view is not a new business domain. Users, scores,
billing, and other domain modules must retain ownership of their rules, transactions, and persistence.
Creating a separate service, database, or repository now would duplicate those rules and introduce
distributed transaction complexity without a present isolation requirement.

## Decision

1. Keep a single repository, shared domain modules, PostgreSQL database, Alembic migration stream, and
   asynchronous infrastructure.
2. When the first real platform-management vertical slice ships, introduce two explicit HTTP composition
   roots from the same codebase:
   - `customer_api` for customer-facing product APIs;
   - `control_plane_api` for platform administration and operations APIs.
3. Run the control-plane application as a separate runtime and Kubernetes Deployment when it is exposed
   to an operator UI or automation client. It may share an image build with the customer API, but it has
   its own startup command, Service, Gateway/HTTPRoute, OpenAPI document, metrics scrape target, CORS
   policy, and NetworkPolicy.
4. Do not treat a mounted FastAPI sub-application or a route prefix as network isolation. Mounted
   sub-applications are allowed only as a routing/documentation mechanism, never as the control-plane
   security boundary.
5. Keep `ops` limited to runtime operations such as asynchronous operation inspection, retry, and
   repair. A future `platform_admin` adapter owns management DTOs and audit orchestration only. Endpoint
   authorization is enforced through a shared security authorization-policy layer, and business changes
   are delegated to the owning domain modules.
6. Use distinct authorization actions, for example:
   - `operations.*` for runtime remediation;
   - `platform.users.*`, `platform.scores.*`, and `platform.billing.*` for platform administration;
   - `support.*` and `security.*` when those responsibilities become concrete.
   Do not introduce a generic permission database until at least two operator roles have real and
   different responsibilities.
7. A control-plane deployment requires a separate operator identity domain, session, and cookie names.
   Its initial provider may be local username/password; a future workforce OIDC provider binds to the
   same operator domain rather than replacing it. It must not accept a customer session as proof of
   operator identity. Production exposure requires MFA, short session lifetime, and step-up
   authentication for high-impact actions.
8. Control-plane actions that delete, restore, force state transitions, or alter billing require a
   bounded reason, server-side authorization, resource/state validation, idempotency where applicable,
   and append-only audit records with before/after state. "Immutable" means that the application offers
   no normal update or delete path for audit events, database permissions restrict mutation, retention is
   explicit, and higher-assurance deployments add protected export or tamper-evident evidence.
9. Database-backed operational metrics are not a permanent responsibility of the customer API. The
   target owner is a small internal `observability_exporter` composition root that exposes only
   `/metrics`, reads the required database state, and is reachable only by Prometheus. The exporter ships
   with the first externally exposed control-plane slice, not as an unexercised empty runtime.

## Target Topology

```text
customer-web             -> app.noteverse.com
customer-api             -> api.noteverse.com

platform-admin           -> admin.noteverse.com
control-plane-api        -> control.noteverse.com
```

The Gateway routes only `control.<environment-domain>` to the control-plane Service; neither `app` nor
`api` host routes may reach it. NetworkPolicy admits traffic only from the selected Gateway data-plane
workloads and permits only the control plane's required egress dependencies. NetworkPolicy cannot prove
which browser initiated a request, so the API continues to enforce authorization for every endpoint;
network controls are defense in depth. Production may additionally require Zero Trust, VPN, WAF policy,
or an enterprise identity provider.

## Delivery Sequence

1. Define a provider-neutral operator identity contract, local-password session model, MFA and
   step-up rules, and a future OIDC binding model. Development may use deterministic test identities,
   but must not introduce a permissive production bypass.
2. Create `control_plane_api` and `observability_exporter` composition roots,
   then deploy the control plane dark and the exporter internal-only. Move the
   existing `ops` router as a clean cut and remove it from the customer API; do
   not leave a customer API compatibility route.
3. Create an independent `platform-admin` Next.js application and separate control-plane OpenAPI client.
4. Verify authorization, audit semantics, independent rollback, and internal connectivity before adding
   any public Gateway route.
5. Route only the dedicated `control` host to the new service, verify the operator client, then remove
   any transitional public exposure in the same bounded rollout. Do not maintain two public control
   surfaces for an extended period.
6. Add low-risk writes before high-impact operations. Add explicit reasons and state transition auditing
   to every high-impact command.

## Consequences

- The customer API no longer accumulates high-privilege routes indefinitely.
- Domain rules remain reusable and are not copied into an admin God module.
- Customer and operator clients receive separate OpenAPI contracts and cannot accidentally import each
  other's API client package.
- The current API has no empty control-plane composition root or unsafe shared-cookie fallback. The
  first implementation must satisfy the identity and deployment prerequisites above.
- A future dedicated control-plane runtime is an independently deployable part of a modular monolith;
  it is not a microservice split or a database split.

## Rejected Alternatives

- Keep all future administration routers in the customer API permanently: rejected because API exposure,
  authentication audience, documentation, and deployment policy would remain coupled.
- Create a separate admin service and database immediately: rejected because it duplicates domain logic
  and creates cross-service consistency concerns before there is a demonstrated need.
- Share customer cookies across all NoteVerse subdomains: rejected because it weakens the privilege
  boundary between customer and workforce sessions.
- Add an empty control-plane runtime before a real vertical slice: rejected because unexercised
  infrastructure and compatibility paths become maintenance debt.
