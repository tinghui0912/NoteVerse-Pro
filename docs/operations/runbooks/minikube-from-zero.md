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

## Should I Delete The Existing Docker Minikube Profile?

Not by default.

Keep the existing Docker-driver `minikube` profile as a working comparison
environment while validating the qemu2/LVM path. The from-zero rehearsal uses a
separate profile named `noteverse-lvm`, so it does not require deleting the
current profile.

Delete the old profile only when the qemu2 path has passed the full smoke test
or when you explicitly want to verify a completely clean workstation:

```powershell
minikube delete -p minikube
```

Deleting the profile removes Kubernetes resources and local cluster state. It
does not delete managed PostgreSQL, Redis, S3 buckets, GHCR images, DNS records,
or external mail/provider resources.

## 1. Create Cluster

```powershell
.\scripts\minikube_start_lvm_profile.ps1 `
  -Profile noteverse-lvm `
  -Nodes 1 `
  -Cpus 4 `
  -Memory 8192 `
  -DiskSize 80g `
  -ExtraDisks 1

kubectl create namespace noteverse-staging --dry-run=client -o yaml | kubectl apply -f -
```

This path requires QEMU on the Windows host. Verify these commands resolve
before starting:

```powershell
where.exe qemu-system-x86_64
where.exe qemu-img
```

The Docker minikube driver is not the production rehearsal path because it
cannot attach extra block disks. Docker volumes are not block devices and should
not be used to simulate LVM.

Start with one qemu2 node for the repeatable from-zero rehearsal. Two-node qemu2
on Windows can be useful for experiments, but it is more sensitive to SSH
tunnels, node bootstrap downloads, and local networking. Use the local VM
Kubernetes lab when the goal is to validate multi-node block-device or GPU
behavior.

The start script opens a local API tunnel on `https://127.0.0.1:18443` and
rewrites the `noteverse-lvm` kubeconfig server to that endpoint. This avoids the
unstable automatic localhost tunnel that qemu2 can create on Windows.

If `kubectl` later fails to connect after a host reboot or minikube restart,
recreate only the API tunnel instead of rebuilding the cluster:

```powershell
.\scripts\minikube_start_api_tunnel.ps1 -Profile noteverse-lvm
kubectl get nodes
```

If minikube reports that it reset the qemu2 profile while recovering the
control plane, all Kubernetes namespaces and in-cluster PVCs are gone. Re-run
this runbook from the platform bootstrap step. External PostgreSQL, Redis, S3,
DNS, and GHCR resources are not deleted by that reset.

## 2. Install Platform

Set a Cloudflare token with `Zone:Read` and `DNS:Edit` for the test zone:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<cloudflare-api-token>"
.\scripts\minikube_platform_bootstrap.ps1
```

This installs Gateway API CRDs, Envoy Gateway, cert-manager, Let's Encrypt
DNS-01 issuers, MetalLB, and the application namespace.

The minikube platform bootstrap intentionally layers minikube-only Helm values
for MetalLB and cert-manager. Those values widen readiness/liveness probe
timeouts and set small resource requests so qemu2 pauses do not cause webhook
or controller restart loops. Production should use production platform values,
not the minikube probe overlay.

The bootstrap script targets the `noteverse-lvm` minikube profile by default.
Override it only when rehearsing against a differently named profile:

```powershell
.\scripts\minikube_platform_bootstrap.ps1 -MinikubeProfile noteverse-lvm
```

For the qemu2 minikube profile, the bootstrap script installs MetalLB in
Layer-2 mode with FRR disabled and derives the default address pool from the
first Kubernetes node `InternalIP`, for example:

```text
10.0.2.240-10.0.2.250
```

Override the range only when your minikube node network is different:

```powershell
$env:NOTEVERSE_METALLB_ADDRESS_POOL = "10.0.2.240-10.0.2.250"
.\scripts\minikube_platform_bootstrap.ps1
```

## 3. DNS And Local Hosts

Use real DNS names for certificate issuance:

```text
staging.johnabc.ccwu.cc
api.staging.johnabc.ccwu.cc
```

DNS-01 creates temporary `_acme-challenge` TXT records automatically. MetalLB
assigns an internal minikube LoadBalancer address so the Gateway reaches
`PROGRAMMED=True`. On Windows/qemu2, that LoadBalancer IP is usually not the
best browser entrypoint. For local browser access through the local Gateway
port-forward, add these hosts entries:

```text
127.0.0.1 staging.johnabc.ccwu.cc
127.0.0.1 api.staging.johnabc.ccwu.cc
```

Edit on Windows from an elevated PowerShell:

```powershell
notepad C:\Windows\System32\drivers\etc\hosts
```

The LoadBalancer IP can still be validated from inside the minikube VM:

```powershell
minikube -p noteverse-lvm ssh -- "curl -vk --resolve staging.johnabc.ccwu.cc:443:<gateway-address> https://staging.johnabc.ccwu.cc/zh/upload --max-time 20"
minikube -p noteverse-lvm ssh -- "curl -vk --resolve api.staging.johnabc.ccwu.cc:443:<gateway-address> https://api.staging.johnabc.ccwu.cc/health/live --max-time 20"
```

On Windows/qemu2, prefer local 443 port-forward for browser testing even when
the Gateway shows `PROGRAMMED=True`.

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

Create separate S3-compatible buckets for observability. Do not share the
application file bucket:

```text
noteverse-loki-staging
noteverse-tempo-staging
```

## 5. Install StorageClass

Initialize the extra disk on every node as an LVM volume group, then install
TopoLVM:

```powershell
.\scripts\minikube_prepare_lvm_vg.ps1 `
  -Profile noteverse-lvm `
  -VolumeGroup noteverse-local-vg `
  -WipeExtraDisk

.\scripts\minikube_install_topolvm.ps1
```

