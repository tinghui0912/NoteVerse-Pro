# Minikube Local Kubernetes Reference

This document is a legacy reference for local minikube troubleshooting details.
It is not the authoritative from-zero deployment path.

Use [Minikube From Zero Runbook](minikube-from-zero.md) for staging rehearsal.
That runbook uses the current production-shaped path:

- GHCR images;
- real test domains;
- cert-manager;
- Gateway API and Envoy Gateway;
- S3-compatible object storage;
- qemu2 minikube with extra block disks;
- LVM and `StorageClass/noteverse-local-lvm`;
- Docker Compose worker until a Kubernetes GPU worker node is available.

Do not use this document to create a new environment unless the from-zero
runbook explicitly links to a subsection here.

## Scope

This reference keeps operational notes that are still useful when debugging the
local staging environment:

- managed-like PostgreSQL and Redis access from minikube;
- DNS behavior;
- Gateway and port-forward notes;
- historical pitfalls.

It no longer defines image publishing, storage, model cache, or the release
overlay flow.

## Historical Context

This runbook originally defined how to use a local minikube cluster to validate
the NoteVerse Kubernetes deployment path before a managed cloud cluster existed.

Minikube is the local staging rehearsal environment for NoteVerse. Keep its
Kubernetes resource model production-shaped: Gateway API, Envoy Gateway,
cert-manager, S3-compatible object storage, node-local model cache, managed-like
PostgreSQL/Redis endpoints, rendered release overlays, and the same Secret and
ConfigMap contracts used by production.

Related documents:

- `docs/operations/runbooks/minikube-from-zero.md`
- `docs/operations/deployment/k8s-deployment-runbook.md`
- `docs/operations/release/container-image-build-strategy.md`
- `docs/operations/deployment/k8s-secrets-and-storage-template.md`
- `docs/operations/deployment/k8s-production-preflight-checklist.md`

## Recommended Scope

Good local checks:

- Kustomize overlays render successfully;
- strict manifest validation passes after local values are substituted;
- frontend and backend pods start;
- migration job wiring is correct;
- API health endpoints are reachable;
- frontend can call `/api/v1` through Gateway API and Envoy Gateway;
- realtime connections can be manually tested;
- worker/beat wiring can be tested when Redis, database, model assets, and
  runtime volumes are available locally.

Not representative:

- managed PostgreSQL/Redis behavior;
- GPU node scheduling and model-volume performance;
- horizontal scaling and node failure behavior.

## Historical Docker Driver Start

The Docker driver path below is kept only as historical context and quick
debugging fallback. It is not production-shaped because Docker-driver minikube
cannot attach extra block devices for LVM.

For production-like staging, use:

```powershell
.\scripts\minikube_start_lvm_profile.ps1
```

from [Minikube From Zero Runbook](minikube-from-zero.md).

### Legacy Command

Windows PowerShell:

```powershell
minikube start --driver=docker --cpus=6 --memory=12288 --nodes=1
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

For two-node Docker driver testing on Windows/WSL, verify Pod DNS from a Pod on
each node before debugging application code. Keep `kube-dns` on normal
cluster-wide endpoint routing. Do not set `internalTrafficPolicy: Local` on
`kube-dns`: if CoreDNS is temporarily scheduled away from a node, pods on that
node can have their DNS traffic dropped.

If DNS is unhealthy after adding a second node, scale CoreDNS to two replicas,
restart it, and explicitly remove any local-only DNS service policy:

```powershell
kubectl -n kube-system scale deployment coredns --replicas=2
kubectl -n kube-system rollout status deployment/coredns --timeout=180s
kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide

