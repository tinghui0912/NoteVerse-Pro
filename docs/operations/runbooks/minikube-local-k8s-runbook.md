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

For two-node Docker driver testing on Windows/WSL, verify Pod DNS from a Pod on
each node before debugging application code. If Pods scheduled on the worker
node cannot resolve `*.svc.cluster.local` but can reach same-node Pod IPs,
scale CoreDNS to one replica per node and make the DNS Service prefer local
endpoints:

```powershell
kubectl -n kube-system scale deployment coredns --replicas=2
kubectl -n kube-system rollout status deployment/coredns --timeout=180s
kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide

kubectl -n kube-system patch svc kube-dns --type='merge' -p '{"spec":{"internalTrafficPolicy":"Local"}}'
```

The same local-only check and fix is available through:

```powershell
.\scripts\minikube_bootstrap.ps1 -ApplyDnsFix
```

This is a minikube stability adjustment for a local two-node topology. In a
managed production cluster, CoreDNS should already run with multiple replicas
and healthy cluster networking; do not use local minikube patches as a
substitute for production DNS and CNI health checks.

## Build And Publish Local Images

Build production-style runtime images locally:

```powershell
$imageTag = "dev-$(git rev-parse --short HEAD)-$(Get-Date -Format yyyyMMddHHmmss)"

docker build `
  -f docker/backend/Dockerfile.runtime `
  --build-arg PYTHON_IMAGE=noteverse-ml-base:py312-torch260-cu124 `
  --build-arg INSTALL_DEV_DEPS=false `
  --build-arg INSTALL_GPU_DEPS=true `
  --build-arg INSTALL_PADDLE_GPU=false `
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false `
  -t noteverse-backend:$imageTag `
  .

docker build `
  -f docker/frontend/Dockerfile.runtime `
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 `
  --build-arg SESSION_COOKIE_NAME=noteverse_session `
  --build-arg SESSION_REFRESH_COOKIE_NAME=noteverse_refresh `
  -t noteverse-frontend:$imageTag `
  .
```

Load images into minikube only for a single-node local cluster:

```powershell
minikube image load noteverse-backend:$imageTag
minikube image load noteverse-frontend:$imageTag
```

For a multi-node minikube cluster, do not rely on `minikube image load` or a
mutable `:local` tag. A Pod may be scheduled on a node that still has an older
cached image, or no image at all. Use one of these production-like options
instead:

- enable the minikube registry add-on and push uniquely tagged images to it;
- push to the same private registry shape used by CI, such as GHCR;
- pin manifests to immutable tags or digests, even for local smoke tests.

For fast local smoke tests that do not need to exercise registry pulls, build
the image inside every minikube node with `minikube image build --all`:

```powershell
$imageTag = "dev-$(git rev-parse --short HEAD)-$(Get-Date -Format yyyyMMddHHmmss)"
$backendBaseImage = "noteverse-backend:<existing-local-base-tag>"

minikube image build . --all `
  -t noteverse-backend:$imageTag `
  -f docker/backend/Dockerfile.runtime `
  --build-opt build-arg=PYTHON_IMAGE=$backendBaseImage `
  --build-opt build-arg=INSTALL_DEV_DEPS=false `
  --build-opt build-arg=INSTALL_GPU_DEPS=false `
  --build-opt build-arg=INSTALL_PADDLE_GPU=false `
  --build-opt build-arg=INSTALL_LEGATO_EXTRA_DEPS=false
```

This keeps both nodes on the same immutable local tag without requiring Docker
Desktop insecure-registry configuration. For release-like testing, still prefer
a real registry path so the local flow matches CI and production image pulls.

`minikube docker-env` is intentionally unavailable for multi-node clusters. If
you see `ENV_MULTINODE_CONFLICT`, use the registry route rather than patching
Pods to a specific node.

Example registry add-on path:

```powershell
minikube addons enable registry
kubectl -n kube-system rollout status deployment/registry

