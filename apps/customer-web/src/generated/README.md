# Generated API Types

`api/` is generated from `backend/docs/contracts/openapi/customer-api.json`.
Do not edit its contents manually. Regenerate it with:

```bash
npm run generate:api-types
```

Use generated API DTOs from `@/generated/api`; keep frontend view models and
form state in their owning feature or `types/` module.
