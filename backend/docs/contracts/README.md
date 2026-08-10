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

## Frontend migration rule

OpenAPI is the source of truth for HTTP DTOs. Generated types and client code
will replace hand-maintained frontend API DTOs incrementally. Frontend-only
view models, form state, presentation helpers, and browser protocol types remain
owned by the frontend.
