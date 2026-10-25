# Control-Plane Identity Contract

## Identity boundary

The operator surface uses a dedicated local-password identity domain. Platform
Admin's same-origin BFF reaches the internal control-plane Service. Customer
sessions and account attributes cannot satisfy operator dependencies, and
operator credentials cannot authenticate customer routes. Public exposure is
not implied by the presence of the internal Service.

`operators` owns authorization principal and lifecycle state;
`operator_identities` owns provider/issuer/subject binding;
`operator_password_credentials` owns password verification; and
`operator_sessions` owns opaque revocable sessions. Email is not a cross-provider
primary key. The implemented provider is `local_password`.

Every request resolves an `OperatorPrincipal` with operator identity, provider,
issuer, subject and session context. Action policy maps `platform_operator` to
`operations.read` and `operations.retry`. Retry remains bounded by the operation's
allowlist, current state and audit requirements; a role does not authorize an
arbitrary task or state mutation.

## Sessions, cookies and bootstrap

Only the one-way hash of the opaque session credential is stored. The raw
credential belongs in a host-only HttpOnly cookie, never customer JWT/refresh
tables or shared parent-domain cookies. The CSRF cookie/header contract is
separate from customer CSRF. Production cookies require Secure, `/` scope and
explicit SameSite policy.

Control-plane startup requires its own cookie names, CSRF header, Secure and
SameSite settings, session lifetime and CORS origins. Missing values fail startup
rather than inheriting customer defaults. Customer-only startup need not supply
operator configuration.

Local credentials use the approved adaptive password hash. Bootstrap uses the
TTY-only operator command with hidden input. Passwords do not belong in command
arguments, environment values, logs or API response bodies. Inactive operators
and revoked sessions are denied. Production exposure requires qualified login
throttling and MFA; local-password support alone does not establish that readiness.

## Authorization, audit and privacy

Endpoints enforce named actions server-side. Domain modules own the business
transaction; control-plane adapters own bounded management DTOs and audit
orchestration. Sensitive commands require a reason, state validation and
appropriate idempotency. Durable audit records identify the operator and
authenticated identity binding, not a customer `users.id` impersonation.

Authentication/authorization failures use request-correlated bounded security
events. Email, raw provider claims, credentials, cookies, provider responses and
implementation diagnostics do not belong in ordinary responses/logs/audit payloads.
Sensitive diagnostics use their explicit privileged data contract.

## Verification contract

Tests reject customer credentials, inactive operators, revoked sessions, missing
CSRF and insufficient actions; they verify cookie audience separation, bounded
retry and audit evidence. Network isolation, public-host routing, MFA and
independent rollback additionally require environment qualification.
See [Control-Plane Boundary](../adr/0006-control-plane-api-boundary.md).
