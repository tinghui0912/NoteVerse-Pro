# Minikube Local Kubernetes Runbook

This runbook defines how to use a local minikube cluster to validate the
NoteVerse Kubernetes deployment path before a managed cloud cluster exists.

Minikube is useful for Kubernetes integration tests, but it is not a production
equivalent. Use it to validate manifest rendering, pod wiring, probes, Services,
Ingress paths, ConfigMaps, Secrets, PVC references, image startup, and basic
smoke flows. Do not use it as proof of production capacity, high availability,
object storage behavior, TLS behavior, GPU scheduling, or managed database
behavior.

Related documents:

- `docs/k8s-deployment-runbook.md`
- `docs/container-image-build-strategy.md`
- `docs/k8s-secrets-and-storage-template.md`
- `docs/k8s-production-preflight-checklist.md`

## Recommended Scope

Good local checks:

- Kustomize overlays render successfully;
- strict manifest validation passes after local values are substituted;
- frontend and backend pods start;
- migration job wiring is correct;
- API health endpoints are reachable;
- frontend can call `/api/v1` through the local ingress or port-forward path;
- realtime connections can be manually tested;
- worker/beat wiring can be tested when Redis, database, model assets, and
  runtime volumes are available locally.

Not representative:

- production ingress controller behavior;
- production TLS and certificate automation;
- object storage latency, lifecycle, and permissions;
- managed PostgreSQL/Redis behavior;
- GPU node scheduling and model-volume performance;
- horizontal scaling and node failure behavior.

## Start Cluster

Windows PowerShell:

```powershell
minikube start --driver=docker --cpus=6 --memory=12288
minikube addons enable ingress
kubectl create namespace noteverse-staging
```

If the cluster already exists, check status:

```powershell
minikube status
kubectl get nodes
kubectl get ns
```

For multi-node cache topology experiments, add a worker node instead of
rebuilding the cluster:

```powershell
minikube node add --worker
kubectl get nodes -o wide
```

Multi-node minikube requires a CNI. If the cluster was created without one and
the new node remains `NotReady` with `cni config uninitialized`, install a CNI
such as Flannel:

```powershell
kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
kubectl -n kube-flannel rollout status ds/kube-flannel-ds
kubectl wait --for=condition=Ready node/<worker-node-name> --timeout=180s
```

## Build And Load Local Images

Build production-style runtime images locally:

```powershell
docker build `
  -f docker/backend/Dockerfile.runtime `
  --build-arg PYTHON_IMAGE=noteverse-ml-base:py312-torch260-cu124 `
  --build-arg INSTALL_DEV_DEPS=false `
  --build-arg INSTALL_GPU_DEPS=true `
  --build-arg INSTALL_PADDLE_GPU=false `
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false `
  -t noteverse-backend:local `
  .

docker build `
  -f docker/frontend/Dockerfile.runtime `
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 `
  --build-arg SESSION_COOKIE_NAME=noteverse_session `
  --build-arg SESSION_REFRESH_COOKIE_NAME=noteverse_refresh `
  -t noteverse-frontend:local `
  .
```

Load images into minikube:

```powershell
minikube image load noteverse-backend:local
minikube image load noteverse-frontend:local
```

Use `IfNotPresent` images and local tags in the rendered overlay for local
testing. Production and CI release overlays should still use immutable registry
tags or image digests.

## Required Local Resources

Create a local registry pull Secret only if the rendered overlay references one.
For local images loaded into minikube, prefer a local overlay that omits private
registry pull requirements. If testing GHCR pulls, create a real read-only GHCR
Secret in the namespace:

```powershell
kubectl -n noteverse-staging create secret docker-registry noteverse-registry-credentials `
  --docker-server=ghcr.io `
  --docker-username=<github-user> `
  --docker-password=<read-packages-token> `
  --docker-email=<email>
```

Create app Secrets with local-only values. Do not reuse production credentials.

When updating an existing Kubernetes Secret, avoid applying a partial Secret
manifest unless replacement is intentional. `kubectl apply` treats the Secret as
the whole desired object; a manifest containing only `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` will remove required keys such as `SECRET_KEY`,
`DATABASE_URL`, and `REDIS_URL`.

For local minikube, either render the full Secret from `backend/.env.docker`, or
patch a single key deliberately:

```powershell
kubectl -n noteverse-staging patch secret noteverse-backend-secret --type merge `
  -p '{\"data\":{\"KEY\":\"BASE64_VALUE\"}}'