kubectl -n kube-system patch svc kube-dns --type='json' -p '[{"op":"remove","path":"/spec/internalTrafficPolicy"}]'
```

The same local-only check and fix is available through:

```powershell
.\scripts\minikube_bootstrap.ps1 -ApplyDnsFix
```

This is a minikube stability adjustment for a local two-node topology. In a
managed production cluster, CoreDNS should already run with multiple replicas
and healthy cluster networking; do not use local minikube patches as a
substitute for production DNS and CNI health checks.

## Install Platform Entry Point

Use a Cloudflare API token scoped to the test zone and limited to `Zone:Read`
and `DNS:Edit`. Then run the platform bootstrap script:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<cloudflare-api-token>"
.\scripts\minikube_platform_bootstrap.ps1
```

The script installs and verifies:

- Gateway API CRDs;
- Envoy Gateway through the official OCI Helm chart;
- `GatewayClass/envoy-gateway`;
- cert-manager;
- `Secret/cert-manager/cloudflare-api-token-secret`;
- `ClusterIssuer/letsencrypt-staging-dns01`;
- `ClusterIssuer/letsencrypt-production-dns01`;
- the application namespace.

If `Secret/cloudflare-api-token-secret` already exists and you only want to
reconcile platform components, run:

```powershell
.\scripts\minikube_platform_bootstrap.ps1 -SkipCloudflareSecret
```

The Envoy Gateway control-plane Service is intentionally `ClusterIP`. The
browser-facing Service is created later by Envoy Gateway for the NoteVerse
`Gateway`.

Enable MetalLB when the minikube driver does not provide a cloud load balancer.
This gives the Envoy data-plane `LoadBalancer` Service a stable local external
IP, which is closer to the production traffic model than using a frontend
Service port-forward:

```powershell
minikube addons enable metallb
minikube addons configure metallb
```

For the current Docker-driver rehearsal, use a pool inside the minikube network,
for example:

```text
192.168.49.240-192.168.49.250
```

The script installs Gateway API CRDs before Helm and passes
`--set crds.enabled=false` to the Envoy Gateway chart. Do not let both Helm and
`kubectl` manage the same Gateway API CRDs.

## Build And Publish Local Images

Build production-style runtime images locally:

```powershell
$ghcrOwner = "<github-owner>"
$imageTag = "dev-$(git rev-parse --short HEAD)-$(Get-Date -Format yyyyMMddHHmmss)"
$mlBaseImage = "ghcr.io/$ghcrOwner/noteverse/ml-base:py312-torch260-cu124-slim"
$workerDepsImage = "ghcr.io/$ghcrOwner/noteverse/backend-worker-deps:deps-$imageTag"

docker build `
  -f docker/backend/Dockerfile.api `
  -t noteverse-backend-api:$imageTag `
  .

docker build `
  -f docker/backend/Dockerfile.beat `
  -t noteverse-backend-beat:$imageTag `
  .

docker build `
  -f docker/backend/Dockerfile.worker-deps `
  --build-arg PYTHON_IMAGE=$mlBaseImage `
  --build-arg INSTALL_PADDLE_GPU=false `
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false `
  --build-arg LEGATO_REPO_URL=https://github.com/guang-yng/legato.git `
  --build-arg LEGATO_REPO_COMMIT=179c228d3d5f67113cf739b44891b3abe046f1dc `
  -t noteverse-backend-worker-deps:$imageTag `
  .

docker build `
  -f docker/backend/Dockerfile.worker `
  --build-arg WORKER_DEPS_IMAGE=noteverse-backend-worker-deps:$imageTag `
  -t noteverse-backend-worker:$imageTag `
  .

docker build `
  -f docker/customer-web/Dockerfile.runtime `
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 `
  --build-arg NEXT_PRACTICE_ORIGIN=http://noteverse-backend-practice:8000 `
  --build-arg SESSION_COOKIE_NAME=noteverse_session `
  --build-arg SESSION_REFRESH_COOKIE_NAME=noteverse_refresh `
  -t noteverse-customer-web:$imageTag `
  .
```

The worker build requires the ML base image to exist in GHCR. If it does not
exist yet, run the GitHub Actions `ML Base Image` workflow first, or build and
push the base image manually:

```powershell
docker build `
  -f docker/backend/Dockerfile.ml-base `
  -t $mlBaseImage `
  .

