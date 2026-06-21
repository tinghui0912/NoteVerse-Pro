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