Verify:

```powershell
kubectl get storageclass noteverse-local-lvm
.\scripts\minikube_smoke_topolvm.ps1
```

This is the staging rehearsal StorageClass. Production should use a managed
cloud block storage CSI or an operator-managed local PV provisioner. Direct
workload `hostPath` mounts are not part of the storage contract.

The minikube TopoLVM overlay is intentionally single-node friendly:

- `controller.replicaCount=1`;
- controller leader election is disabled;
- controller rolling update uses `maxUnavailable=1` and `maxSurge=0` so a
  single-node profile does not get stuck on controller anti-affinity;
- snapshot support is disabled because NoteVerse does not currently use
  Kubernetes `VolumeSnapshot` resources;
- TopoLVM probe timeouts are wider than production defaults to tolerate qemu2
  pauses and slow LVM operations.

Production TopoLVM or another local PV provisioner should use production HA
settings instead of this minikube-only overlay.

## 6. Create Secrets

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

`minikube_app_release_prepare.ps1` treats this file as a credential source only:
it filters the file down to the required Secret keys before writing
`Secret/noteverse-backend-secret`. Runtime/public configuration such as
`FRONTEND_BASE_URL`, `BACKEND_CORS_ORIGINS`, `LOG_FORMAT`, S3 bucket names, and
model paths must come from the rendered release overlay ConfigMaps. Do not put
those values in the backend Secret or they can override the production-shaped
release configuration at Pod startup.

`HF_TOKEN` is required for model-cache/worker bootstrap when private or gated
model repositories are involved. It is not required for the temporary
`-ScaleWorkerToZero -SkipModelCacheWait` application deployment path where the
GPU worker runs outside Kubernetes.

Create the observability S3 Secret in the `observability` namespace before
installing Loki or Tempo:

```powershell
kubectl create namespace observability --dry-run=client -o yaml | kubectl apply -f -

kubectl -n observability create secret generic observability-s3 `
  --from-literal=LOKI_S3_ENDPOINT="<s3-endpoint-url>" `
  --from-literal=LOKI_S3_REGION="<s3-region>" `
  --from-literal=LOKI_S3_BUCKET="<loki-bucket>" `
  --from-literal=LOKI_S3_ACCESS_KEY_ID="<access-key>" `
  --from-literal=LOKI_S3_SECRET_ACCESS_KEY="<secret-key>" `
  --from-literal=TEMPO_S3_ENDPOINT="<s3-endpoint-url>" `
  --from-literal=TEMPO_S3_REGION="<s3-region>" `
  --from-literal=TEMPO_S3_BUCKET="<tempo-bucket>" `
  --from-literal=TEMPO_S3_ACCESS_KEY_ID="<access-key>" `
  --from-literal=TEMPO_S3_SECRET_ACCESS_KEY="<secret-key>"
```

## 7. Render Release Overlay

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

## 8. Apply Application

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

## 9. Install Observability

Install Loki, Fluent Bit, Prometheus/Grafana, Tempo, and OpenTelemetry
Collector with the minikube profile:

First install Prometheus Operator CRDs:

```powershell
$crds = Join-Path $env:TEMP "kube-prometheus-stack-crds.yaml"
helm show crds prometheus-community/kube-prometheus-stack --version 79.5.0 > $crds
kubectl apply --server-side -f $crds
```

```powershell
python scripts/render_observability_helm.py --profile minikube `
  --release loki `
  --release fluent-bit `
  --release kube-prometheus-stack `
  --release tempo `
  --release otel-collector
```

Then follow:

```text
docs/operations/observability/minikube-observability-runbook.md
```

The observability stack expects:

- `StorageClass/noteverse-local-lvm`;
- `Secret/observability-s3`;
- dedicated Loki and Tempo buckets.
- Prometheus Operator CRDs installed before application `ServiceMonitor`
  resources.

After the charts are installed, run the observability smoke:

```powershell
.\scripts\minikube_observability_smoke.ps1 -TimeoutSeconds 180
```

This validates Pod readiness, PVC binding, Prometheus, Loki, Tempo, and
Grafana datasource provisioning.

The minikube observability overlay also widens
`prometheus-node-exporter` probes. On qemu2, node-exporter can take more than a
few seconds to enumerate host filesystems and collectors after image pulls or
storage activity. Production should size node-exporter probes and resources
from real node behavior instead of copying the minikube overlay.

After Prometheus Operator CRDs exist, apply optional application monitoring
resources:

```powershell
kubectl -n noteverse-staging apply -k deploy/application/monitoring/prometheus-operator
kubectl apply -k deploy/observability/dashboards
```

This installs the backend ServiceMonitors, NoteVerse application alert rules,
and the Grafana dashboard ConfigMap. In minikube, Grafana mounts that dashboard
through static dashboard provisioning. In production, Grafana can also discover
the same ConfigMap through the `grafana_dashboard=1` sidecar label.

## 10. Start Gateway Port Forward

If the Envoy data-plane LoadBalancer address is not directly reachable from
Windows, forward local 443:

```powershell
.\scripts\start_minikube_gateway_port_forward.ps1
```

Open:

```text
https://staging.johnabc.ccwu.cc/zh/upload
```

## 11. Smoke Test

Run basic Gateway/API/frontend checks from Windows through local 443
port-forward:

```powershell
.\scripts\minikube_smoke_test.ps1 -StartGatewayPortForward
```

Run S3 upload/quota smoke:

```powershell
.\scripts\minikube_smoke_test.ps1 -StartGatewayPortForward -RunStorageSmoke -EnsureSmokeUser
```

Full OMR import requires the local Docker Compose worker to use the same
PostgreSQL, Redis, and S3 settings as the Kubernetes API.

## 12. Local Worker

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