docker push $mlBaseImage
```

Use a real registry route for local Kubernetes releases. Do not use
`minikube image load` for NoteVerse staging validation: it does not exercise the
same image-pull path as production and is especially easy to misuse in
multi-node clusters.

`minikube docker-env` is intentionally unavailable for multi-node clusters. If
you see `ENV_MULTINODE_CONFLICT`, use the registry route rather than patching
Pods to a specific node.

For production-shaped staging rehearsal, publish images to GitHub Container
Registry (GHCR), the same registry family used by CI:

```powershell
$backendApiImage = "ghcr.io/$ghcrOwner/noteverse/backend-api:$imageTag"
$backendBeatImage = "ghcr.io/$ghcrOwner/noteverse/backend-beat:$imageTag"
$backendWorkerDepsImage = "ghcr.io/$ghcrOwner/noteverse/backend-worker-deps:deps-$imageTag"
$backendWorkerImage = "ghcr.io/$ghcrOwner/noteverse/backend-worker:$imageTag"
$customerWebImage = "ghcr.io/$ghcrOwner/noteverse/customer-web:$imageTag"

docker tag noteverse-backend-api:$imageTag $backendApiImage
docker tag noteverse-backend-beat:$imageTag $backendBeatImage
docker tag noteverse-backend-worker-deps:$imageTag $backendWorkerDepsImage
docker tag noteverse-backend-worker:$imageTag $backendWorkerImage
docker tag noteverse-customer-web:$imageTag $customerWebImage
docker push $backendApiImage
docker push $backendBeatImage
docker push $backendWorkerDepsImage
docker push $backendWorkerImage
docker push $customerWebImage
```

API/beat/migration and worker/model-cache-agent intentionally use split backend
images. Push explicit role images under the same namespace:

```powershell
docker push ghcr.io/$ghcrOwner/noteverse/backend-api:<tag>
docker push ghcr.io/$ghcrOwner/noteverse/backend-beat:<tag>
docker push ghcr.io/$ghcrOwner/noteverse/backend-worker-deps:<tag>
docker push ghcr.io/$ghcrOwner/noteverse/backend-worker:<tag>
docker push ghcr.io/$ghcrOwner/noteverse/customer-web:<tag>
```

Kubernetes pulls private GHCR images through
`Secret/noteverse-registry-credentials`. Use GHCR references in rendered
manifests and one-off rollout commands:

```powershell
kubectl -n noteverse-staging set image deployment/noteverse-backend-api `
  api=ghcr.io/$ghcrOwner/noteverse/backend-api:<tag>
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-api
```

Use `IfNotPresent` only with immutable tags. Production and CI release overlays
should use immutable registry tags or image digests.

## Required Local Resources

Create a registry pull Secret only if the rendered overlay references a private
registry that requires authentication. GHCR images are private by default in
this project, so create a real read-only GHCR Secret in the namespace.

The standard scripted path is:

```powershell
$env:GHCR_TOKEN = "<github-token-with-read-packages>"

.\scripts\minikube_app_release_prepare.ps1 `
  -RenderedOverlay build/k8s-release/minikube `
  -CreateRegistrySecretFromToken `
  -RegistryUsername "<github-username>" `
  -BackendSecretEnvFile C:\path\to\noteverse-staging-backend-secret.env
```

This validates the rendered overlay, creates or verifies
`Secret/noteverse-registry-credentials`, and creates or verifies
`Secret/noteverse-backend-secret` with the required key set.

If you need to create the registry Secret manually, use:

```powershell
kubectl -n noteverse-staging create secret docker-registry noteverse-registry-credentials `
  --docker-server=ghcr.io `
  --docker-username=<github-user> `
  --docker-password=<read-packages-token> `
  --docker-email=<email>
```

Do not create the Secret from Docker Desktop's config file when it uses
`credsStore`. Docker can read the local credential store; Kubernetes nodes
cannot. If you use a portable Docker config that contains an actual `auth`
entry for `ghcr.io`, the script can validate and use it:

