# Staging Overlay

This overlay is a deployable shape template for the staging environment. It is
not ready for deployment without replacing placeholders, creating required
Secrets, and preparing node-local model-cache labels.

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
  - `HF_TOKEN` when gated Hugging Face model repositories are enabled
- `ClusterIssuer/letsencrypt-staging-dns01` or another cert-manager issuer
  capable of issuing `Secret/noteverse-staging-tls`
- node label `noteverse.io/model-cache=enabled` on nodes that may run worker
  pods

Replace all `example.invalid` domains and `registry.example.invalid` images in
an environment-specific branch or private overlay before deployment.

The overlay intentionally does not generate Secrets. Credentials should come
from the cluster secret management path, not from repository files.

Frontend routing notes:

- `NEXT_BACKEND_ORIGIN` points to the internal backend Service because it is used
  by Next.js rewrites on the server side.
- `NEXT_PRACTICE_ORIGIN` points to the internal practice Service for local or
  server-side rewrites of `/api/v1/practice/*`.
- Browser API and realtime requests use same-origin `/api/v1`. The HTTPRoute
  must route `/api/v1/practice` to the practice Service before routing the
  broader `/api/v1` prefix to the backend API. Long-lived responses and
  WebSocket upgrades must be supported without buffering.
