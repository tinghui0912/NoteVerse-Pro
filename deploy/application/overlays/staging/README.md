# Staging Overlay

This overlay is a deployable shape template for the staging environment. It is
not ready for deployment without replacing placeholders, creating required
Secrets, and preparing node-local model-cache labels.

Validate rendering:

```bash
kubectl kustomize deploy/application/overlays/staging
```

Required objects supplied outside this overlay:

- Six runtime Secrets: `noteverse-migrator-secret`, `noteverse-customer-api-secret`,
  `noteverse-control-plane-secret`, `noteverse-worker-secret`, `noteverse-beat-secret`,
  `noteverse-observability-secret`; exact keys follow
  [runtime ownership](../../../../docs/architecture/runtime/settings-ownership.md).
- Optional `noteverse-model-assets-secret` with `HF_TOKEN` only for gated model downloads.
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

The staging overlay intentionally enables one `control-plane` and one
`platform-admin` replica. The dedicated `admin.<environment-domain>` Gateway
listener routes only to Platform Admin; its same-origin BFF is the only
in-cluster caller admitted to the control-plane Service by NetworkPolicy.
The control-plane Service itself has no Gateway route. Production remains
dark-by-default until workforce MFA and the production access review are
complete.

Replace all `registry.example.invalid` images in an environment-specific branch
or private overlay before deployment. The staging overlay is intended for the
production-flow rehearsal domain `staging.johnabc.ccwu.cc`.

This overlay uses the production-flow certificate issuer
`letsencrypt-production-dns01`. Validate DNS-01 with the staging issuer first if
the Cloudflare token or DNS zone permissions are new, then switch the overlay
back to the production issuer for browser-trusted TLS rehearsal.

The checked-in staging ConfigMaps use repository test OSS bucket settings for
production-shaped S3 storage and give Customer API, Worker, Beat, Control Plane, exporter and model preparation
separate ConfigMaps. Credentials belong to the matching runtime Secret; do not commit access keys.

The overlay intentionally does not generate Secrets. Credentials should come
from the cluster secret management path, not from repository files.

Frontend routing notes:

- `NEXT_BACKEND_ORIGIN` points to the internal backend Service because it is used
  by Next.js rewrites on the server side.
- Practice source requests are served by the main backend API.
- Browser API and realtime requests use same-origin `/api/v1`.