```powershell
.\scripts\minikube_app_release_prepare.ps1 `
  -RenderedOverlay build/k8s-release/minikube `
  -CreateRegistrySecretFromDockerConfig `
  -DockerConfigPath C:\path\to\portable-docker-config.json `
  -SkipBackendSecret
```

If authentication was performed inside the minikube node rather than the host
Docker client, copy the node's Docker config to a temporary file outside the
repository, create the Secret from that file, then delete the temporary file.
Do not commit Docker config files or generated Secret manifests.

Create app Secrets with local-only values. Do not reuse production credentials.
Prefer the scripted path above so the required key set is checked before
workloads are applied.

When updating an existing Kubernetes Secret, avoid applying a partial Secret
manifest unless replacement is intentional. `kubectl apply` treats the Secret as
the whole desired object; a manifest containing only `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` will remove required keys such as `SECRET_KEY`,
`DATABASE_URL`, and `REDIS_URL`.

For local minikube, either create the full Secret from an env file outside the
repository, or patch a single key deliberately:

```powershell
kubectl -n noteverse-staging patch secret noteverse-backend-secret --type merge `
  -p '{\"data\":{\"KEY\":\"BASE64_VALUE\"}}'
```

Do not print credential values in terminal output or commit generated Secret
manifests.

Do not create PVCs for application file storage in the production-shaped
minikube path. Business uploads, score sources, rendered images, and audio
assets must use the configured S3-compatible bucket.

Verify or create the bucket before deploying workloads:

```powershell
python scripts/ensure_s3_bucket.py --env-file backend/.env.docker --create
```

The script can also read S3 settings directly from environment variables. It
requires `boto3`, which is supplied by `backend/requirements/storage.txt` or by
the backend runtime images. It does not print access keys.

Model assets are node-local cache data under `/var/lib/noteverse/models`,
prepared by the model-cache DaemonSet and mounted read-only into worker pods at
`/opt/noteverse/models`.

Beat uses transient `emptyDir` state. Durable scheduling state lives in
PostgreSQL-backed outbox tables.

For the current minikube staging phase, Kubernetes GPU worker validation is
paused until a real GPU node is available. It is acceptable to scale
`backend-worker` to zero in minikube and run the worker locally through Docker
Compose against the same PostgreSQL, Redis, and S3 settings. Beat can remain in
Kubernetes if it points at the same Redis broker.

## Bind Host PostgreSQL And Redis Through Stable Services

For production-shaped local testing, keep application settings pointed at stable
Kubernetes service names instead of embedding a laptop IP in every Secret:

```text
noteverse-host-postgres.noteverse-staging.svc.cluster.local:5432
noteverse-host-redis.noteverse-staging.svc.cluster.local:6379
```

In minikube on Docker Desktop, the node usually reaches host services through
`host.minikube.internal` or the Docker Desktop host gateway address. Resolve it
from a node before creating the service binding:

```powershell
minikube ssh -- getent hosts host.minikube.internal
```

Create normal ClusterIP Services plus EndpointSlices. EndpointSlice is the
current Kubernetes API; avoid new `v1 Endpoints` manifests.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: noteverse-host-postgres
  namespace: noteverse-staging
spec:
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: noteverse-host-postgres
  namespace: noteverse-staging
  labels:
    kubernetes.io/service-name: noteverse-host-postgres
addressType: IPv4
ports:
  - name: postgres
    protocol: TCP
    port: 5432
endpoints:
  - addresses:
      - <host-gateway-ip>
---
apiVersion: v1
kind: Service
metadata:
  name: noteverse-host-redis
  namespace: noteverse-staging
spec:
  ports:
    - name: redis
      port: 6379
      targetPort: 6379
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: noteverse-host-redis
  namespace: noteverse-staging
  labels:
    kubernetes.io/service-name: noteverse-host-redis
addressType: IPv4
ports:
  - name: redis
    protocol: TCP
    port: 6379
endpoints:
  - addresses:
      - <host-gateway-ip>
```

