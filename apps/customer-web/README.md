# NoteVerse Customer Web

The customer-facing Next.js application for NoteVerse Pro. It owns public,
authenticated application, and external viewer experiences. Platform operator
workflows live separately in `../platform-admin`.

## Docker Development

The supported local Customer Web runtime is Docker with source bind mounts. Code
changes on the host are reflected inside the container.

Build and start:

```powershell
docker compose -f docker-compose.customer-web-dev.yml build customer-web
docker compose -f docker-compose.customer-web-dev.yml up customer-web
```

Open:

```text
http://localhost:9002
```

Customer Web uses same-origin `/api/v1/*` for browser API and realtime traffic.
In local development, Next.js rewrites regular API traffic to the backend API
and practice traffic to the practice service. `NEXT_BACKEND_ORIGIN` and
`NEXT_PRACTICE_ORIGIN` are required in `.env.docker`:

```text
NEXT_BACKEND_ORIGIN=http://host.docker.internal:8000
NEXT_PRACTICE_ORIGIN=http://host.docker.internal:8001
```

This points to the backend API running on the Windows host or in the backend
Docker profile published to port `8000`.

In Kubernetes, route `/api/v1/practice` to the practice service before the
broader `/api/v1` backend API route so browser requests do not depend on
environment-specific public JavaScript configuration.

For LAN device testing, configure the Customer Web dev server with the LAN host:

```powershell
$env:NEXT_BACKEND_ORIGIN='http://localhost:8000'
$env:NEXT_PRACTICE_ORIGIN='http://localhost:8001'
$env:NEXT_ALLOWED_DEV_ORIGINS='192.168.31.59'
npm run dev
```

The backend `BACKEND_CORS_ORIGINS` must include the matching Customer Web origin,
for example `http://192.168.31.59:9002`.

## Environment

Copy the example if local overrides are needed:

```powershell
Copy-Item .env.docker.example .env.docker
```

If required origin values are missing, the Next.js dev server exits during
configuration loading.

## Quality Checks

Run inside the Customer Web container:

```powershell
docker compose -f docker-compose.customer-web-dev.yml run --rm customer-web npm run lint
docker compose -f docker-compose.customer-web-dev.yml run --rm customer-web npm run check:i18n-errors
docker compose -f docker-compose.customer-web-dev.yml run --rm customer-web npm run typecheck
```

## Dependency Notes

- `node_modules` lives in a Docker named volume so the host bind mount does not
  overwrite container-installed dependencies.
- The container checks `package-lock.json` on startup and refreshes a stale
  dependency volume automatically.
- `.next` lives in a container-local `tmpfs`, avoiding stale route manifests,
  host/Linux artifact mixing, and slow bind-mounted filesystem access.
- Rebuild the image after changing `package.json` or `package-lock.json`:

```powershell
docker compose -f docker-compose.customer-web-dev.yml build customer-web
```

To reset all Customer Web development state manually, including the dependency
volume, run `docker compose -f docker-compose.customer-web-dev.yml down -v`.
