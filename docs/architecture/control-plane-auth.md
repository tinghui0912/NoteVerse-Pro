# Control Plane Authentication and Authorization

## Authority

The Control Plane authenticates an operator's email and Argon2id password,
then requires TOTP enrollment or verification. Only completed MFA issues an
operator session. Operator identity, encrypted TOTP secret and current role live
in `operators`. Consumer identity and credentials have separate authorities.

Passwords use NFC normalization, 12–128 characters and reject whitespace-only
input. The bootstrap command is `python scripts/create_operator.py --email
admin@example.com --display-name Admin`; it prompts twice through a TTY and
creates a `SUPER_ADMIN` requiring enrollment. Its explicit `DATABASE_URL` uses
`nv_control_plane`; the command commits its own transaction and does not require
the TOTP encryption key.

## Cookies and lifetimes

| Cookie | Local HTTP | Secure HTTPS | Policy |
| --- | --- | --- | --- |
| MFA challenge | `nv_admin_mfa` | `__Host-nv_admin_mfa` | HttpOnly, SameSite=Strict, Path=/, no Domain; 5-minute hard expiry |
| Operator session | `nv_admin_session` | `__Host-nv_admin_session` | HttpOnly, SameSite=Strict, Path=/, no Domain; 2-hour idle / 12-hour absolute expiry |

Secure names require Secure=true. `ENVIRONMENT=staging` and `production` require
`CONTROL_PLANE_COOKIE_SECURE=true` at startup. Protocol identities are defined in
`contracts/http/control-plane-browser-protocol.json`. Browser protocol projections
are generated for each consumer of that contract.

Challenges contain only a SHA-256 digest of a 256-bit opaque token in PostgreSQL.
They are bound to an operator and purpose, permit five failed verification
attempts, and are single-use. Login consumes prior pending challenges. A
challenge cookie cannot authorize an operator endpoint. Challenge responses,
provisioning secrets and recovery-code responses use `Cache-Control: no-store`.

Sessions are PostgreSQL-authoritative on every request. Idle touches are persisted
at most once per five minutes and never extend the absolute deadline. Logout,
role/status changes, password reset and MFA reset revoke affected sessions;
management changes also invalidate pending challenges. MFA reset removes the
secret and recovery codes and requires enrollment at the next login.

The CSRF cookie/header contract applies to authenticated mutations and challenge
mutations. Login is the explicitly exempt authentication endpoint. Cookie names
and the MFA token are separate from the readable CSRF cookie.

## Authentication API

Paths below are relative to `/api/v1`. Bodies are JSON. Authentication lifecycle
events use server-generated reasons; they do not accept a caller-supplied reason.

| Method / path | Body / authority | Successful response |
| --- | --- | --- |
| POST `/auth/login` | `{email,password}` | 200 `{purpose,expires_at}` and challenge cookie only |
| POST `/auth/mfa/enroll/start` | enrollment challenge | 200 `{secret,otpauth_uri}` |
| POST `/auth/mfa/enroll/confirm` | enrollment challenge, `{code}` | 200 `{operator,recovery_codes}` and full session |
| POST `/auth/mfa/verify` | verification challenge, exactly `{code}` or `{recovery_code}` | 200 `{operator,recovery_codes_remaining}` and full session |
| GET `/auth/me` | full session | 200 operator profile |
| POST `/auth/logout` | full session, no body | 204 and cleared cookies |

`purpose` is `ENROLLMENT_REQUIRED` or `VERIFICATION_REQUIRED`. A code contains six
ASCII digits. Recovery codes contain four groups of five hexadecimal characters,
separated by hyphens. The operator profile contains `operator_id` (UUID), `email`,
`display_name`, `role`, `status`, `permissions` and `totp_enabled`.

TOTP uses RFC 6238 SHA-1, six digits, 30 seconds and ±1 step tolerance. The matched
step must exceed `totp_last_used_step`. Verification locks Operator before
Challenge, serializing enrollment, replay checks and recovery consumption.
Pending and active secrets use authenticated Fernet encryption. Ten 80-bit
recovery codes are returned once at enrollment; only SHA-256 digests are stored.
A recovery code is consumed through a conditional UPDATE in the MFA transaction.
Recovery verification records both verification and consumption events.

## Static permissions