Then set backend Secret values to use those service names:

```text
DATABASE_URL=postgresql+asyncpg://...@noteverse-host-postgres:5432/...
SYNC_DATABASE_URL=postgresql+psycopg://...@noteverse-host-postgres:5432/...
SCHEDULER_LOCK_DATABASE_URL=postgresql+psycopg://...@noteverse-host-postgres:5432/...
REDIS_URL=redis://noteverse-host-redis:6379/0
CELERY_BROKER_URL=redis://noteverse-host-redis:6379/0
CELERY_RESULT_BACKEND=redis://noteverse-host-redis:6379/1
```

This mirrors the production pattern: application workloads depend on stable
Kubernetes service names, while each environment decides whether those services
target local host services, managed PostgreSQL/Redis private endpoints, or an
in-cluster dependency used only for disposable tests.

## Use Test S3 Storage

To keep minikube close to production, use the test S3-compatible bucket from
`backend/.env.docker` for business uploads, score sources, rendered images, and
audio assets.

Update the generated local backend ConfigMap so it uses:

```text
FILE_STORAGE_BACKEND=s3
S3_ENDPOINT_URL=https://oss-cn-shenzhen.aliyuncs.com
S3_REGION=cn-shenzhen
S3_BUCKET=noteverse
S3_PUBLIC_BASE_URL=https://noteverse.oss-cn-shenzhen.aliyuncs.com
S3_FORCE_PATH_STYLE=false
S3_PRESIGN_EXPIRE_SECONDS=900
```

Update `Secret/noteverse-backend-secret` with the full required Secret key set,
including:

```text
SECRET_KEY
DATABASE_URL
SYNC_DATABASE_URL
SCHEDULER_LOCK_DATABASE_URL
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
.\scripts\start_minikube_gateway_port_forward.ps1
.\scripts\minikube_smoke_test.ps1 -RunStorageSmoke -EnsureSmokeUser
```

`scripts/k8s_smoke_storage.py` uses only the Python standard library for HTTP,
Cookie, CSRF, multipart upload, and quota reads. It creates or resets the smoke
user inside the backend API pod when `-EnsureSmokeUser` is provided.

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

## Initialize Node-Local Model Cache

The application overlay uses `model-cache-agent-daemonset.yaml` to prepare the
node-local model cache. The DaemonSet downloads or verifies model assets under
the node path `/var/lib/noteverse/models`. Worker pods mount the same node path
read-only at `/opt/noteverse/models`; API pods do not require model-cache
scheduling.

These paths are intentionally different:

- `/var/lib/noteverse/models` is the node storage contract. It belongs to the
  Kubernetes node and can be backed by local SSD, local PV, or another
  node-local storage implementation.
- `/opt/noteverse/models` is the application runtime contract. Backend code and
  runtime checks should only know this container path.

Do not make application code depend on the node path. Keeping the paths
separate preserves the Kubernetes storage abstraction while still giving the
application a stable, production-like mount location.

Label nodes that may run worker pods and therefore need a model cache:

```powershell
kubectl label node minikube noteverse.io/model-cache=enabled --overwrite
```

For a two-node local topology, label only nodes that have enough disk for the
model set:

```powershell
kubectl label node minikube noteverse.io/model-cache=enabled --overwrite
kubectl label node minikube-m02 noteverse.io/model-cache- --overwrite
```

If the selected Hugging Face repositories are gated, add an `HF_TOKEN` key to
`Secret/noteverse-backend-secret` before applying the overlay. Missing or
unauthorized model access should fail the model-cache DaemonSet; do not enable
worker smoke tests against a partial cache.

The model-cache agent prepares assets from these sources:

- Hugging Face snapshots are controlled by `HF_MODEL_REPOSITORIES` and are
  downloaded with `huggingface_hub.snapshot_download` into
  `/opt/noteverse/models/huggingface/hub`. The current staging and production
  overlays include `guangyangmusic/legato` and
  `meta-llama/Llama-3.2-11B-Vision`.
