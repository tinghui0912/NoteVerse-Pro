# NoteVerse Platform Admin

The independent operator application consumes the generated Control Plane API.
It uses a host-only opaque operator session and a separate MFA challenge cookie.
Customer authentication clients, cookies and layouts have independent ownership.

## Authentication

Password sign-in sends JSON `{email,password}` and receives only an MFA challenge.
Enrollment uses a locally generated SVG QR from `qrcode-generator` and a copyable
manual secret. Verification accepts exactly one authenticator or recovery code.
Challenges expire after five minutes; five failed verification attempts return
the operator to password sign-in. A server-side rejection remains authoritative.

Enrollment returns ten single-use recovery codes once. The acknowledgment screen
holds them only in component memory until the operator confirms secure storage.
Copy and text download require explicit actions. Downloads use a transient Blob
URL that is revoked immediately. Reloading or leaving the page loses the displayed
codes; an enrolled operator can ask a super administrator for an MFA reset.
Secrets and codes are never placed in browser storage, query strings or external
QR services. The session context stores only the operator profile and a remaining
recovery-code count. A low count displays a dismissible warning.

The shared session boundary removes authenticated page state on a 401 and routes
to sign-in. A generation fence prevents a late session probe from restoring a
cleared identity. MFA failures on the sign-in page preserve the active step until
expiry, lockout or an explicit restart. Browser mutations require same-origin Fetch Metadata, an explicit configured Origin and JSON bodies.

## Console

Navigation, page admission and action controls use the profile's typed permissions:

| Surface                                        | Permission         |
| ---------------------------------------------- | ------------------ |
| Operations                                     | `operations.read`  |
| Audited retries                                | `operations.retry` |
| User directory and inline details              | `users.read`       |
| User suspension/reactivation                   | `users.suspend`    |
| Filtered, paginated audit logs                 | `audit.read`       |
| Operator create/access/password/MFA management | `operators.manage` |

Operational and management mutations require a trimmed reason of 3–500 characters.
Operator passwords use NFC normalization and 12–128 Unicode code points, rejecting
blank input. Passwords and enrollment material remain transient. Permission gates
control presentation; the backend independently enforces every operation.

The API contract, role mapping, cookies and challenge/session lifetime are defined
in [Control Plane Authentication](../../docs/architecture/control-plane-auth.md).
Directory details contain only the fields provided by the directory API. Audit
filters use actor ID, action, target type/ID, outcome and aware timestamps.

## Local runtime

Node.js 24 runs the application and its quality tools. Set
`NEXT_CONTROL_PLANE_ORIGIN=http://127.0.0.1:8002` for the local Control Plane.
The checked-in development routing configuration supplies same-origin API access.

```powershell
Copy-Item apps/platform-admin/.env.docker.example apps/platform-admin/.env.docker
docker compose -f docker-compose.backend-dev.yml --profile control-plane up control
docker compose -f docker-compose.platform-admin-dev.yml up platform-admin
```

The development application uses `http://localhost:3001`; `npm run dev` uses the
same port. Use one launcher at a time. Operator bootstrap runs from `backend/`
with an explicitly configured Control Plane database connection:

```text
python scripts/create_operator.py --email admin@example.com --display-name Admin
```

It prompts for a password through a TTY and creates a SUPER_ADMIN requiring TOTP
enrollment. The Control Plane requires its independently provisioned TOTP encryption
key; the browser does not receive that key.

## Generated contracts and verification

`generated/api` is produced from the committed Control Plane OpenAPI snapshot.
`lib/control-plane-api.ts` composes generated operations without duplicating paths
or DTOs. `lib/control-plane-browser-transport.ts` owns same-origin credentials,
bounded error classification; request bodies and private server error
text are excluded from error presentation.

```text
npm run generate:api
npm run generate:browser-protocol
npm run check:api
npm run check:browser-protocol
npm run typecheck
npm run lint
npm test
npm run build
```

API verification regenerates into an owned temporary directory, compares the
complete artifact tree to the working copy and removes the temporary directory.
Browser protocol checks validate both Python and TypeScript projections. Unit and
component tests cover MFA, local QR output, recovery-code hygiene, session expiry,
permissions, reason/password admission and administrative query/mutation surfaces.
The repository's Platform Admin workflow runs the corresponding quality commands.
