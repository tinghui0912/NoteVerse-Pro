# Consumer Sessions

## Authority and credentials

Customer API owns authentication for individual users. `user_sessions` is the
authoritative session ledger. Each login generates a fresh URL-safe credential
from 32 CSPRNG bytes. PostgreSQL and Redis keys contain only its SHA-256 hex
digest. API responses and session lists contain neither credentials nor digests.
Operator authentication has a separate domain and ledger.

`app/platform/security/` owns password hashing, opaque-token primitives and cookie
construction. These primitives depend on neither runtime nor domain modules.
Consumer registration, password change and password reset normalize Unicode to
NFC, require 12–128 characters and reject whitespace-only passwords. Argon2id is
the sole password hashing algorithm. Login normalizes the supplied password to
the same Unicode form before verification.

## Ledger and lifetime

| Field | Contract |
| --- | --- |
| `id` | UUID primary key, safe device identifier |
| `user_id` | Indexed User FK, `ON DELETE CASCADE` |
| `token_hash` | Unique indexed lowercase 64-character SHA-256 hex |
| `created_at`, `last_seen_at` | UTC instants |
| `idle_expires_at` | Sliding 14-day deadline, capped by absolute deadline |
| `absolute_expires_at` | 30-day deadline fixed at issuance |
| `revoked_at`, `revoked_reason` | Both null or both populated; typed reason |
| `ip_address`, `user_agent` | Optional bounded device metadata, 64/512 characters |

The database constrains digest shape, paired revocation facts and lifetime order.
Authentication checks both deadlines, revocation and active, non-tombstoned User
state on every request. Device lists include only unrevoked, unexpired sessions.
Touches use an independent short transaction and conditional UPDATE; they occur
only when `last_seen_at` is at least 600 seconds old. They never extend the
absolute deadline. Defaults are explicit Customer API settings:
`SESSION_IDLE_DAYS=14`, `SESSION_ABSOLUTE_DAYS=30`,
`SESSION_TOUCH_INTERVAL_SECONDS=600`, `SESSION_CACHE_TTL_SECONDS=120`.

## Cache and revocation

Redis stores read-through identity hints at `consumer-session:<digest>` with a
120-second TTL, capped by remaining lifetime. A hint accelerates identity
selection; it does not authorize access. PostgreSQL checks the current session
and User state even on a cache hit. Redis read/write/eviction failures produce
safe warning events and do not grant authority. Cache refresh racing revocation
cannot restore access. This design retains a database authorization read for
every authenticated request.

Revocation uses `UPDATE ... RETURNING token_hash` in the command transaction.
After the successful outer commit, Redis pipeline DEL invalidates every returned
digest. Rollback discards pending evictions. A Redis outage after commit leaves
the database revocation effective and cannot turn the command into active access.

Login, credential mutations and account closure acquire the User row using
`FOR NO KEY UPDATE` before session mutation. Closure atomically tombstones the
User, invalidates email credentials, revokes sessions and persists its deletion
operation. A login winning the User lock can commit a session that the subsequent
closure revokes; closure winning the lock prevents session issuance. Bounded
account erasure removes session history before deleting the User.

Only `nv_customer_api` has direct SELECT/INSERT/UPDATE on `user_sessions`.
Worker, Control Plane, Beat and Exporter have no direct privileges. The Worker
uses the guarded, bounded `nv_erase_closed_authentication_history` function for
closed-account history erasure. Migrator owns the schema. See
[Database Role Ownership](runtime/database-role-ownership.md).

## Cookies and request protection

| Deployment | Session cookie |
| --- | --- |
| Local HTTP, `AUTH_COOKIE_SECURE=false` | `nv_session`, HttpOnly, Path=/, SameSite=Lax, no Domain |
| HTTPS, `AUTH_COOKIE_SECURE=true` | `__Host-nv_session`, Secure, HttpOnly, Path=/, SameSite=Lax, no Domain |

