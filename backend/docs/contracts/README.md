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

Customer Web's handwritten API facades define its HTTP method, path, and query calls.
Frontend presentation, view-model state, and form state remain frontend-owned.
Generic application realtime notifications use SSE under the normal API/auth
boundary; Practice execution is browser-local and has no active Practice WebSocket
contract.
