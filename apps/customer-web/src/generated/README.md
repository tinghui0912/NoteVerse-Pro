# Generated Customer API

`api/` is generated from `backend/docs/contracts/openapi/customer-api.json`.
Do not edit its contents manually. Regenerate it with:

```bash
npm run generate:api
```

Use generated API DTOs from `@/generated/api`; keep frontend view models and
form state in their owning feature or `types/` module.

Customer API output includes `types.gen.ts`, `sdk.gen.ts`, barrel exports and
bundled `client/` and `core/` runtime files. `npm run generate:api` regenerates the
whole directory; `npm run check:api` verifies all generated artifacts against
HEAD. SDK operations require an explicit browser policy client.
