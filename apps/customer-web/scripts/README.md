# Customer Web Scripts

This folder contains customer-web-only maintenance scripts.

| Script | Purpose | CI |
| --- | --- | --- |
| `check-error-translations.mjs` | Ensures customer-facing error translations match backend `ErrorCode` values. | `npm run check:i18n-errors` |
| `check-api-types.mjs` | Regenerates Customer and Practice API DTOs, then rejects output that differs from `HEAD` or remains untracked. | `npm run check:api-types` |
| `inventory-editor-legacy-dependencies.mjs` | Generates and checks the REC-007 Customer Web editor legacy dependency inventory. | `npm run check:editor-legacy-inventory` |

Add a script here only when it operates exclusively on Customer Web code or its explicit frontend contract. Cross-project quality and release automation belongs in the repository `scripts/` folder.