| Role | Permissions |
| --- | --- |
| SUPPORT_READONLY | `operations.read`, `users.read`, `audit.read` |
| PLATFORM_OPERATOR | read-only permissions plus `operations.retry` |
| SUPER_ADMIN | all preceding permissions plus `users.suspend`, `operators.manage` |

`ROLE_PERMISSIONS` belongs to `modules/platform_operators/permissions.py`.
Operator role/status and challenge-purpose enums belong to the pure
`modules/platform_operators/domain.py` taxonomy.
`runtime/control_plane/deps.py::require_permission` protects every diagnostic,
audit, user and management route. Authentication endpoints have their own
challenge/session authority; process health endpoints have process ownership.

| Method / path | Permission | Contract |
| --- | --- | --- |
| GET `/ops/async-operations` | operations.read | filtered offset page |
| GET `/ops/async-operations/summary` | operations.read | summary |
| GET `/ops/async-operations/{kind}/{operation_id}` | operations.read | operation |
| POST `/ops/async-operations/{kind}/{operation_id}/retry` | operations.retry | `{reason}` -> operation |
| GET `/audit-logs` | audit.read | offset page, actor/action/target/outcome/time filters |
| GET `/operators` | operators.manage | offset page of profiles |
| POST `/operators` | operators.manage | `{email,password,display_name,role,reason}` -> 201 profile |
| PATCH `/operators/{operator_id}` | operators.manage | `{role,status,reason}` -> profile |
| POST `/operators/{operator_id}/mfa/reset` | operators.manage | `{reason}` -> 204 |
| POST `/operators/{operator_id}/password/reset` | operators.manage | `{password,reason}` -> 204 |
| GET `/users` | users.read | offset page of `{user_id,email,display_name,is_active}` |
| PUT `/users/{user_id}/status` | users.suspend | `{is_active,reason}` -> 204 |

Management and operational reasons are trimmed strings of 3–500 characters.
Operator status is `active` or `disabled`. Management operations serialize through
one transaction advisory lock before locking Operator rows, revalidate the actor,
and cannot disable or demote the last active SUPER_ADMIN.
Logout locks Operator before Session. Operational retries acquire a shared
Operator admission lock and revalidate session/permission before business rows;
audit foreign-key checks therefore cannot reverse management lock order. An admitted in-flight
request has its own transaction; subsequent requests revalidate session and role.

Customer directory/status access uses two schema-qualified SECURITY DEFINER
functions with a fixed `search_path=pg_catalog`. The runtime has no direct
customer credential or session-table access. Suspension locks the User, sets
`is_active=false` and expires existing session idle deadlines in the same
transaction. Re-enabling does not restore those sessions. A tombstoned identity
cannot be re-enabled. Redis hints do not replace Consumer PostgreSQL authority.

## Audit and database permissions

`ops_audit_events` is the single audit ledger. Events contain actor operator ID,
action, target type/ID, reason, outcome, bounded metadata, IP, user agent, request
ID, creation time and optional state/error facts. Operator lifecycle changes
include before/after role, status and MFA-enabled facts. Tokens, TOTP secrets, recovery
codes, passwords and encryption keys are excluded.

Security events include login failure, password verification, enrollment start,
enrollment success, MFA verification/failure, recovery consumption and logout.
Success writes the state change and audit in one transaction. Authentication
failure commits only intentional failure/attempt facts. Retry failure rolls back
the domain mutation through a savepoint before persisting its failed audit.
Audit persistence failure prevents committing the associated mutation.

Only `nv_control_plane` accesses operator, challenge, recovery and session tables.
It has SELECT/INSERT/UPDATE on operators and sessions; challenge/recovery cleanup
also permits DELETE. Audit grants are strictly SELECT/INSERT plus sequence USAGE:
UPDATE and DELETE are denied by PostgreSQL. Other runtimes have no operator or
audit credentials. See [database role ownership](runtime/database-role-ownership.md).

`OPERATOR_TOTP_ENCRYPTION_KEY` is a separately generated Fernet key present only in
Control Plane settings and `noteverse-control-plane-secret`. Generate it with
`cryptography.fernet.Fernet.generate_key()`, provision outside Git and retain it
with the encrypted database backups. Replacing the key requires an explicit
re-encryption or supervised MFA-reset procedure; arbitrary replacement makes
existing encrypted secrets unreadable. Runtime startup validates its format.
Rate limiting, deployment clock synchronization and managed secret rotation have
operational ownership; recovery codes do not bypass password or challenge checks.
