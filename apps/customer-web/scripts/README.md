# Customer Web Scripts

This folder contains customer-web-only maintenance scripts.

| Script | Purpose | CI |
| --- | --- | --- |
| `check-error-translations.mjs` | Ensures customer-facing error translations match backend `ErrorCode` values. | `npm run check:i18n-errors` |
| `check-api.mjs` | Regenerates Customer types, SDK operations and Fetch runtime, then rejects output that differs from `HEAD` or remains untracked. | `npm run check:api` |

Add a script here only when it operates exclusively on Customer Web code or its explicit frontend contract. Cross-project quality and release automation belongs in the repository `scripts/` folder.