```

Do not print credential values in terminal output or commit generated Secret
manifests.

Create or bind PVCs for:

- model assets;
- Legato repository;
- beat work directory;
- object/file storage if the selected local storage path requires a volume.

For API/frontend-only smoke tests, it is acceptable to scale worker and beat to
zero in a dedicated local overlay. For import, render, playback, and cleanup
tests, worker and beat must run with their required runtime assets.

## Use Test S3 Storage

To keep minikube close to production, use the test S3-compatible bucket from
`backend/.env.docker` for business uploads, score sources, rendered images, and
audio assets.

Update the generated local backend ConfigMap so it uses:

```text
FILE_STORAGE_BACKEND=s3
S3_ENDPOINT_URL=<from backend/.env.docker>
S3_REGION=<from backend/.env.docker>
S3_BUCKET=<from backend/.env.docker>
S3_PUBLIC_BASE_URL=<from backend/.env.docker>
S3_FORCE_PATH_STYLE=<from backend/.env.docker>
S3_PRESIGN_EXPIRE_SECONDS=<from backend/.env.docker>
```

Update `Secret/noteverse-backend-secret` with the full required Secret key set,
including:

```text
SECRET_KEY
DATABASE_URL
SYNC_DATABASE_URL
REDIS_URL
CELERY_BROKER_URL
CELERY_RESULT_BACKEND
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
RESEND_API_KEY
HF_TOKEN, when gated Hugging Face model initialization is needed
```

Then restart backend workloads:

```powershell
kubectl -n noteverse-staging rollout restart deployment/noteverse-backend-api deployment/noteverse-backend-worker deployment/noteverse-backend-beat
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-api
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-worker
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-beat
kubectl -n noteverse-staging exec deploy/noteverse-backend-api -- python /app/scripts/check_runtime.py --role api
```

Run a low-cost S3 and quota smoke before triggering a full OMR import. This
checks the real API, auth cookies, object storage adapter, upload quota
reservation, usage commit, deletion, and quota release path without invoking the
large OMR model:

```powershell
kubectl -n noteverse-staging port-forward svc/noteverse-backend-api 18000:8000
```

Use the repository smoke script as the standard entry point:

```powershell
python scripts/k8s_smoke_storage.py `
  --api-base http://127.0.0.1:18000/api/v1 `
  --ensure-user
```

In another shell, create or reset a local smoke user:

```powershell
$script = @'
from sqlalchemy import select
from app.core.security import get_password_hash
from app.db.worker_session import SessionLocal
from app.db.models.user import User
from app.utils.timezone import utc_now_naive

