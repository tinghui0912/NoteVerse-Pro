# NoteVerse Pro Frontend

Next.js frontend for NoteVerse Pro.

## Docker Development

The supported local frontend runtime is Docker with source bind mounts. Code
changes on the host are reflected inside the container.

Build and start:

```powershell
docker compose -f docker-compose.frontend-dev.yml build frontend
docker compose -f docker-compose.frontend-dev.yml up frontend
```

Open:

```text
http://localhost:9002
```

The frontend proxies `/api/v1/*` through Next.js rewrites.
`NEXT_BACKEND_ORIGIN` is required in `.env.docker`:

```text
http://host.docker.internal:8000
```

This points to the backend API running on the Windows host or in the backend
Docker profile published to port `8000`.

Realtime events use `NEXT_PUBLIC_REALTIME_API_BASE_URL` because EventSource
connections must not pass through proxies that buffer streaming responses. The
value must be browser-reachable and include the API base path, for example:

```text
http://localhost:8000/api/v1
```

Use the same hostname in the browser and realtime API URL so HttpOnly auth
cookies are sent consistently. For example, open `http://localhost:9002` with
`NEXT_PUBLIC_REALTIME_API_BASE_URL=http://localhost:8000/api/v1`; if you open
`http://127.0.0.1:9002`, configure the realtime URL with `127.0.0.1` too.

For LAN device testing, configure the frontend dev server with the LAN host:

```powershell
$env:NEXT_BACKEND_ORIGIN='http://localhost:8000'
$env:NEXT_ALLOWED_DEV_ORIGINS='192.168.31.59'
$env:NEXT_PUBLIC_REALTIME_API_BASE_URL='http://192.168.31.59:8000/api/v1'
npm run dev
```

The backend `BACKEND_CORS_ORIGINS` must include the matching frontend origin,
for example `http://192.168.31.59:9002`.

## Environment

Copy the example if local overrides are needed:

```powershell
Copy-Item .env.docker.example .env.docker
```

If `NEXT_BACKEND_ORIGIN` is missing, the Next.js dev server exits during
configuration loading.

## Quality Checks

Run inside the frontend container:

```powershell
docker compose -f docker-compose.frontend-dev.yml run --rm frontend npm run lint
docker compose -f docker-compose.frontend-dev.yml run --rm frontend npm run check:i18n-errors
docker compose -f docker-compose.frontend-dev.yml run --rm frontend npm run typecheck
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
docker compose -f docker-compose.frontend-dev.yml build frontend
```

To reset all frontend development state manually, including the dependency
volume, run `docker compose -f docker-compose.frontend-dev.yml down -v`.