- `FluidR3_GM.sf2` is copied from the backend runtime image system soundfont
  directory into `/opt/noteverse/models/soundfonts/FluidR3_GM.sf2`.
- PaddleOCR inference models are downloaded explicitly from Paddle's official
  model package endpoint, extracted, and validated under
  `/opt/noteverse/models/paddleocr/official_models`.

Removing a repository from `HF_MODEL_REPOSITORIES` stops future validation and
downloads for that repository, but it does not delete previously cached files.
Clean stale node-local model cache explicitly after changing the model set:

```powershell
minikube ssh -- "sudo rm -rf /var/lib/noteverse/models/huggingface/hub/models--meta-llama--Llama-3.2-11B-Vision"
```

Wait for the model-cache DaemonSet before relying on worker tasks:

```powershell
kubectl -n noteverse-staging rollout status ds/noteverse-model-cache-agent --timeout=7200s
kubectl -n noteverse-staging get pods -l app.kubernetes.io/component=model-cache-agent -o wide
```

For architecture-only multi-node validation without downloading the full model
set on every node, use the lightweight simulation DaemonSet:

```powershell
kubectl label node minikube noteverse.io/workload=worker --overwrite
kubectl label node minikube-m02 noteverse.io/workload=worker --overwrite
kubectl apply -f deploy\application\model-cache\model-cache-sim-daemonset.yaml
kubectl -n noteverse-model-cache-test rollout status ds/noteverse-model-cache-sim
kubectl -n noteverse-model-cache-test get pods -o wide
```

The simulation validates DaemonSet scheduling and node-local cache layout only.
It does not prepare real OMR/playback model assets.

## Local DNS And TLS For Production-Shaped Testing

For the production-shaped minikube path, use a real test domain with
cert-manager, Let's Encrypt production, and Cloudflare DNS-01. This validates
the same certificate lifecycle shape that production will use, while keeping
the actual Redis, PostgreSQL, S3, Resend, and domain resources separate from
production.

Example staging hosts:

```text
staging.johnabc.ccwu.cc
admin.staging.johnabc.ccwu.cc
```

DNS-01 does not require the minikube cluster to be reachable from the public
internet. Cert-manager creates temporary `_acme-challenge` TXT records through
Cloudflare. Do not create those TXT records manually.

For browser traffic from the local machine, map the staging hosts to the local
Gateway entrypoint. When using an Envoy Gateway data-plane port-forward on
local port 443, use `127.0.0.1`:

```text
127.0.0.1 staging.johnabc.ccwu.cc
127.0.0.1 admin.staging.johnabc.ccwu.cc
```

On Windows, edit the hosts file from an elevated PowerShell:

```powershell
notepad C:\Windows\System32\drivers\etc\hosts
```

Apply the rendered application overlay, then wait for cert-manager:

```powershell
kubectl -n noteverse-staging get certificate,certificaterequest,order,challenge
kubectl -n noteverse-staging describe certificate noteverse-tls
```

Expected ACME rehearsal result:

```text
Certificate/noteverse-tls READY=True
issuer=Let's Encrypt production
```

The staging rehearsal uses a real browser-trusted Let's Encrypt certificate.
Avoid repeatedly deleting and recreating Certificates so local testing does not
burn production ACME rate limits.

Inspect the Gateway and the Envoy data-plane Service created for it:

```powershell
kubectl -n noteverse-staging get gateway noteverse -o wide
kubectl -n noteverse-staging get httproute
kubectl get svc -A | Select-String envoy
```

With the Docker driver on Windows, if the data-plane LoadBalancer address is not
host-reachable, port-forward the Envoy data-plane Service selected by the
Gateway implementation to local port 443:

```powershell
kubectl -n <envoy-data-plane-namespace> port-forward svc/<envoy-data-plane-service> 443:443
```

The exact Service name is controller-generated. Read it from the cluster rather
than hard-coding it in scripts or manifests.