email = "k8s-smoke@example.com"
password = "SmokePass123!"
with SessionLocal() as db:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        now = utc_now_naive()
        user = User(
            email=email,
            display_name="K8s Smoke",
            password_hash=get_password_hash(password),
            is_active=True,
            email_verified_at=now,
            password_changed_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
    else:
        user.password_hash = get_password_hash(password)
        user.is_active = True
        user.email_verified_at = user.email_verified_at or utc_now_naive()
    db.commit()
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
kubectl -n noteverse-staging exec deploy/noteverse-backend-api -- python -c "import base64; exec(base64.b64decode('$encoded').decode())"
```

Then run the HTTP smoke from the repository root:

```powershell
$script = @'
from pathlib import Path
import requests

base = "http://127.0.0.1:18000/api/v1"
session = requests.Session()
login = session.post(
    f"{base}/auth/login",
    data={"username": "k8s-smoke@example.com", "password": "SmokePass123!"},
    timeout=30,
)
login.raise_for_status()
csrf = session.cookies.get("noteverse_csrf")
headers = {"x-csrf-token": csrf} if csrf else {}

before = session.get(f"{base}/me/storage-usage", timeout=30).json()["data"]["quota"]["used_bytes"]
image_path = Path("frontend/public/images/placeholders/score-example.jpg")
with image_path.open("rb") as fh:
    uploaded = session.post(
        f"{base}/files/upload",
        files={"file": (image_path.name, fh, "image/jpeg")},
        headers=headers,
        timeout=60,
    )
uploaded.raise_for_status()
file_id = uploaded.json()["data"]["file_id"]
after_upload = session.get(f"{base}/me/storage-usage", timeout=30).json()["data"]["quota"]["used_bytes"]
deleted = session.delete(f"{base}/files/{file_id}", headers=headers, timeout=60)
deleted.raise_for_status()
after_delete = session.get(f"{base}/me/storage-usage", timeout=30).json()["data"]["quota"]["used_bytes"]
print({
    "file_id": file_id,
    "upload_delta": after_upload - before,
    "delete_delta": after_delete - before,
})
if after_upload <= before or after_delete != before:
    raise SystemExit("S3 upload quota smoke failed")
'@
python -c $script
```

Expected result:

```text
upload_delta > 0
delete_delta == 0
```

This validates business upload storage and quota release. It does not validate
the full OMR pipeline, score confirmation, render assets, playback assets, or
cleanup worker behavior.

After the upload quota smoke passes, validate derived assets without invoking
the full OMR model. Create a tiny, valid MusicXML score through application
models, enqueue the existing render and playback outboxes, and let the worker
generate the derived objects. The important checks are:

```powershell
python scripts/k8s_smoke_derived_assets.py `
  --api-base http://127.0.0.1:18000/api/v1 `
  --ensure-user
```

The derived-assets smoke deletes the test score and triggers cleanup by default.
Use `--keep-on-failure` only when you intentionally want to inspect failed test
data.

```text
score_revision_sources:
  SOURCE allocation is recorded for the owner.

render_outbox:
  PENDING -> DISPATCHED -> PROCESSING -> COMPLETED
  score_render_assets contains at least one RENDERED_PAGE.
  DERIVED_RENDER allocation is recorded for internal usage.

playback_outbox:
  PENDING -> DISPATCHED -> PROCESSING -> COMPLETED
  score_playback_assets contains one AUDIO asset.
  DERIVED_AUDIO allocation is recorded for internal usage.
```

Then verify the public delivery model:

```text
GET /api/v1/scores/{score_id}
  derived_assets.preview.status == ready
  derived_assets.audio.status == ready

POST /api/v1/scores/{score_id}/grants with allow_download=false
GET /api/v1/score-grants/{token}
  derived_assets.preview.status == ready
  derived_assets.audio.status == ready
  capabilities.can_download == false
  revision_assets.revision_sources == []

PUT /api/v1/scores/{score_id}/publication with allow_download=false
GET /api/v1/publications/{slug}
  derived_assets.preview.status == ready
  derived_assets.audio.status == ready
  capabilities.can_download == false
  revision_assets.revision_sources == []

GET /api/v1/score-grants/{token}/playback
GET /api/v1/publications/{slug}/playback
  returns a stream or an object-storage redirect.
```

Finally delete the score through the product API:

```text
POST /api/v1/scores/batch-delete
```

Allow `run_score_deletion_cleanup` to run through beat, or trigger it manually
in a local smoke environment:

```powershell
kubectl -n noteverse-staging exec deploy/noteverse-backend-worker -- python -c "from app.worker.tasks import run_score_deletion_cleanup; print(run_score_deletion_cleanup())"
```

Expected cleanup result for the smoke owner:

```text
SOURCE used_bytes == 0
DERIVED_RENDER used_bytes == 0
DERIVED_AUDIO used_bytes == 0
```

The score should no longer be visible through `/api/v1/scores/{score_id}` after
the delete request is accepted, even if the hard-delete worker has not finished
yet.

## Initialize Model Assets

For worker smoke tests, initialize the model PVC from inside Linux rather than
copying a Windows Hugging Face cache. Windows cache snapshots may contain NTFS
reparse points that do not survive `kubectl cp` or tar extraction into Linux.

Create the PVC before running the job:

```powershell
kubectl -n noteverse-staging create pvc noteverse-model-assets `
  --storage=40Gi `
  --access-modes=ReadWriteOnce
```

If the selected Hugging Face repositories are gated, add an `HF_TOKEN` key to
`Secret/noteverse-backend-secret` before running the job.

Patch the job image to the local backend image tag and run it:

```powershell
Copy-Item deploy\application\jobs\model-assets-init-job.yaml build\k8s-release\minikube\model-assets-init-job.yaml

(Get-Content build\k8s-release\minikube\model-assets-init-job.yaml) `
  -replace 'image: noteverse-backend:replace-me', 'image: noteverse-backend:local' |
  Set-Content build\k8s-release\minikube\model-assets-init-job.yaml

kubectl -n noteverse-staging apply -f build\k8s-release\minikube\model-assets-init-job.yaml
kubectl -n noteverse-staging wait --for=condition=complete job/noteverse-model-assets-init --timeout=7200s
kubectl -n noteverse-staging logs job/noteverse-model-assets-init
```

If the job fails because Hugging Face access is missing, fix the Secret and
recreate the job. Do not enable worker replicas until the model initialization
job succeeds.

## Multi-Node Model Cache Simulation

The real model cache can be too large to duplicate on every local minikube
node. For architecture validation, keep the real worker pinned to the node that
has the initialized model PVC and use a lightweight DaemonSet to simulate the
future per-node model cache agent.

Label nodes that should participate in worker/cache experiments:

```powershell
kubectl label node minikube noteverse.io/workload=worker --overwrite
kubectl label node minikube-m02 noteverse.io/workload=worker --overwrite
```

Pin the current real worker to the node that owns the real model cache:

```powershell
kubectl label node minikube noteverse.io/real-model-cache=ready --overwrite
kubectl -n noteverse-staging patch deployment noteverse-backend-worker --type merge `
  -p '{\"spec\":{\"template\":{\"spec\":{\"nodeSelector\":{\"noteverse.io/real-model-cache\":\"ready\"}}}}}'
```

Use the lightweight DaemonSet template to validate the node-local cache shape:

```powershell
kubectl apply -f deploy\application\model-cache\model-cache-sim-daemonset.yaml
kubectl -n noteverse-model-cache-test rollout status ds/noteverse-model-cache-sim
kubectl -n noteverse-model-cache-test get pods -o wide
```

This validates DaemonSet scheduling and node-local cache layout without
duplicating the full Llama model on every local node. Production can evolve from
`deploy/application/model-cache/model-cache-agent-daemonset.yaml`, which uses the
backend runtime image and `backend/scripts/prepare_model_assets.py --check-scope assets`.
A real production agent still needs a deliberate node-readiness policy, such as
node labels, taints/tolerations, or a dedicated scheduling controller.

## Render Local Overlay

Use the release overlay renderer with local hosts and local image tags:

```powershell
python scripts/render_k8s_release_overlay.py `
  --environment staging `
  --output build/k8s-release/minikube `
  --backend-image noteverse-backend:local `
  --frontend-image noteverse-frontend:local `
  --frontend-host noteverse.local `
  --api-host api.noteverse.local `
  --tls-secret noteverse-local-tls `
  --frontend-base-url http://noteverse.local `
  --backend-cors-origins '["http://noteverse.local"]' `
  --mail-default-sender 'NoteVerse Pro <no-reply@noteverse.local>' `
  --s3-endpoint-url http://minio.noteverse.local `
  --s3-public-base-url http://objects.noteverse.local
```

Validate the rendered overlay:

```powershell
python scripts/check_k8s_application_manifests.py build/k8s-release/minikube --strict
kubectl kustomize build/k8s-release/minikube
```

If local testing intentionally omits production-only objects such as TLS or
image pull Secrets, use a dedicated local overlay rather than weakening the
strict validator.

## Apply And Smoke Test

Apply manifests:

```powershell
kubectl -n noteverse-staging apply -k build/k8s-release/minikube
kubectl -n noteverse-staging get pods -w
```

Check rollouts:

```powershell
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-api
kubectl -n noteverse-staging rollout status deployment/noteverse-frontend
```

Port-forward smoke path:

```powershell
kubectl -n noteverse-staging port-forward svc/noteverse-backend-api 8000:8000
curl.exe -f http://127.0.0.1:8000/health/live
curl.exe -f http://127.0.0.1:8000/health/ready
```

Frontend smoke path:

```powershell
kubectl -n noteverse-staging port-forward svc/noteverse-frontend 9002:3000
```

Open:

```text
http://127.0.0.1:9002
```

Ingress smoke requires local DNS or hosts-file entries for the selected local
hosts.

## Local Cleanup

Remove local resources:

```powershell
kubectl delete namespace noteverse-staging
```

Or delete the minikube cluster:

```powershell
minikube delete
```

## Production Boundary

Before moving from minikube to a cloud cluster, still validate:

- production-grade Secrets and Secret rotation;
- external PostgreSQL and Redis;
- object storage permissions and lifecycle;
- TLS and public ingress behavior;
- observability pipeline with Fluent Bit, Loki, Prometheus, Grafana, Tempo, and
  OpenTelemetry Collector;
- worker runtime assets and scheduling;
- backup, restore, and disaster recovery procedures.
