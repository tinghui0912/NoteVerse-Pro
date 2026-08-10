# Backend API Contracts

`openapi/` contains versioned, committed OpenAPI documents generated from the
three FastAPI composition roots:

| Contract | Runtime | Consumer |
| --- | --- | --- |
| `customer-api.json` | `app.main` | Customer Web and external API consumers. |
| `practice-api.json` | `app.practice_main` | Customer Web practice client. |
| `control-plane-api.json` | `app.control_plane_main` | Platform Admin only. |

Generate a contract in its matching Docker runtime:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python api scripts/export_openapi.py customer-api
docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python practice scripts/export_openapi.py practice-api
docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python control scripts/export_openapi.py control-plane-api
```

Use `--check` in CI to ensure a source change does not leave a stale generated
contract behind. Do not manually edit generated JSON.

`score-domain-v1.json` remains a curated, product-level invariant contract. It
does not replace OpenAPI and should not duplicate every request/response DTO.

## Practice WebSocket protocol

`app.processing.realtime.protocol` is the authoritative server-side contract
for Practice WebSocket JSON control frames and server events. Version 1 requires
`protocol_version: 1` on every JSON message; unversioned frames are rejected.
The Customer Web mirrors that contract with a strict Zod validator before it
reaches page state. Binary PCM frames remain a separate transport payload and
are governed by the session's REST-negotiated audio format.

Protocol changes must be additive within a version or introduce a new version.
They require updates to the server contract, the Customer Web validator, and
both protocol test suites in the same change. Do not add legacy-version parsing
or silent field fallbacks during development.

`realtime/practice-websocket-v1.json` is the committed JSON Schema artifact
generated from that Pydantic source. Generate or verify it in the Practice
runtime:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python practice scripts/export_realtime_protocol.py
docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python practice scripts/export_realtime_protocol.py --check
```

## Frontend migration rule

OpenAPI is the source of truth for HTTP DTOs. Generated types and client code
will replace hand-maintained frontend API DTOs incrementally. Frontend-only
view models, form state, and presentation helpers remain owned by the frontend;
Practice WebSocket messages are a versioned cross-runtime contract rather than
a frontend-only type.
