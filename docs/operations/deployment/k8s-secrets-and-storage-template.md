# Kubernetes Secrets And Storage Template

This document defines the production naming and ownership contract for
NoteVerse Kubernetes Secrets, PVCs, object storage buckets, TLS assets, model
volumes, and GPU node labels.

It intentionally does not contain real Secret manifests or credentials.

Related documents:

- `docs/architecture/runtime/k8s-application-runtime-contract.md`
- `docs/operations/deployment/k8s-deployment-runbook.md`
- `docs/operations/deployment/k8s-production-preflight-checklist.md`

## Namespace Scope

Application Secrets and PVCs are namespace-scoped.

Recommended namespaces:

```text
noteverse-staging
noteverse-production
```

Do not share application Secrets across staging and production.

## Runtime Secrets

Each database-connected process uses its own PostgreSQL login and Kubernetes
Secret. The [runtime ownership contract](../../architecture/runtime/settings-ownership.md)
defines the exact keys, ConfigMaps and settings schemas. The
[database role contract](../../architecture/runtime/database-role-ownership.md)
defines grants, provisioning and guarded erasure functions.

| Process | Secret |
| --- | --- |
| Migrator | `noteverse-migrator-secret` |
| Customer API | `noteverse-customer-api-secret` |
| Control Plane | `noteverse-control-plane-secret` |
| Worker | `noteverse-worker-secret` |
| Beat | `noteverse-beat-secret` |
| Exporter | `noteverse-observability-secret` |

Each workload references individual keys from its own Secret. Public settings
come from its own ConfigMap. Secret env files contain exactly the keys in
`backend/db/secret-templates/<runtime>.env.example`; actual values remain outside
Git. Apply each file through `scripts/validate_runtime_secrets.py` before creating
its Secret. `minikube_app_release_prepare.ps1 -RuntimeSecretDirectory <directory>`
validates and creates all six. Without that argument it validates the six Secrets
already present in the namespace. Separate databases, passwords and credentials
are required for staging and production. Rotation restarts only affected workloads.

Model initialization uses optional `noteverse-model-assets-secret` with `HF_TOKEN`
only. This auxiliary download credential contains no database, authentication,
mail or application object-storage keys. PaddleOCR receives no Secrets.
Registry, TLS and observability stack storage Secrets have separate infrastructure
ownership and are not injected into application process environments.

Prefer an external secret manager for real clusters; this repository defines
references and validation, not populated production Secret objects.

## Registry Pull Secret

Required name:

```text
Secret/noteverse-registry-credentials
```

Purpose:

- allow Kubernetes nodes to pull private backend/Customer Web images from GHCR or a
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

This Kubernetes pull Secret is not the same credential used by GitHub Actions
to push images. CI image publishing uses repository secrets named
`GHCR_USERNAME` and `GHCR_TOKEN` when the default `GITHUB_TOKEN` does not have
write access to the target GHCR package namespace. The Kubernetes Secret should
remain read-only.

## Frontend Secret

The frontend currently does not require a dedicated Secret.

Frontend runtime configuration is public origin and cookie/header naming, so it
belongs in:

```text
ConfigMap/noteverse-customer-web-config
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
- TLS Secret names must match the application overlay Gateway;
- include both frontend and API hosts in the certificate SAN list.

## Object Storage

Application production bucket:

```text
noteverse-app-assets-production
```

Application staging bucket:

```text
noteverse-app-assets-staging
```

Required backend config keys:

- One configured ObjectStorage namespace
- `S3_ENDPOINT_URL`
- `S3_REGION`
- `S3_BUCKET`
- `S3_FORCE_PATH_STYLE`
- `OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS`

Customer API and Worker each receive their own bucket credentials in
`noteverse-customer-api-secret` and `noteverse-worker-secret`:

- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Rules:

- credentials should be scoped to the intended bucket;
- staging credentials must not access production buckets;
- object storage lifecycle rules should be reviewed before enabling automatic
  deletion;
- product storage usage is database-backed and must not use bucket listing as
  the billing source of truth.

### Observability Object Storage

Loki and Tempo must use dedicated buckets. Do not share the application asset
bucket.

Recommended staging buckets:

```text
noteverse-loki-staging
noteverse-tempo-staging
```

Recommended production buckets:

```text
noteverse-loki-production
noteverse-tempo-production
```

Required Secret:

```text
Namespace: observability
Secret: observability-s3
```

Required keys:

| Key | Owner |
| --- | --- |
| `LOKI_S3_ENDPOINT` | platform/observability |
| `LOKI_S3_REGION` | platform/observability |
| `LOKI_S3_BUCKET` | platform/observability |
| `LOKI_S3_ACCESS_KEY_ID` | platform/observability |
| `LOKI_S3_SECRET_ACCESS_KEY` | platform/observability |
| `TEMPO_S3_ENDPOINT` | platform/observability |
| `TEMPO_S3_REGION` | platform/observability |
| `TEMPO_S3_BUCKET` | platform/observability |
| `TEMPO_S3_ACCESS_KEY_ID` | platform/observability |
| `TEMPO_S3_SECRET_ACCESS_KEY` | platform/observability |

Rules:

- `LOKI_S3_ENDPOINT` is a URL; `TEMPO_S3_ENDPOINT` is the corresponding
  hostname without an `http://` or `https://` scheme.
