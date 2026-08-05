# NoteVerse Platform Admin

This is the independent operator-facing Next.js application. It only calls the
Control Plane API through its own same-origin proxy and does not share customer
authentication cookies, API clients, layouts, or runtime configuration.

Required environment variable:

```text
NEXT_CONTROL_PLANE_ORIGIN=http://127.0.0.1:8002
NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME=noteverse_operator_csrf
NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME=x-operator-csrf-token
```

Run locally with the Control Plane runtime enabled:

```powershell
docker compose -f docker-compose.backend-dev.yml --profile control-plane up control
npm install
npm run dev
```

Create a local operator only in a trusted development environment:

```powershell
docker compose -f docker-compose.backend-dev.yml exec api python scripts/create_operator.py --username <operator>
```

## Quality Checks

Run the independent operator application checks with deterministic local Control
Plane configuration:

```powershell
.\scripts\quality.ps1 -Check platform-admin-lint
.\scripts\quality.ps1 -Check platform-admin-typecheck
.\scripts\quality.ps1 -Check platform-admin-build
```

`Platform Admin Quality` in GitHub Actions runs the same lint, typecheck, and
production-build gate whenever this application changes. The application has
no isolated domain library yet, so it intentionally has no unit-test harness;
add one only when reusable client-side logic warrants it.