For the current NoteVerse staging rehearsal, use the helper script after the
Gateway data-plane Service exists:

```powershell
.\scripts\start_minikube_gateway_port_forward.ps1
```

Open the application through the same origin rendered into the overlay:

```text
https://staging.johnabc.ccwu.cc/zh/upload
```
## Render Local Overlay

Use the minikube release wrapper with the test domain, immutable image tags,
and the S3-compatible test bucket values. Keep these values outside committed
files. They can come from a local password manager or a GitHub
Environment-rendered release package.

```powershell
$imageTag = "dev-$(git rev-parse --short HEAD)-$(Get-Date -Format yyyyMMddHHmmss)"

$env:NOTEVERSE_BACKEND_API_IMAGE = "ghcr.io/<github-owner>/noteverse/backend-api:$imageTag"
$env:NOTEVERSE_BACKEND_PRACTICE_IMAGE = "ghcr.io/<github-owner>/noteverse/backend-practice:$imageTag"
$env:NOTEVERSE_BACKEND_BEAT_IMAGE = "ghcr.io/<github-owner>/noteverse/backend-beat:$imageTag"
$env:NOTEVERSE_BACKEND_WORKER_IMAGE = "ghcr.io/<github-owner>/noteverse/backend-worker:$imageTag"
$env:NOTEVERSE_CUSTOMER_WEB_IMAGE = "ghcr.io/<github-owner>/noteverse/customer-web:$imageTag"
$env:NOTEVERSE_PLATFORM_ADMIN_IMAGE = "ghcr.io/<github-owner>/noteverse/platform-admin:$imageTag"

$env:NOTEVERSE_S3_ENDPOINT_URL = "<s3-endpoint-url>"
$env:NOTEVERSE_S3_REGION = "<s3-region>"
$env:NOTEVERSE_S3_BUCKET = "<s3-bucket>"
$env:NOTEVERSE_S3_PUBLIC_BASE_URL = "<s3-public-base-url>"
$env:NOTEVERSE_S3_FORCE_PATH_STYLE = "true"
$env:NOTEVERSE_TRUSTED_PROXY_CIDRS = '["10.244.0.0/16"]'

.\scripts\render_minikube_release_overlay.ps1 `
  -Output build/k8s-release/minikube `
  -Overwrite
```

The wrapper fails if any required image or S3 value is missing. It then calls
`scripts/render_k8s_release_overlay.py` with the staging hosts, TLS Secret,
secure cookie setting, CORS origin, and S3 values.

Validate the rendered overlay:

```powershell
python scripts/check_k8s_application_manifests.py build/k8s-release/minikube --strict
kubectl kustomize build/k8s-release/minikube
```

The application preparation script runs the same strict validation before
creating Secrets or applying workloads:

```powershell
.\scripts\minikube_app_release_prepare.ps1 `
  -RenderedOverlay build/k8s-release/minikube
```

If local testing intentionally omits production-only objects such as TLS or
image pull Secrets, use a dedicated local overlay rather than weakening the
strict validator.

## Apply And Smoke Test

Apply manifests and wait for core workload readiness:

```powershell
.\scripts\minikube_app_release_prepare.ps1 `
  -RenderedOverlay build/k8s-release/minikube `
  -Apply `
  -Wait `
  -ScaleWorkerToZero `
  -SkipModelCacheWait
```

The script deletes and recreates `Job/noteverse-db-migrate` before applying the
overlay. Kubernetes Job pod templates are immutable, so this is the release-safe
way to run the current migration image and configuration. It does not delete
database data. `-ScaleWorkerToZero` reflects the current local boundary: Legato
worker tasks are validated through Docker Compose until a real GPU Kubernetes
node is available.

The core application overlay intentionally excludes `ServiceMonitor` resources
so application rollout does not depend on Prometheus Operator CRDs. After the
observability stack installs the `monitoring.coreos.com/v1` CRDs, apply the
optional discovery resources:

```powershell
kubectl -n noteverse-staging apply -k deploy/application/monitoring/prometheus-operator
```

