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

Customer Web's handwritten API facades issue HTTP method, path, and query calls
against this contract. They use generated request types where consumed.
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
