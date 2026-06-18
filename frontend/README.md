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
- `.next` also lives in a Docker named volume to avoid mixing host and Linux
  build artifacts.
- After changing `package.json` or `package-lock.json`, rebuild the image. If the
  dependency volume is stale, recreate it with:

```powershell
docker compose -f docker-compose.frontend-dev.yml down -v
docker compose -f docker-compose.frontend-dev.yml build frontend
```
