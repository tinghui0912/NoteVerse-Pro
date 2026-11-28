# Backend API Contracts

`openapi/` contains versioned, committed OpenAPI documents generated from the
FastAPI composition roots:

| Contract | Runtime | Consumer |
| --- | --- | --- |
| `customer-api.json` | `app.runtime.customer_api.main` | Customer Web and external API consumers. |
| `control-plane-api.json` | `app.runtime.control_plane.main` | Platform Admin only. |

Generate a contract in its matching Docker runtime:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python api scripts/export_openapi.py customer-api
docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python control scripts/export_openapi.py control-plane-api
```

Use `--check` in CI to ensure a source change does not leave a stale generated
contract behind. Do not manually edit generated JSON.

## HTTP schema ownership

Backend domain types, Pydantic schemas, and FastAPI routes define the HTTP schemas.
The generated OpenAPI documents project those definitions and are the HTTP schema
authority for consumers. Customer Web API types are generated from
`openapi/customer-api.json`. Platform Admin generates its TypeScript SDK from
`openapi/control-plane-api.json` using its own generator configuration.

Each Customer route declares an explicit, globally unique lowerCamelCase
`operationId`. It is the stable semantic identity of the operation, independent
of handler names, API version and URL topology. Names use the domain/resource
first and action last. Related operations share a context prefix; collection
list/create/batch operations and individual resource commands use consistent
resource and verb vocabulary within that context.

Customer success is HTTP status plus the operation's direct typed representation.
Commands without a response representation return bodyless 204. Import submission
and retry return 202 with `ImportJobSubmitRead`. Page-number resources contain
`items`, `page`, `page_size`, `total` and `total_pages`; cursor resources retain
`items` and `next_cursor`. There is no generic Customer success envelope. Frontend
i18n owns localized success presentation. Typed API models serialize nested
timezone-aware instants from PostgreSQL TIMESTAMPTZ as RFC3339 UTC date-times.

Protocol-native success contracts retain their bodies:
stored bytes use binary schemas, ZIP archives use `application/zip`, and realtime
events use `text/event-stream`. Stored formats can vary by resource, so their
OpenAPI media ranges describe that variation while the HTTP Content-Type identifies
the selected format. Range-enabled media also declares 206 Partial Content.
Profile image resolution is a bodyless 307 redirect with a Location header.

Customer Web generates TypeScript types, SDK operations and a bundled Fetch client
from this contract. Generated operations own HTTP method, path, path parameters,
query serialization and body encoding. Feature adapters project generated results
and perform frontend transformations; they do not define HTTP operations.
The Customer browser transport owns credentials, session invalidation, redirect,
cancellation and network observability.
Frontend presentation, view-model state, and form state remain frontend-owned.
Generic application realtime notifications use SSE under the normal API/auth
boundary; Practice execution is browser-local and has no active Practice WebSocket
contract.

## Customer application failures

Customer application failures share the Pydantic `ApiErrorResponse` body:
`code` is a stable product error code for client-side presentation and
`request_id` is a required nonempty string correlation identifier. HTTP status expresses the
failure category. Internal exception details and server presentation copy are
not part of this contract.

The Customer API router declares this model once for default failures and 422
validation failures. Exception handlers and Origin rejection serialize the same
model. Generated OpenAPI and Customer Web types project that definition.
Process readiness uses its own 200/503 dependency-check schemas. Redirects and
bodyless HTTP byte-range rejection retain their protocol-specific contracts.
Control-plane failure presentation is selected independently by its composition
root and is separate from the Customer application contract.

`HttpApplication` places `RequestCorrelationMiddleware` outside the complete
FastAPI stack, including server-error handling and OpenTelemetry instrumentation.
At HTTP ingress it validates the incoming `X-Request-ID` or generates a replacement,
then binds the same ID to request state and the logging ContextVar. Every Customer
application failure contains `{ code: string, request_id: string }`, and its body
ID equals the `X-Request-ID` response header. Origin admission, logging and exception handlers
consume that established identity. Correlation remains active through streaming
and error presentation, then resets at request completion. Process-specific body
contracts remain independent of the correlation response header.

Customer SDK calls select an explicit authenticated, public or silent browser
policy client. Refresh uses the generated `authRefresh` operation through a
non-refreshing client. Concurrent refreshes are shared and requests retry at most
once using an unconsumed body clone. Application failures become browser
`ApiError` instances through one adapter of generated `ApiErrorResponse`.
Canonical failures use the required body correlation ID. Noncanonical/proxy
failures can use a response-header ID or have no server correlation; the browser
does not invent a server ID for malformed or network failures.

EventSource, native image/audio URLs and browser resource navigation use browser
transports. Their route metadata is generated from Customer OpenAPI operation IDs,
methods and path templates. Native URL adapters use that metadata, generated
operation input types and the Fetch client's URL serializer.
Avatar presentation supplies an API-rooted browser resource URL directly.
Signed object-storage uploads use opaque absolute target URLs and
required headers with credentials omitted; they do not use Customer session
origin admission policy.

## Customer browser protocol identity

[`contracts/http/customer-browser-protocol.json`](../../../contracts/http/customer-browser-protocol.json)
owns the Customer API prefix and Customer session cookie names.
`scripts/generate_customer_browser_protocol.py` generates Backend Python and
Customer Web TypeScript projections from it, and native route metadata from the
committed Customer OpenAPI. Run it with `--check` to verify every projection.
Customer Web exposes `generate:browser-protocol` and `check:browser-protocol`.
Origins, Secure/SameSite policy, lifetimes and backend service topology remain
deployment settings. Control-plane protocol configuration is independent.

Browser command admission belongs to the shared pure ASGI `BrowserOriginGuard`. Both HTTP runtimes require exact configured Origin or explicit same-origin Fetch Metadata, reject other Fetch Metadata values, and require JSON bodies. Customer avatar upload has the sole Multipart exception. Protocol projections own host-only session and challenge cookie identities. Redis admission policies are injected by runtime dependencies.

## Control Plane application contract

Control Plane operations declare explicit semantic lowerCamelCase operation IDs.
Login and logout return bodyless 204 responses and set or clear host-only operator
cookies. Current operator, operation pages/summary/retry and audit pages return
their direct typed representations. Both HTTP contracts use status plus a concrete
representation, with no generic success envelope. Nested operator timestamps use
canonical UTC serialization through the shared ApiModel primitive.

Control Plane owns `ControlPlaneErrorResponse { code, request_id }`, independently
of the Customer error schema. Its aggregate router declares default and 422
failures; exception handlers and Origin rejection emit that representation with the
same ingress correlation ID as the response header. Browser presentation belongs
to Platform Admin. Its generated SDK owns methods, paths, query/body serialization
and DTOs; the thin browser transport owns same-origin credentials and bounded
error normalization. Operator sessions have no refresh/replay protocol.

The independently versioned browser protocols under `contracts/http/` own each
API prefix and cookie/header identities. Generated Backend and browser constants
consume those protocols; deployment configures policy and service topology.

Request IDs use the shared `app.shared.request_id.RequestId` representation.
Ingress and both application-error schemas consume its one token-pattern authority;
the schemas declare a length of 1–128. The Control Plane SDK generator also projects
runtime schemas for browser validation. These HTTP representation constraints are
independent of the browser identity protocols.

## Instant semantics

All persisted lifecycle, audit, expiry and heartbeat instants use PostgreSQL
TIMESTAMPTZ. `app.shared.time` owns `utc_now()`, aware UTC normalization and the
reusable `Instant` API type. Time filters and expiry inputs require an explicit
offset: `Z` and non-UTC offsets are accepted and normalized to UTC; timezone-free
values are invalid. The application database connection uses a UTC session policy.

API date-times are RFC3339 UTC instants. Fractional-second display width is not
part of the wire contract. ApiModel serializes aware instants as UTC and
rejects timezone-free programming values. ORM flush admission likewise requires
aware datetime assignments. Duration, musical position and calendar-date concepts
retain their own units and semantics.