kubectl -n kube-system port-forward svc/registry 5000:80
```

On Docker Desktop for Windows, keep that port-forward running and start the
Docker-side forwarding process recommended by minikube's registry handbook:

```powershell
docker run --rm --network=host alpine ash -c "apk add socat && socat TCP-LISTEN:5000,reuseaddr,fork TCP:host.docker.internal:5000"
```

In another terminal, tag and push the same images. Keep the pushed registry
reference in the rendered manifests:

```powershell
docker tag noteverse-backend:$imageTag localhost:5000/noteverse-backend:$imageTag
docker tag noteverse-frontend:$imageTag localhost:5000/noteverse-frontend:$imageTag
docker push localhost:5000/noteverse-backend:$imageTag
docker push localhost:5000/noteverse-frontend:$imageTag
```

Reference: <https://minikube.sigs.k8s.io/docs/handbook/registry/>

Use `IfNotPresent` only with immutable local tags. Production and CI release
overlays should use immutable registry tags or image digests.

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

## Initialize Node-Local Model Cache

The application overlay uses `model-cache-agent-daemonset.yaml` to prepare the
node-local model cache. The DaemonSet downloads or verifies model assets under
the node path `/var/lib/noteverse/models`. API and worker pods mount the same
node path read-only at `/opt/noteverse/models`.

These paths are intentionally different:

- `/var/lib/noteverse/models` is the node storage contract. It belongs to the
  Kubernetes node and can be backed by local SSD, local PV, or another
  node-local storage implementation.
- `/opt/noteverse/models` is the application runtime contract. Backend code and
  runtime checks should only know this container path.

Do not make application code depend on the node path. Keeping the paths
separate preserves the Kubernetes storage abstraction while still giving the
application a stable, production-like mount location.

Label nodes that may run API/worker pods and therefore need a model cache:

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

Wait for the model-cache DaemonSet before relying on worker tasks:

Label nodes that should participate in worker/cache experiments:

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

## Local TLS For Production-Shaped Testing

For authenticated browser flows, prefer HTTPS through Ingress instead of direct
Service port-forwarding. The default local smoke path uses `localhost` so it
does not depend on wildcard DNS providers, router DNS rewriting, or hosts-file
administrator access.

Create a local certificate with `mkcert`:

```powershell
mkcert -install
mkcert localhost api.localhost 127.0.0.1
kubectl -n noteverse-staging create secret tls noteverse-staging-tls `
  --cert .\localhost+2.pem `
  --key .\localhost+2-key.pem
```

If `mkcert` is not installed, a short-lived self-signed certificate is enough
for local smoke testing as long as the browser is allowed to proceed through
the certificate warning:

```powershell
New-Item -ItemType Directory -Force -Path build\local-tls | Out-Null
@'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = api.localhost
IP.1 = 127.0.0.1
'@ | Set-Content build\local-tls\localhost-openssl.cnf -Encoding ascii

openssl req -x509 -nodes -days 30 -newkey rsa:2048 `
  -keyout build\local-tls\localhost.key `
  -out build\local-tls\localhost.crt `
  -config build\local-tls\localhost-openssl.cnf

kubectl -n noteverse-staging create secret tls noteverse-staging-tls `
  --cert build\local-tls\localhost.crt `
  --key build\local-tls\localhost.key `
  --dry-run=client -o yaml | kubectl apply -f -
```

With the Docker driver on Windows, the most predictable path is an Ingress
port-forward:

```powershell
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8443:443 8080:80
```

For the port-forward path, the browser target is:

```text
https://localhost:8443/zh/upload
```

### Optional Local Domain

If you want the browser address bar to look closer to production, use explicit
hosts-file entries and keep the Ingress port-forward running:

```text
127.0.0.1 staging.noteverse.local
127.0.0.1 api.staging.noteverse.local
```

On Windows, edit the hosts file from an elevated PowerShell:

```powershell
notepad C:\Windows\System32\drivers\etc\hosts
```

Then create a certificate that includes both hostnames:

```powershell
mkcert -install
mkcert staging.noteverse.local api.staging.noteverse.local 127.0.0.1
kubectl -n noteverse-staging create secret tls noteverse-staging-tls `
  --cert .\staging.noteverse.local+2.pem `
  --key .\staging.noteverse.local+2-key.pem `
  --dry-run=client -o yaml | kubectl apply -f -
```

Render the overlay for the same origin you will open in the browser:

