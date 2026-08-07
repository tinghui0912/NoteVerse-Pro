# Control-Plane Identity Contract

## Purpose

Define the identity boundary required by ADR 0006 before NoteVerse exposes a
control-plane API or operator web application. The initial implementation uses
a dedicated local username/password identity domain. A future workforce OIDC
provider may be bound to the same operator account without changing the
control-plane authorization, session, or audit model.

The contract applies to the operator surface. The first browser surface is
`admin.<environment-domain>`; its same-origin BFF reaches the internal
control-plane Service. `control.<environment-domain>` is optional and exists
only when a real automation or direct API client requires a separately exposed
operator API. The contract does not apply to customer product hosts.

## Security Boundary

Customer identities and operator identities are separate security audiences.

- Customer sessions authenticate a product user to same-origin customer
  `/api/v1/*` routes on the product host.
- Operator sessions authenticate a platform operator to the control-plane
  boundary, initially through `admin.<environment-domain>` and its BFF.
- A customer access token, refresh token, CSRF cookie, or any customer-account
  attribute must never satisfy a control-plane dependency.
- A control-plane session must not be accepted by customer API routes.

The existing `users` table remains the customer identity model. It is not an
operator directory and must not acquire workforce-only roles or permission
columns merely to bootstrap the control plane.

## Operator Identity Model

The operator domain owns the following records:

```text
operators
  = authorization principal and lifecycle state

operator_identities
  = provider binding: provider, issuer, stable subject

operator_password_credentials
  = local-password verifier only

operator_sessions
  = opaque, revocable browser sessions
```

`operator_identities` makes the authentication source extensible without
coupling authorization to a provider. The initial provider is
`local_password`, whose normalized subject is the operator login name. A later
OIDC binding stores its exact issuer and stable opaque subject on a second
identity record. Email may be a display or login attribute but is never the
cross-provider primary key.

Every authenticated control-plane request resolves to an `OperatorPrincipal`:

| Attribute | Requirement |
| --- | --- |
| `operator_id` | Stable internal operator identifier used for authorization and audit. |
| `identity_provider` | Authenticated provider, initially `local_password`. |
| `issuer` | Provider issuer identifier; explicit even for the local provider. |
| `subject` | Stable provider subject; never a customer user ID. |
| `session_id` | Opaque, revocable server-side session identifier. |
| `authenticated_at` | Authentication time used by future step-up policy. |
| `roles` | Application roles mapped by policy to explicit actions. |

The initial concrete role is `platform_operator`, mapped only to
`operations.read`. `operations.retry` remains a separate policy decision. Do
not create a generic permission database until at least two real operator
roles have different action sets.

## Session And Cookie Requirements

The initial browser session is an opaque random credential. Only its
one-way hash is stored in `operator_sessions`; the raw value exists only in
the host-only `HttpOnly` cookie. Operator sessions do not reuse customer JWTs,
refresh tokens, token tables, signing keys, or cookie helpers.

The control-plane runtime requires separately configured values:

```text
CONTROL_PLANE_AUTH_COOKIE_NAME
CONTROL_PLANE_CSRF_COOKIE_NAME
CONTROL_PLANE_CSRF_HEADER_NAME
CONTROL_PLANE_COOKIE_SECURE
CONTROL_PLANE_COOKIE_SAMESITE
CONTROL_PLANE_SESSION_EXPIRE_MINUTES
CONTROL_PLANE_CORS_ORIGINS
```

Production cookie values must be `Secure`, host-only (no `Domain` attribute),
scoped to `/`, and use an explicit same-site policy. The session cookie is
`HttpOnly`; the CSRF cookie is readable only so the browser can echo it in the
configured header. Customer cookie names are never reused.

These settings may be absent when the customer API is the only runtime. The
`control_plane_api` startup path must require every one explicitly and fail
fast when any value is missing. It must not silently inherit customer settings
or provide development defaults.

## Password And Bootstrap Requirements

Local password credentials use the project-approved adaptive password hash.
Passwords are never accepted through command-line arguments, logs, audit
payloads, environment variables, or normal API response bodies. The initial
operator is created through a TTY-only administrative command using hidden
input, or an equivalent one-time bootstrap secret delivery mechanism.

The first local-password implementation includes generic authentication
failures, session revocation, and an operator lifecycle state. Login throttling
and MFA are mandatory before any public production exposure. The initial MFA
mechanism may be TOTP or a future workforce identity provider, but the
application session and authorization boundary remain independent.

## Future OIDC Binding

OIDC is an optional future identity provider, not a replacement for the
operator domain. The verifier validates signature, exact issuer, audience,
expiry, token type, and stable subject before binding an identity to an
existing operator. The application then creates the same opaque control-plane
session and evaluates the same action policy.

No OIDC claim, customer JWT, customer database role, header, environment flag,
or localhost shortcut grants an operator action directly.

## Development And CI

Development and CI create deterministic operator records through the same
operator domain and exercise the same cookie, CSRF, authorization, and audit
boundaries as production. They may use deterministic local credentials or a
test OIDC provider, but must not use an authorization bypass.

The following are prohibited in every non-test runtime:

- accepting a customer JWT as an operator session;
- treating a customer database role as operator authentication;
- a header, environment flag, or localhost shortcut that grants operator
  actions without a verified operator session; and
- a permissive fallback issuer, audience, signing key, or cookie name.

## Authorization, Audit, And Privacy

The shared authorization-policy layer maps an `OperatorPrincipal` to named
actions such as `operations.read`. Control-plane adapters do not own separate
role checks.

Authentication failures, authorization denials, and sensitive commands are
recorded in security or access logs with a request ID and opaque operator
identity reference. Durable audit records store `operator_id` plus an identity
provider/issuer/subject snapshot; they never use a customer `users.id` as the
control-plane actor.

Email addresses, raw identity-provider claims, passwords, access tokens,
cookie values, provider responses, and implementation diagnostics are
forbidden from HTTP responses and normal audit payloads.

## Acceptance Tests For The First Slice

Before exposing a control host, automated tests must prove that:

1. a customer access token and customer cookies are rejected by every
   control-plane route;
2. an inactive operator, revoked session, invalid CSRF token, and insufficient
   operator action are rejected;
3. a verified `platform_operator` can call only `operations.read`;
4. operator and customer cookie names cannot authenticate the other surface;
5. CSRF is enforced for cookie-authenticated control-plane writes; and
6. every sensitive command and authorization denial has request-correlated
   security or durable audit evidence without exposing secret material.

## Deferred Decisions

This contract intentionally does not select a workforce OIDC provider, build a
generic role-management database, or define a second operator role. Those
become concrete only when a production workforce integration or a distinct
operator responsibility is required.
