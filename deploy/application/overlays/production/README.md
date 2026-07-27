# Production Overlay

This overlay captures the intended production shape for NoteVerse application
workloads. It is a template, not a ready-to-apply production release.

Validate rendering:

```bash
kubectl kustomize deploy/application/overlays/production
```

Do not run strict deployment validation against this public template. Strict
validation is intended for the private overlay after image tags and domains are
replaced:

```bash
python scripts/check_k8s_application_manifests.py \
  deploy/application/overlays/production-private \
  --strict
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
- `ClusterIssuer/letsencrypt-production-dns01` or another cert-manager issuer
  capable of issuing `Secret/noteverse-production-tls`
- node labels/tolerations for GPU worker scheduling:
  - `noteverse.io/model-cache=enabled`
  - `noteverse.io/workload=gpu-worker`
  - `nvidia.com/gpu` taint if GPU nodes are tainted
- GPU runtime support that exposes `nvidia.com/gpu`. The worker Pod requests one
  GPU and performs a startup CUDA check when `LEGATO_DEVICE=cuda`.

Secret, PVC, object storage, TLS, and GPU label ownership is documented in:

```text
docs/operations/deployment/k8s-secrets-and-storage-template.md
```

Production-specific choices:

- API and frontend start with three replicas plus HPA.
- API and frontend have PodDisruptionBudgets.
- Worker remains one replica by default because OMR/playback GPU and model
  contention should be benchmarked before horizontal scaling.
- Beat remains a singleton. Do not scale it until the scheduler is made
  cluster-safe.
- Gateway routing must support SSE and WebSocket traffic for API and practice
  realtime paths.

Replace all `example.invalid` domains and `registry.example.invalid` images in
a private production overlay or CI/CD substitution step before deployment.

Do not commit real credentials, real object storage keys, or production database
URLs to this repository.
