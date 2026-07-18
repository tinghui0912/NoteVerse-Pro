# Staging Overlay

This overlay is a deployable shape template for the staging environment. It is
not ready for production without replacing placeholders and creating required
Secrets/PVCs.

Validate rendering:

```bash
kubectl kustomize deploy/application/overlays/staging
```

Required objects supplied outside this overlay:

- `Secret/noteverse-backend-secret`
  - `SECRET_KEY`
  - `DATABASE_URL`
  - `SYNC_DATABASE_URL`
  - `REDIS_URL`
  - `CELERY_BROKER_URL`
  - `CELERY_RESULT_BACKEND`
  - `S3_ACCESS_KEY_ID`
  - `S3_SECRET_ACCESS_KEY`
  - `RESEND_API_KEY` if mail is enabled
- `PersistentVolumeClaim/noteverse-legato-repo`
- `PersistentVolumeClaim/noteverse-beat-work`
- `Secret/noteverse-staging-tls` or a cert-manager issuer that owns it
- node label `noteverse.io/model-cache=enabled` on nodes that may run API or
  worker pods

Replace all `example.invalid` domains and `registry.example.invalid` images in
an environment-specific branch or private overlay before deployment.

The overlay intentionally does not generate Secrets. Credentials should come
from the cluster secret management path, not from repository files.

Frontend routing notes:

- `NEXT_BACKEND_ORIGIN` points to the internal backend Service because it is used
  by Next.js rewrites on the server side.
- Browser API and realtime requests use same-origin `/api/v1`. The ingress path
  must route `/api/v1` to the backend API and support long-lived responses
  without buffering.
