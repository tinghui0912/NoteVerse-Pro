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
- `ClusterIssuer/letsencrypt-production-dns01` or another production-equivalent
  cert-manager issuer capable of issuing `Secret/noteverse-staging-tls`
- GPU worker node labels on nodes that may run worker pods:
  - `noteverse.io/model-cache=enabled`
  - `noteverse.io/workload=gpu-worker`
- GPU runtime support that exposes `nvidia.com/gpu` on worker nodes. The worker
  Pod requests one GPU; if staging has no GPU runtime, the Pod must remain
  Pending instead of accepting Legato jobs and failing during inference.
- Optional `nvidia.com/gpu` taint on GPU nodes. The worker tolerates this taint.
- Envoy Gateway data-plane exposure through MetalLB or a local port-forward to
  port 443 for minikube production-flow rehearsal

Replace all `registry.example.invalid` images in an environment-specific branch
or private overlay before deployment. The staging overlay is intended for the
production-flow rehearsal domain `staging.johnabc.ccwu.cc`.

This overlay uses the production-flow certificate issuer
`letsencrypt-production-dns01`. Validate DNS-01 with the staging issuer first if
the Cloudflare token or DNS zone permissions are new, then switch the overlay
back to the production issuer for browser-trusted TLS rehearsal.

The checked-in staging ConfigMap uses the repository test OSS bucket settings
for production-shaped S3 storage. Keep credentials in
`Secret/noteverse-backend-secret`; do not commit access keys.

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
