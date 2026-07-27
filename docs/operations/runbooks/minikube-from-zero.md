# Minikube From Zero Runbook

This is the authoritative from-zero path for the NoteVerse local staging
rehearsal environment.

Minikube is treated as staging. It should use the production-shaped deployment
model: GHCR images, Kubernetes Secrets, S3-compatible storage, cert-manager,
Gateway API, Envoy Gateway, and the same application overlays used by
production.

Current temporary boundary: Legato GPU inference is not validated inside
minikube. Run `backend-worker` locally through Docker Compose while minikube is
used for frontend, API, practice API, beat, Gateway, TLS, S3, and release
package validation.

## 1. Create Cluster

```powershell
minikube start --driver=docker --cpus=6 --memory=12288 --nodes=1
kubectl create namespace noteverse-staging --dry-run=client -o yaml | kubectl apply -f -
```

## 2. Install Platform

Set a Cloudflare token with `Zone:Read` and `DNS:Edit` for the test zone:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<cloudflare-api-token>"
.\scripts\minikube_platform_bootstrap.ps1
```

This installs Gateway API CRDs, Envoy Gateway, cert-manager, Let's Encrypt
DNS-01 issuers, MetalLB prerequisites, and the application namespace.

## 3. DNS And Local Hosts

Use real DNS names for certificate issuance:

```text
staging.johnabc.ccwu.cc
api.staging.johnabc.ccwu.cc
```

DNS-01 creates temporary `_acme-challenge` TXT records automatically. For local
browser access through the local Gateway port-forward, add these hosts entries:

```text
127.0.0.1 staging.johnabc.ccwu.cc
127.0.0.1 api.staging.johnabc.ccwu.cc
```

Edit on Windows from an elevated PowerShell:

```powershell
notepad C:\Windows\System32\drivers\etc\hosts
```

## 4. Prepare External Dependencies

Use local or managed-like endpoints behind stable Kubernetes Service names for
PostgreSQL and Redis. Follow the service/EndpointSlice pattern in
[minikube-local-k8s-runbook.md](minikube-local-k8s-runbook.md).

Use the staging S3-compatible bucket for application files. Do not use local
PVCs for uploads, score sources, render assets, or playback assets.

Create the bucket if needed:

```powershell
python scripts/ensure_s3_bucket.py --env-file backend/.env.docker --create
```

## 5. Create Secrets

Create or refresh `Secret/noteverse-registry-credentials` from an explicit
GHCR token. Do not create it from Docker Desktop's `config.json` when that file
uses `credsStore`; Kubernetes nodes cannot read the local credential store.

```powershell
$env:GHCR_TOKEN = "<github-token-with-read-packages>"

.\scripts\minikube_app_release_prepare.ps1 `
  -RenderedOverlay build/k8s-release/minikube `
  -CreateRegistrySecretFromToken `
  -RegistryUsername "<github-username>" `
  -BackendSecretEnvFile C:\path\to\noteverse-staging-backend-secret.env
```

The backend secret env file must stay outside the repository and contain the
full required key set: database URLs, Redis URLs, S3 keys, cookie secrets, mail
API key, and optional Hugging Face token.

## 6. Render Release Overlay

Set immutable image references and S3 settings:

```powershell
$env:NOTEVERSE_BACKEND_API_IMAGE = "ghcr.io/<owner>/noteverse/backend-api:<tag>"
$env:NOTEVERSE_BACKEND_PRACTICE_IMAGE = "ghcr.io/<owner>/noteverse/backend-practice:<tag>"
$env:NOTEVERSE_BACKEND_BEAT_IMAGE = "ghcr.io/<owner>/noteverse/backend-beat:<tag>"
$env:NOTEVERSE_BACKEND_WORKER_IMAGE = "ghcr.io/<owner>/noteverse/backend-worker:<tag>"
$env:NOTEVERSE_FRONTEND_IMAGE = "ghcr.io/<owner>/noteverse/frontend:<tag>"

$env:NOTEVERSE_S3_ENDPOINT_URL = "<s3-endpoint-url>"
$env:NOTEVERSE_S3_REGION = "<s3-region>"
$env:NOTEVERSE_S3_BUCKET = "<s3-bucket>"
$env:NOTEVERSE_S3_PUBLIC_BASE_URL = "<s3-public-base-url>"
$env:NOTEVERSE_S3_FORCE_PATH_STYLE = "false"

.\scripts\render_minikube_release_overlay.ps1 -Output build/k8s-release/minikube -Overwrite
```

The checked-in `deploy/application/overlays/staging` directory is a template.
It intentionally keeps placeholder hosts such as
`staging.noteverse.example.invalid` and
`api.staging.noteverse.example.invalid`. The rendered directory under
`build/k8s-release/minikube` is the deployable overlay and should contain the
real test hosts, image tags, and S3 settings.

The rendered origin is `https://staging.johnabc.ccwu.cc`. Do not render `:443`
or `:8443` into `FRONTEND_BASE_URL` or CORS origins.

Validate:

```powershell
python scripts/check_k8s_application_manifests.py build/k8s-release/minikube --strict
kubectl kustomize build/k8s-release/minikube
```

## 7. Apply Application

For the current local staging phase, keep worker execution in Docker Compose
and scale the K8s worker to zero:

```powershell
.\scripts\minikube_app_release_prepare.ps1 `
  -RenderedOverlay build/k8s-release/minikube `
  -CreateRegistrySecretFromToken `
  -RegistryUsername "<github-username>" `
  -Apply `
  -Wait `
  -ScaleWorkerToZero `
  -SkipModelCacheWait
```

This waits for migration, API, practice API, beat, and frontend, but skips the
Kubernetes GPU worker/model-cache path.

The core application overlay does not require Prometheus Operator CRDs. After
the observability stack is installed, apply the optional scrape discovery
resources:

```powershell
kubectl -n noteverse-staging apply -k deploy/application/monitoring/prometheus-operator
```

## 8. Start Gateway Port Forward

If the Envoy data-plane LoadBalancer address is not directly reachable from
Windows, forward local 443:

```powershell
.\scripts\start_minikube_gateway_port_forward.ps1
```

Open:

```text
https://staging.johnabc.ccwu.cc/zh/upload
```

## 9. Smoke Test

Run basic Gateway/API/frontend checks:

```powershell
.\scripts\minikube_smoke_test.ps1
```

Run S3 upload/quota smoke:

```powershell
.\scripts\minikube_smoke_test.ps1 -RunStorageSmoke -EnsureSmokeUser
```

Full OMR import requires the local Docker Compose worker to use the same
PostgreSQL, Redis, and S3 settings as the Kubernetes API.

## 10. Local Worker

Run worker locally until a real GPU Kubernetes node is available:

```powershell
docker compose -f docker-compose.backend-dev.yml up worker beat
```

The compose worker must point at the same database, Redis, S3 bucket, and model
paths used by the minikube API.

## Cleanup

```powershell
kubectl delete namespace noteverse-staging
minikube delete
```
