# NoteVerse Platform Admin

This is the independent operator-facing Next.js application. It only calls the
Control Plane API through its own same-origin proxy and does not share customer
authentication cookies, API clients, layouts, or runtime configuration.

Local commands require Node.js 24, matching the CI and runtime image toolchain.

Required environment variable:

```text
NEXT_CONTROL_PLANE_ORIGIN=http://127.0.0.1:8002
NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME=noteverse_operator_csrf
NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME=x-operator-csrf-token
```

Run the local development containers with the Control Plane runtime enabled:

```powershell
docker compose -f docker-compose.backend-dev.yml --profile control-plane up control
Copy-Item apps/platform-admin/.env.docker.example apps/platform-admin/.env.docker
docker compose -f docker-compose.platform-admin-dev.yml up platform-admin
```

The Platform Admin development server is available at `http://localhost:3001`.
The environment file points its same-origin Next.js proxy to the local Control
Plane API at `http://host.docker.internal:8002`.
`npm run dev` uses the same port, so use either the Docker server or the host
process at one time.

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
.\scripts\quality.ps1 -Check platform-admin-test
.\scripts\quality.ps1 -Check platform-admin-build
```

`Platform Admin Quality` in GitHub Actions runs the same lint, typecheck,
unit-test, and production-build gate whenever this application changes. The
initial unit coverage protects the Control Plane client contract: same-origin
routing, operator CSRF, pagination, and safe error mapping.

The Docker development image installs the same development dependencies as
local `npm ci`. Run individual checks without installing Node.js dependencies
on the host:

```powershell
docker compose -f docker-compose.platform-admin-dev.yml run --rm platform-admin npm run lint
docker compose -f docker-compose.platform-admin-dev.yml run --rm platform-admin npm run typecheck
docker compose -f docker-compose.platform-admin-dev.yml run --rm platform-admin npm run test
```