- apply aggressive lifecycle policies to Loki and Tempo buckets according to
  retention;
- do not grant application pods access to observability buckets;
- do not grant Loki or Tempo access to application asset buckets;
- never promote request IDs, user IDs, score IDs, job IDs, emails, storage
  keys, or raw paths to Loki labels.

## PVCs

### Observability PVCs

Prometheus, Alertmanager, and Grafana use PVC-backed storage. Loki and Tempo use
S3-compatible object storage and should not rely on local filesystem storage in
staging or production.

Minikube/staging standard:

```text
StorageClass/noteverse-local-lvm
```

Implemented by OpenEBS Local PV LVM over an LVM volume group on each minikube node.

Production standard:

```text
managed cloud block storage CSI, or operator-managed local PV for self-managed local SSD clusters
```

Examples:

```text
AWS EBS CSI
GCE PD CSI
Azure Disk CSI
Cloud-provider managed disk CSI
```

For self-managed clusters with local SSDs, use an operator-managed local PV
provisioner such as OpenEBS Local PV LVM or OpenEBS Local PV ZFS. Do not use direct
workload `hostPath` mounts for Prometheus.

### Node-Local Model Cache

Required node label:

```text
noteverse.io/model-cache=enabled
```

Mounted at:

```text
node: /var/lib/noteverse/models
container: /opt/noteverse/models
```

Used by:

- `backend-worker` read-only.

Contains:

- soundfonts;
- PaddleOCR models;
- HuggingFace model cache;
- any other offline model assets required by runtime checks.

Rules:

- mount read-only in app pods;
- update through the `model-cache-agent` DaemonSet;
- do not let worker jobs mutate the node-local model cache.

Initialization contract:

1. Label model-capable nodes with `noteverse.io/model-cache=enabled`.
2. Run `DaemonSet/noteverse-model-cache-agent` with the backend runtime image
   and the same backend ConfigMap/Secret used by the application.
3. The DaemonSet writes assets to `/var/lib/noteverse/models` and validates the
   asset set.
4. Only after the DaemonSet is ready should worker pods run on those nodes.

`HF_TOKEN` is required when the selected Hugging Face repositories are gated.
Do not commit this token or bake it into images.

### Legato Repository

Legato source code is part of the backend runtime image. Kubernetes should not
provide a source-code PVC for Legato.

Runtime path:

```text
/opt/noteverse/legato
```

Rules:

- contents must match the source-owned `LegatoExecutionManifest` commit;
- worker runtime checks should fail when repository metadata does not match;
- update Legato by changing `backend/app/processing/engines/omr/legato_manifest.py`
  and rebuilding the worker dependency/runtime images, not by mutating a live
  volume.

### Beat Work State

Celery beat uses an `emptyDir` work volume mounted at:

```text
/var/lib/noteverse/work
```

Used by:

- `backend-beat`.

Rules:

- beat remains singleton;
- Postgres/outbox tables are the durable scheduling source of truth;
- Celery's local schedule file is transient runtime state and must not require a
  PVC;
- if beat is replaced by a database-backed or leader-elected scheduler, keep the
  same rule: scheduler durability belongs in the database, not in pod-local
  files.

## Runtime Work Volumes

API, worker, and beat use `emptyDir` for runtime work paths in the public
templates.

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
2. Confirm the Gateway serves the new certificate.
3. Verify browser access to frontend and API hosts.

Model volume update:

1. Publish new model assets through `DaemonSet/noteverse-model-cache-agent` or
   an equivalent controlled node-local cache rollout.
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