```powershell
python scripts/render_k8s_release_overlay.py `
  --environment staging `
  --output build/k8s-release/minikube `
  --overwrite `
  --backend-image localhost:5000/noteverse-backend:$imageTag `
  --frontend-image localhost:5000/noteverse-frontend:$imageTag `
  --frontend-host staging.noteverse.local `
  --api-host api.staging.noteverse.local `
  --tls-secret noteverse-staging-tls `
  --frontend-base-url https://staging.noteverse.local:8443 `
  --backend-cors-origins '["https://staging.noteverse.local:8443"]' `
  --auth-cookie-secure true `
  --mail-default-sender 'NoteVerse Pro <no-reply@staging.noteverse.local>' `
  --s3-endpoint-url https://oss-cn-shenzhen.aliyuncs.com `
  --s3-region cn-shenzhen `
  --s3-bucket noteverse `
  --s3-public-base-url https://noteverse.oss-cn-shenzhen.aliyuncs.com `
  --s3-force-path-style false `
  --s3-presign-expire-seconds 900
```

Open:

```text
https://staging.noteverse.local:8443/zh/upload
```

Use custom hosts such as `staging.noteverse.local` only when you intentionally
want to validate multi-host routing. In that mode, add hosts-file entries for
the chosen entry point and render `FRONTEND_BASE_URL` and
`BACKEND_CORS_ORIGINS` to the same origin. Do not rely on public wildcard DNS
for local smoke tests; corporate DNS or router filtering can resolve those
names to non-loopback addresses.

### cert-manager With Cloudflare DNS-01

For production-flow rehearsal, use `cert-manager` with Let's Encrypt staging
and DNS-01 against a real test domain. For example, if the test domain is
`johnabc.ccwu.cc`, use:

```text
staging.johnabc.ccwu.cc
api.staging.johnabc.ccwu.cc
```

Install cert-manager:

```powershell
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager `
  --namespace cert-manager `
  --create-namespace `
  --set crds.enabled=true
```

Create a Cloudflare API token with:

```text
Zone.Zone: Read
Zone.DNS: Edit
```

Scope the token to the Cloudflare zone that owns `johnabc.ccwu.cc`, then create
the Kubernetes Secret:

```powershell
kubectl -n cert-manager create secret generic cloudflare-api-token-secret `
  --from-literal=api-token='<cloudflare-api-token>'
```

Set the operator email in the issuer templates before applying them:

```powershell
kubectl apply -f deploy\platform\cert-manager\clusterissuer-letsencrypt-staging-dns01-cloudflare.yaml
kubectl apply -f deploy\platform\cert-manager\clusterissuer-letsencrypt-production-dns01-cloudflare.yaml
```

The staging Ingress is annotated with:

```yaml
cert-manager.io/cluster-issuer: letsencrypt-staging-dns01
```

Cert-manager will create temporary ACME TXT records automatically. Do not add
these manually:

```text
_acme-challenge.staging.johnabc.ccwu.cc
_acme-challenge.api.staging.johnabc.ccwu.cc
```

For local minikube with Ingress port-forward, add only local hosts-file
entries for browser traffic:

```text
127.0.0.1 staging.johnabc.ccwu.cc
127.0.0.1 api.staging.johnabc.ccwu.cc
```

Open the hosts file from an elevated PowerShell:

```powershell
notepad C:\Windows\System32\drivers\etc\hosts
```

Then render the app overlay for the same origin:

```powershell
python scripts/render_k8s_release_overlay.py `
  --environment staging `
  --output build/k8s-release/minikube `
  --overwrite `
  --backend-image localhost:5000/noteverse-backend:$imageTag `
  --frontend-image localhost:5000/noteverse-frontend:$imageTag `
  --frontend-host staging.johnabc.ccwu.cc `
  --api-host api.staging.johnabc.ccwu.cc `
  --tls-secret noteverse-staging-tls `
  --frontend-base-url https://staging.johnabc.ccwu.cc:8443 `
  --backend-cors-origins '["https://staging.johnabc.ccwu.cc:8443"]' `
  --auth-cookie-secure true `
  --mail-default-sender 'NoteVerse Pro <no-reply@staging.johnabc.ccwu.cc>' `
  --s3-endpoint-url https://oss-cn-shenzhen.aliyuncs.com `
  --s3-region cn-shenzhen `
  --s3-bucket noteverse `
  --s3-public-base-url https://noteverse.oss-cn-shenzhen.aliyuncs.com `
  --s3-force-path-style false `
  --s3-presign-expire-seconds 900
```

