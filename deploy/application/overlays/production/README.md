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
- `PersistentVolumeClaim/noteverse-legato-repo`
- `PersistentVolumeClaim/noteverse-beat-work`
- `Secret/noteverse-production-tls` or a cert-manager issuer that owns it
- node labels/tolerations for GPU worker scheduling:
  - `noteverse.io/model-cache=enabled`
  - `noteverse.io/workload=gpu-worker`
  - `nvidia.com/gpu` taint if GPU nodes are tainted

Secret, PVC, object storage, TLS, and GPU label ownership is documented in:

```text
docs/k8s-secrets-and-storage-template.md
```

Production-specific choices:

- API and frontend start with three replicas plus HPA.
- API and frontend have PodDisruptionBudgets.
- Worker remains one replica by default because OMR/playback GPU and model
  contention should be benchmarked before horizontal scaling.
- Beat remains a singleton. Do not scale it until the scheduler is made
  cluster-safe.
- Ingress disables proxy buffering and uses long read/send timeouts for SSE.

Replace all `example.invalid` domains and `registry.example.invalid` images in
a private production overlay or CI/CD substitution step before deployment.

Do not commit real credentials, real object storage keys, or production database
URLs to this repository.
