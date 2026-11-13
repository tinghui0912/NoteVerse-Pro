# Backend API Contracts

`openapi/` contains versioned, committed OpenAPI documents generated from the
FastAPI composition roots:

| Contract | Runtime | Consumer |
| --- | --- | --- |
| `customer-api.json` | `app.main` | Customer Web and external API consumers. |
| `control-plane-api.json` | `app.control_plane_main` | Platform Admin only. |

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
`openapi/customer-api.json`.

Each Customer route declares an explicit, globally unique lowerCamelCase
`operationId`. It is the stable semantic identity of the operation, independent
of handler names, API version and URL topology. Names use the domain/resource
first and action last. Related operations share a context prefix; collection
list/create/batch operations and individual resource commands use consistent
resource and verb vocabulary within that context.

Success contracts describe the runtime body: JSON envelopes retain their schemas,
stored bytes use binary schemas, ZIP archives use `application/zip`, and realtime
events use `text/event-stream`. Stored formats can vary by resource, so their
OpenAPI media ranges describe that variation while the HTTP Content-Type identifies
the selected format. Range-enabled media also declares 206 Partial Content.
Profile image resolution is a bodyless 307 redirect with a Location header.

Customer Web generates TypeScript types, SDK operations and a bundled Fetch client
from this contract. Generated operations own HTTP method, path, path parameters,
query serialization and body encoding. Feature adapters project generated results
and perform frontend transformations; they do not define HTTP operations.
The Customer browser transport owns credentials, CSRF, refresh/retry, redirect,
cancellation and network observability.
Frontend presentation, view-model state, and form state remain frontend-owned.
Generic application realtime notifications use SSE under the normal API/auth
boundary; Practice execution is browser-local and has no active Practice WebSocket
contract.

## Customer application failures

Customer application failures share the Pydantic `ApiErrorResponse` body:
`code` is a stable product error code for client-side presentation and
`request_id` is a nullable correlation identifier. HTTP status expresses the
failure category. Internal exception details and server presentation copy are
not part of this contract.

The Customer API router declares this model once for default failures and 422
validation failures. Exception handlers and CSRF rejection serialize the same
model. Generated OpenAPI and Customer Web types project that definition.
Process readiness uses its own 200/503 dependency-check schemas. Redirects and
bodyless HTTP byte-range rejection retain their protocol-specific contracts.
Control-plane failure presentation is selected independently by its composition
root and is separate from the Customer application contract.

Customer SDK calls select an explicit authenticated, public or silent browser
policy client. Refresh uses the generated `authRefresh` operation through a
non-refreshing client. Concurrent refreshes are shared and requests retry at most
once using an unconsumed body clone. Application failures become browser
`ApiError` instances through one adapter of generated `ApiErrorResponse`.

EventSource, native image/audio URLs and browser resource navigation use browser
transports. Their route metadata is generated from Customer OpenAPI operation IDs,
methods and path templates. Native URL adapters use that metadata, generated
operation input types and the Fetch client's URL serializer.
Avatar presentation supplies an API-rooted browser resource URL directly.
Signed object-storage uploads use opaque absolute target URLs and
required headers with credentials omitted; they do not use Customer session
refresh or CSRF policy.

## Customer browser protocol identity

[`contracts/http/customer-browser-protocol.json`](../../../contracts/http/customer-browser-protocol.json)
owns the Customer API prefix and Customer session/CSRF cookie and header names.
`scripts/generate_customer_browser_protocol.py` generates Backend Python and
Customer Web TypeScript projections from it, and native route metadata from the
committed Customer OpenAPI. Run it with `--check` to verify every projection.
Customer Web exposes `generate:browser-protocol` and `check:browser-protocol`.
Origins, Secure/SameSite policy, lifetimes and backend service topology remain
deployment settings. Control-plane protocol configuration is independent.

Customer CSRF exemptions are Backend application security policy in
`app/api/customer_security.py`. The generic middleware uses framework route
matching to resolve the actual operation, then applies the composition's policy.
Only explicit public credential/token or session-bootstrap operation identities
skip the double-submit token check. Cookie-authenticated writes still undergo
Origin/Referer validation. Unknown operations, missing identities and method
mismatches require CSRF; logout also requires CSRF. Control Plane supplies its own
independent matched-operation policy. Browser protocol projections own cookie and
header identities rather than exemption decisions.
