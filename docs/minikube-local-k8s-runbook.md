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

## Build And Load Local Images

Build production-style runtime images locally:

```powershell
docker build `
  -f docker/backend/Dockerfile.runtime `
  --build-arg PYTHON_IMAGE=python:3.12-slim-bookworm `
  --build-arg INSTALL_DEV_DEPS=false `
  --build-arg INSTALL_GPU_DEPS=false `
  --build-arg INSTALL_PADDLE_GPU=false `
  --build-arg INSTALL_LEGATO_EXTRA_DEPS=false `
  -t noteverse-backend:local `
  .

docker build `
  -f docker/frontend/Dockerfile.runtime `
  --build-arg NEXT_BACKEND_ORIGIN=http://noteverse-backend-api:8000 `
  --build-arg AUTH_COOKIE_NAME=noteverse_session `
  --build-arg REFRESH_COOKIE_NAME=noteverse_refresh `
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

Create or bind PVCs for:

- model assets;
- Legato repository;
- beat work directory;
- object/file storage if the selected local storage path requires a volume.

For API/frontend-only smoke tests, it is acceptable to scale worker and beat to
zero in a dedicated local overlay. For import, render, playback, and cleanup
tests, worker and beat must run with their required runtime assets.

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