Staging and production settings require secure cookies. The cookie maximum age
is the absolute session lifetime; server-side deadlines remain authoritative.
Clearing uses identical attributes. The readable `noteverse_csrf` cookie and
`x-csrf-token` double-submit header remain the command protection contract.
Session issuance rotates the CSRF value; logout and successful password reset
clear both cookies. Browser API calls use same-origin credentials.

## HTTP contract

Paths below include the `/api/v1` prefix. Command successes have no body unless
the table specifies a response. All command payloads are JSON.

| Method / path | Input | Success / behavior |
| --- | --- | --- |
| POST `/auth/login` | `{email,password}` | 200 `ProfileUserRead` identity object, fresh session and CSRF cookies |
| POST `/auth/logout` | No body | 204, revoke presented session and clear cookies; idempotent |
| GET `/me/profile` | Session cookie | 200 `{user: ProfileUserRead}` |
| GET `/me/sessions?limit=100` | Session cookie; limit 1–100 | 200 `{sessions:[SessionSummary]}` |
| DELETE `/me/sessions/{session_id}` | Device UUID | 204, revoke owned device; clear cookies when it is current |
| DELETE `/me/sessions` | No body | 204, revoke other devices, preserve current session |
| PUT `/me/password` | `{current_password,new_password,locale?}` | 204, revoke all sessions and issue fresh current cookie |
| POST `/auth/register` | `{email,password,display_name,locale?}` | 204, queue verification email |
| POST `/auth/email/verify` | `{token}` | 200 User identity, consume registration credential |
| POST `/auth/password/forgot` | `{email,locale?}` | 204, generic result; queue reset mail only for eligible User |
| POST `/auth/password/reset` | `{token,new_password,locale?}` | 204, consume reset credential, revoke all sessions, clear cookies |
| POST `/me/email/change` | `{new_email,current_password,locale?}` | 204, queue confirmation mail |
| POST `/auth/email/change/confirm` | `{token}` | 200 `{email}`, consume email-change credential |
| DELETE `/me` | `{current_password}` | 202, close account, revoke sessions, clear cookies |

`SessionSummary` contains `id` (UUID), nullable `user_agent`/`ip_address`,
`created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at` and
`is_current`. Locale values are `en` or `zh`, default `zh`. OpenAPI snapshots are
the schema authority for identity DTO fields and error envelopes. Form login is
rejected. Password changes require the current password and a different new
password; reset consumes a hashed, expiring, single-use opaque credential.

Realtime SSE uses the session cookie at admission and validates it again for
every replay/catchup batch. Revocation ends the stream; each database session
closes before waiting for the next wakeup. Downloads and other protected routes
use the same Customer API authentication dependency.

## Email credential links

Verification, reset and email-change credentials are opaque CSPRNG values with
SHA-256 hashes in their domain records. Email links use fragments:

- `/auth/verify-email#token=<raw-token>`
- `/auth/reset-password#token=<raw-token>`
- `/auth/confirm-email-change#token=<raw-token>`

The browser extracts the fragment and submits JSON to the matching command.
Fragments are not part of the HTTP request target. Mail payloads remain sensitive
and follow source-identity cancellation and configured retention. No logs contain
session credentials, hashes or email-link tokens. Password reset and email-change
consumption lock and revalidate the User before mutation; a closed User cannot
consume an outstanding credential.

## Verification

`test_authentication_session_contract.py` exercises real PostgreSQL HTTP sessions,
cookies, device commands, cache outages, rollback, deadlines, concurrent login and
closure, and SSE revalidation. `test_auth_email_links.py` covers password policy
and hashed fragment credentials. `test_account_credential_mail_postgres.py`
checks closure and credential concurrency. Architecture tests enforce dependency
and Consumer credential boundaries. Role-isolation and schema tests exercise the
baseline migrations, least privileges, bounded erasure and ORM parity.