If you need lower-level diagnostics, inspect rollouts directly:

```powershell
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-api
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-practice
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-beat
kubectl -n noteverse-staging rollout status deployment/noteverse-backend-worker
kubectl -n noteverse-staging rollout status deployment/noteverse-customer-web
kubectl -n noteverse-staging rollout status ds/noteverse-model-cache-agent --timeout=7200s
```

Wait for certificate and Gateway readiness:

```powershell
kubectl -n noteverse-staging get certificate noteverse-tls
kubectl -n noteverse-staging get gateway noteverse
kubectl -n noteverse-staging get httproute
```

Port-forward the Envoy data-plane Service for browser smoke if minikube does
not expose a host-reachable LoadBalancer address:

```powershell
kubectl get svc -A | Select-String envoy
kubectl -n <envoy-data-plane-namespace> port-forward svc/<envoy-data-plane-service> 443:443
# Or for the current staging rehearsal:
.\scripts\start_minikube_gateway_port_forward.ps1
```

Keep the browser-facing origin production-shaped:

```text
https://staging.johnabc.ccwu.cc
```

Do not use `:443` in `FRONTEND_BASE_URL` or `BACKEND_CORS_ORIGINS`; HTTPS port
443 is the default port and standard origins normally omit it.

Open:

```text
https://staging.johnabc.ccwu.cc/zh/upload
```

Cookie-authenticated writes such as upload submission are protected by Origin
and CSRF checks. The browser origin must match the rendered
`FRONTEND_BASE_URL` and `BACKEND_CORS_ORIGINS`. Service port-forwarding the
frontend to `127.0.0.1` while the backend is rendered for the staging domain is
expected to fail unsafe writes.

Backend Service port-forwarding is still useful for diagnostics and scripted
API smoke tests:

```powershell
kubectl -n noteverse-staging port-forward svc/noteverse-backend-api 18000:8000
curl.exe -f http://127.0.0.1:18000/health/live
curl.exe -f http://127.0.0.1:18000/health/ready
```

The bucket CORS policy is separate. It matters only for browser-direct S3/OSS
object reads or downloads from signed object URLs. It does not fix backend CSRF
or Origin failures on `/api/v1` writes.

If Chrome shows "Not secure" while the certificate detail says the certificate
is valid, treat it as a page security-state problem rather than a certificate
issuance problem. Check DevTools Security and Console for mixed content,
insecure form, stale service worker/cache, or resources loaded from an HTTP URL.
The expected browser API path is same-origin `/api/v1`; `NEXT_BACKEND_ORIGIN`
and `NEXT_PRACTICE_ORIGIN` are internal server-side Service origins.

On Windows with the Docker minikube driver, do not confuse these addresses:

- `10.x` Service IPs such as `10.96.166.28` are Kubernetes ClusterIP addresses.
  They are reachable from pods, not directly from the Windows browser.
- `$(minikube ip)` such as `192.168.49.2` is the minikube node IP. It is not
  automatically the Gateway browser endpoint unless the data-plane Service is
  exposed through a reachable NodePort or LoadBalancer path.
- a MetalLB external IP such as `192.168.49.240` is assigned to the Envoy
  data-plane `LoadBalancer` Service. On Windows Docker-driver minikube, direct
  host access to that IP can still be unreliable; use the local 443 Gateway
  port-forward helper if TLS handshakes fail from the browser.

Gateway routing is host-based. If the HTTPRoute hostname is
`staging.johnabc.ccwu.cc`, the request must carry that host. Typing an unmapped
domain into the browser address bar can be treated as a search query or fail DNS
resolution. Add a hosts-file entry or local DNS record for the exact host
rendered into the overlay.

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
- TLS and public Gateway behavior;
- observability pipeline with Fluent Bit, Loki, Prometheus, Grafana, Tempo, and
  OpenTelemetry Collector;
- worker runtime assets and scheduling;
- backup, restore, and disaster recovery procedures.


