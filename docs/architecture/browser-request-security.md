# Browser Request Security

Browser traffic uses a same-origin Edge Gateway: Customer and Control Plane have
separate public origins and upstream runtimes. Next.js renders browser applications;
API authentication and command admission run in the HTTP runtimes. Host-only HttpOnly session cookies
carry authentication. The Control Plane challenge cookie carries MFA admission.

## Browser admission

`app.platform.security.origin_guard.BrowserOriginGuard` is pure ASGI middleware.
It forwards the ASGI receive/send channels without reading or buffering bodies.
Both HTTP composition roots install it for POST, PUT, PATCH and DELETE, including
unauthenticated login, email actions and MFA. GET, HEAD and OPTIONS are unaffected.

- Any present `Sec-Fetch-Site` must be exactly `same-origin`; `same-site`,
  `cross-site`, `none`, duplicated and malformed values receive 403.
- A present Origin must exactly equal a normalized configured origin. Null,
  wildcard, duplicate and mismatched origins receive 403. Host/request URL and
  Referer never grant admission.
- An absent Origin is accepted only with explicit `Sec-Fetch-Site: same-origin`.
- Nonempty Content-Length or Transfer-Encoding requires `application/json`
  (parameters allowed). The exact Customer `/api/v1/me/avatar` path instead
  requires `multipart/form-data`. Control Plane has no Multipart allowlist.
- Bodyless logout, cancellation and DELETE commands need no Content-Type.
  Unsupported media types receive 415. Rejections use the runtime's typed
  `{code, request_id}` envelope and correlated `X-Request-ID` response header.

Customer `BACKEND_CORS_ORIGINS` and operator `CONTROL_PLANE_CORS_ORIGINS` contain
explicit HTTP(S) origins only. Paths, credentials, null and wildcard values are
invalid. Production origins are nonempty. CORS uses exact origins, explicit methods
and request headers, with cross-origin credential permission disabled. Browser
transports do not read cookies or manufacture security token headers.

## Distributed admission

`app.platform.security.rate_limit.RedisSlidingWindowLimiter` evaluates all
request dimensions in one Redis Lua invocation. Redis TIME is the clock authority.
Every accepted request inserts a unique member into each bounded sorted-set window;
expired members are removed and key TTL equals the window. If any dimension is
full, none is charged. Rejected requests receive 429 `rate_limit_exceeded` and an
integer `Retry-After` of at least one second. Redis errors/timeouts on fail-closed
policies receive 503 `rate_limit_unavailable`, `Retry-After: 1`, and a structured
warning without identities or connection credentials. Fail-open policies log the
same warning and allow the request. The connection has bounded timeouts and no
implicit retries. API event loops offload synchronous Redis calls to the thread pool.

Each runtime uses a distinct namespace suffix (`customer` or `operator`) under
`RATE_LIMIT_NAMESPACE` (default `noteverse`). All replicas of a runtime use the same
namespace and Redis authority. Policy keys share a hash tag so composite windows
address the same key partition. Identities are SHA-256 digests; normalized email identity uses
NFC, trimming and case folding. Keys never contain raw mailboxes, tokens or IPs.
Redis namespaces must not be randomized per process in deployed runtimes.

All paths below include `/api/v1`. Capacities apply over rolling windows.

| Runtime / methods and paths | Dimensions and capacities | Window | Outage |
| --- | --- | --- | --- |
| Customer POST `/auth/login` | IP 30 AND email 10 | 300 s | fail_closed |
| Customer POST `/auth/register` (including verification-mail resend) | IP 10 AND email 3 | 3600 s | fail_closed |
| Customer POST `/auth/password/forgot`, `/auth/password/reset`, `/auth/email/verify`, `/me/email/change`, `/auth/email/change/confirm` | IP 20 AND email 5; shared recovery policy | 3600 s | fail_closed |
| Customer POST `/uploads`, `/performance-takes/upload-reservations` | authenticated user 20; shared upload policy | 60 s | fail_open |
| Customer POST `/scores/{score_id}/revisions`, `/scores/{score_id}/revisions/{revision_id}/restore` | authenticated user 60; shared revision policy | 60 s | fail_open |
| Control Plane POST `/auth/login` | IP 10 AND email 5 | 300 s | fail_closed |
| Control Plane POST `/auth/mfa/enroll/start`, `/auth/mfa/enroll/confirm`, `/auth/mfa/verify` | IP 30 AND challenge digest 5 AND resolved operator 10 | 300 s | fail_closed |

Password reset resolves its token to the user's mailbox; verification resolves the
pending registration; email-change request/confirmation uses the new mailbox.
An unresolved token uses a separate token-digest dimension at the same capacity,
plus IP; it does not acquire a fictitious email identity. MFA always charges IP
and challenge digest, adding operator identity when the challenge resolves.
The five-attempt persistent challenge lockout remains an independent MFA rule.
Registration handles resend; there is no separate resend endpoint.

Typed `CUSTOMER_*_RATE_LIMIT` and `OPERATOR_*_RATE_LIMIT` JSON configuration models
expose capacities/window and outage mode. Authentication models permit only
`fail_closed`. `OPERATOR_MFA_IDENTITY_LIMIT` controls the operator dimension.
Upload/revision policies permit either explicit outage mode. Business quota,
resource admission, idempotency and authorization remain domain responsibilities.
`RATE_LIMIT_REDIS_TIMEOUT_SECONDS` defaults to 0.25 (positive, at most 5 seconds).

## Client IP authority

Uvicorn uses `--no-proxy-headers`, preserving the transport peer. Admission, audit
and logging use the same `app.platform.security.client_ip` authority.
`TRUSTED_PROXY_HOPS=0` ignores forwarded headers. With a positive value, the
immediate peer must match `TRUSTED_PROXY_CIDRS`; exactly one X-Forwarded-For header
must provide the configured suffix. The rightmost Nth entry is the client, and
the N-1 entries after it must also be trusted proxies. Untrusted/malformed or
incomplete suffixes use the transport peer. Arbitrary entries before this suffix
cannot select the client identity. The Forwarded header is not an IP authority.

Kubernetes HTTP templates configure one gateway hop. Operators set the exact
peer CIDR for their cluster; the sample Pod CIDR is not a universal trust policy.
The gateway must append the actual incoming peer to X-Forwarded-For and the
application must not be directly reachable from untrusted peers in that CIDR.

## Verification and operational boundaries

HTTP tests keep Origin admission active and provide explicit browser origins.
Redis windows use a per-test UUID namespace, exact-key cleanup, and no FLUSHDB.
Real independent Redis connections verify atomic composite capacity under contention.
PostgreSQL roles and runtime Secrets are unchanged; only the two HTTP runtimes
load browser-abuse configuration and their existing Redis connection credentials.

Redis availability is required for sensitive commands. Operators monitor
`security.rate_limit_unavailable` warnings, Redis memory/latency and 429/503 rates.
Configure the shared namespace, proxy hops and origin allowlists identically on
all replicas. Browser policy is defense in depth alongside authorization and
session revocation. CSP, Permissions-Policy and gateway transport security have
separate configuration ownership.

See [Browser Security Baseline](browser-security-baseline.md) for per-request nonce CSP, route capabilities, header ownership and Gateway HSTS.