Let's Encrypt staging certificates intentionally are not browser-trusted. They
validate ACME automation. Use Let's Encrypt production only after the flow is
stable and rate limits are understood.

Validate the certificate flow:

```powershell
kubectl -n noteverse-staging get certificate,certificaterequest,order,challenge
kubectl -n noteverse-staging describe certificate noteverse-staging-tls
```

Expected successful staging result:

```text
Certificate/noteverse-staging-tls READY=True
issuer=(STAGING) Let's Encrypt
```

For quick development smoke tests that do not validate certificate automation,
`mkcert` or a short-lived self-signed Secret is still acceptable.

## Render Local Overlay

Use the release overlay renderer with local hosts and immutable local image
tags. For multi-node minikube, these tags should point at the minikube registry
add-on or the same private registry used by CI.

```powershell
$imageTag = "dev-$(git rev-parse --short HEAD)-$(Get-Date -Format yyyyMMddHHmmss)"

python scripts/render_k8s_release_overlay.py `
  --environment staging `
  --output build/k8s-release/minikube `
  --backend-image localhost:5000/noteverse-backend:$imageTag `
  --frontend-image localhost:5000/noteverse-frontend:$imageTag `
  --frontend-host localhost `
  --api-host api.localhost `
  --tls-secret noteverse-staging-tls `
  --frontend-base-url https://localhost:8443 `
  --backend-cors-origins '["https://localhost:8443"]' `
  --auth-cookie-secure true `
  --mail-default-sender 'NoteVerse Pro <no-reply@localhost>' `
  --s3-endpoint-url https://oss-cn-shenzhen.aliyuncs.com `
  --s3-region cn-shenzhen `
  --s3-bucket noteverse `
  --s3-public-base-url https://noteverse.oss-cn-shenzhen.aliyuncs.com `
  --s3-force-path-style false `
  --s3-presign-expire-seconds 900
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

Frontend service port-forward is only suitable for read-only rendering smoke:

```powershell
kubectl -n noteverse-staging port-forward svc/noteverse-frontend 9002:3000
```

Open:

```text
http://127.0.0.1:9002
```

Use this only when the backend config has been rendered for that exact origin.
Cookie-authenticated writes such as upload submission are protected by Origin
and CSRF checks. If the backend is configured with
`FRONTEND_BASE_URL=https://staging.noteverse.example.invalid` and
`BACKEND_CORS_ORIGINS=["https://staging.noteverse.example.invalid"]`, then
accessing the frontend through `http://127.0.0.1:<port>` is expected to fail
unsafe writes with `request_origin_invalid` or `csrf_token_invalid`.

Ingress smoke should use `https://localhost:8443` by default.

For product flows that perform authenticated writes, prefer the ingress host
that matches `FRONTEND_BASE_URL` and `BACKEND_CORS_ORIGINS`. Either:

- render the overlay for `https://localhost:8443` and access through that exact
  origin; or
- render the overlay for custom local hosts and map them in the hosts file or
  through local DNS before opening the browser.

The bucket CORS policy is separate. It matters only for browser-direct S3/OSS
object reads or downloads from signed object URLs. It does not fix backend CSRF
or Origin failures on `/api/v1` writes.

On Windows with the Docker minikube driver, do not confuse these addresses:

- `10.x` Service IPs such as `10.96.166.28` are Kubernetes ClusterIP addresses.
  They are reachable from pods, not directly from the Windows browser.
- `$(minikube ip)` such as `192.168.49.2` is the minikube node IP. With a
  NodePort ingress service, the browser would use the node IP plus the NodePort
  when that path is reachable from the host.
- `minikube service ingress-nginx-controller -n ingress-nginx --url` may return
  `http://127.0.0.1:<port>` URLs. Those are temporary SSH forwards created by
  minikube for Docker-driver networking on Windows; the terminal must remain
  open while testing them.

Ingress routing is host-based. If the ingress rule is for
`staging.noteverse.example.invalid`, the request must carry that host. Typing an
unmapped `.invalid` domain into the browser address bar can be treated as a
search query or fail DNS resolution. Add a hosts-file entry or use a local host
value generated into the overlay. The default `localhost` route avoids this
problem for normal minikube smoke tests.

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
