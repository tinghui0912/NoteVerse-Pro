# Control Plane Identity Contract

Operator identity uses local email/password authentication and mandatory TOTP MFA.
`operators` owns email, Argon2id password, encrypted TOTP material, role and status.
`operator_mfa_challenges` owns hashed, single-use, five-minute admission tokens;
`operator_recovery_codes` owns single-use hashed recovery credentials;
`operator_sessions` owns revocable full sessions. Consumer sessions cannot satisfy
operator dependencies, and operator credentials cannot authenticate Consumer routes.

A password success issues only an enrollment/verification challenge. MFA completion
issues a host-only HttpOnly Strict session with two-hour idle and twelve-hour
absolute expiration. Six named permissions map to three code-owned roles:
SUPPORT_READONLY, PLATFORM_OPERATOR and SUPER_ADMIN. Every privileged route checks
its exact permission. Management preserves the last active SUPER_ADMIN.

The Control Plane alone receives `OPERATOR_TOTP_ENCRYPTION_KEY`. PostgreSQL grants
isolate operator credentials from all other runtimes. `ops_audit_events` is the
single append-only security/operations ledger. Operational and management commands
require a trimmed reason; authentication events use server-generated reasons.
Mutation and audit persistence share one transaction. Audit UPDATE/DELETE are
rejected by the runtime's PostgreSQL permissions.

The exact endpoints, cookies, challenge flow, role registry, transaction boundaries
and bootstrap procedure are specified in
[Control Plane Authentication](../architecture/control-plane-auth.md).
Secret and DB ownership follow
[Settings Ownership](../architecture/runtime/settings-ownership.md) and
[Database Role Ownership](../architecture/runtime/database-role-ownership.md).
Gateway, network exposure, deployment clocks and login throttling have separate
runtime/deployment ownership. An internal Service is not proof of production
network isolation.
