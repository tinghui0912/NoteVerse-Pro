# Kubernetes Secrets And Storage Template

This document defines the production naming and ownership contract for
NoteVerse Kubernetes Secrets, PVCs, object storage buckets, TLS assets, model
volumes, and GPU node labels.

It intentionally does not contain real Secret manifests or credentials.

Related documents:

- `docs/k8s-application-runtime-contract.md`
- `docs/k8s-deployment-runbook.md`
- `docs/k8s-production-preflight-checklist.md`

## Namespace Scope

Application Secrets and PVCs are namespace-scoped.

Recommended namespaces:

```text
noteverse-staging
noteverse-production
```

Do not share application Secrets across staging and production.

## Backend Secret

Required name:

```text
Secret/noteverse-backend-secret
```

Required keys:

| Key | Owner | Rotation trigger |
| --- | --- | --- |
| `SECRET_KEY` | platform/security | planned security rotation or suspected compromise |
| `DATABASE_URL` | platform/database | database credential rotation |
| `SYNC_DATABASE_URL` | platform/database | database credential rotation |
| `REDIS_URL` | platform/cache | Redis credential or endpoint rotation |
| `CELERY_BROKER_URL` | platform/cache | Redis credential or endpoint rotation |
| `CELERY_RESULT_BACKEND` | platform/cache | Redis credential or endpoint rotation |
| `S3_ACCESS_KEY_ID` | platform/storage | object storage credential rotation |
| `S3_SECRET_ACCESS_KEY` | platform/storage | object storage credential rotation |
| `RESEND_API_KEY` | platform/email | mail provider credential rotation |

Rules:

- do not commit this Secret to the repository;
- do not use development credentials in production;
- rotate staging credentials separately from production;
- after Secret rotation, restart affected deployments deliberately.

Example command shape:

```bash
kubectl -n noteverse-production create secret generic noteverse-backend-secret \
  --from-env-file=/path/to/managed-backend-secret.env
```

Prefer an external secret manager or sealed-secret mechanism for real clusters.
The referenced env file must be generated outside this repository and must
contain the required keys listed above.

## Registry Pull Secret

Required name:

```text
Secret/noteverse-registry-credentials
```

Purpose:

- allow Kubernetes nodes to pull private backend/frontend images from GHCR or a
  future private registry.

Example command shape for GHCR:

```bash
kubectl -n noteverse-production create secret docker-registry noteverse-registry-credentials \
  --docker-server=ghcr.io \
  --docker-username=<github-user-or-ci-bot> \
  --docker-password=<token-with-read-packages> \
  --docker-email=<ops-email>
```

Rules:

- use a least-privilege token with package read access only;
- create separate pull credentials for staging and production;
- rotate the token deliberately and restart workloads only if needed;
- do not commit this Secret or the token value to the repository.

## Frontend Secret

The frontend currently does not require a dedicated Secret.

Frontend runtime configuration is public origin and cookie/header naming, so it
belongs in:

```text
ConfigMap/noteverse-frontend-config
```

Do not add a frontend Secret unless the frontend server starts requiring
private server-only credentials.

## TLS Secret

Required production name:

```text
Secret/noteverse-production-tls
```

Required staging name:

```text
Secret/noteverse-staging-tls
```

Rules:

- prefer cert-manager or an external certificate automation path;
- TLS Secret names must match the application overlay Ingress;
- include both frontend and API hosts in the certificate SAN list.

## Object Storage

Production bucket:

```text
noteverse-production
```

Staging bucket:

```text
noteverse-staging
```

Required backend config keys:

- `FILE_STORAGE_BACKEND=s3`
- `S3_ENDPOINT_URL`
- `S3_REGION`
- `S3_BUCKET`
- `S3_PUBLIC_BASE_URL`
- `S3_FORCE_PATH_STYLE`
- `S3_PRESIGN_EXPIRE_SECONDS`

Credential keys live in `Secret/noteverse-backend-secret`:

- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Rules:

- credentials should be scoped to the intended bucket;
- staging credentials must not access production buckets;
- object storage lifecycle rules should be reviewed before enabling automatic
  deletion;
- product storage usage is database-backed and must not use bucket listing as
  the billing source of truth.

## PVCs

### Model Assets

Required name:

```text
PersistentVolumeClaim/noteverse-model-assets
```

Mounted at:

```text
/opt/noteverse/models
```

Used by:

- `backend-api` read-only;
- `backend-worker` read-only.

Contains:

- soundfonts;
- PaddleOCR models;
- HuggingFace model cache;
- any other offline model assets required by runtime checks.

Rules:

- mount read-only in app pods;
- update through a controlled model publishing process;
- do not let worker jobs mutate the model PVC.

### Legato Repository

Required name:

```text
PersistentVolumeClaim/noteverse-legato-repo
```

Mounted at:

```text
/external/legato
```

Used by:

- `backend-worker` read-only.

Rules:

- contents must match `LEGATO_REPO_COMMIT`;
- worker runtime checks should fail when repository metadata does not match;
- do not mount writable in runtime pods.

### Beat Work State

Required name:

```text
PersistentVolumeClaim/noteverse-beat-work
```

Mounted at:

```text
/var/lib/noteverse/work
```

Used by:

- `backend-beat`.

Rules:

- beat remains singleton;
- PVC exists because Celery beat currently stores scheduler state under
  `WORK_ROOT/celerybeat`;
- if beat is replaced by a database-backed or leader-elected scheduler, this PVC
  should be revisited.

## Runtime Work Volumes

API and worker use `emptyDir` for runtime work paths in the public templates.

Rules:

- transient work files should not be treated as durable product storage;
- object storage and database records are the durable sources of truth;
- if a future worker needs large transient disk, use node-local storage or a
  dedicated temporary PVC with explicit cleanup policy.

## GPU Node Labels And Taints

Production worker overlay expects:

```text
node label: noteverse.io/workload=gpu-worker
toleration key: nvidia.com/gpu
```

Rules:

- apply the label only to nodes intended for OMR/playback worker workloads;
- benchmark `CELERY_WORKER_CONCURRENCY` before scaling worker replicas;
- do not scale worker replicas across GPU nodes until model memory and queue
  behavior are measured.

## Rotation Procedure

Secret rotation:

1. Create or update the Secret through the approved secret management path.
2. Restart dependent workloads:

   ```bash
   kubectl -n noteverse-production rollout restart deployment/noteverse-backend-api
   kubectl -n noteverse-production rollout restart deployment/noteverse-backend-worker
   kubectl -n noteverse-production rollout restart deployment/noteverse-backend-beat
   ```

3. Verify:

   ```bash
   kubectl -n noteverse-production rollout status deployment/noteverse-backend-api
   kubectl -n noteverse-production rollout status deployment/noteverse-backend-worker
   kubectl -n noteverse-production rollout status deployment/noteverse-backend-beat
   ```

4. Check API readiness and worker logs.

TLS rotation:

1. Rotate through cert-manager or update the TLS Secret.
2. Confirm ingress picks up the new certificate.
3. Verify browser access to frontend and API hosts.

Model volume update:

1. Publish new model assets to the model PVC through a controlled job.
2. Run worker runtime checks in staging.
3. Roll worker pods.
4. Validate import/render/playback smoke tests.

## Do Not Commit

Never commit:

- real Kubernetes Secret manifests;
- real `.env` files;
- production database URLs;
- Redis URLs;
- object storage access keys;
- mail provider API keys;
- TLS private keys;
- kubeconfig files;
- production host substitutions in public template overlays.
