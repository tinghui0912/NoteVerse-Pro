# Minikube Observability Runbook

This runbook turns the NoteVerse observability skeleton into a local
minikube validation path.

Target path:

```text
Application stdout -> Fluent Bit -> Loki -> Grafana
Prometheus -> Grafana
OpenTelemetry Collector -> Tempo -> Grafana
```

Start with logs, then metrics, then traces. Keep all three paths structurally
aligned with production, but use minikube overlays only where local Kubernetes
needs a different setting.

## Principles

- Application pods write logs to stdout/stderr only.
- Kubernetes environments should run the backend with `LOG_FORMAT=json`.
- Do not write, mount, rotate, or collect application-local log files.
- Fluent Bit parses NoteVerse JSON log bodies and forwards them to Loki.
- Loki labels must stay low-cardinality.
- Do not promote request IDs, trace IDs, span IDs, score IDs, revision IDs,
  job IDs, outbox IDs, user IDs, emails, file hashes, paths, or object keys to
  Loki labels.
- Keep operational IDs in the JSON log body and query them with LogQL `| json`.

## Values Scope

This runbook uses the shared baseline values in `deploy/observability/values/`
plus the `deploy/observability/values/minikube/` overlay. Minikube is the
staging rehearsal environment, so it uses production-shaped S3 object storage
for Loki/Tempo and PVC-backed Prometheus/Grafana state.

Production keeps the same component model and label policy, then layers
environment-specific values under `deploy/observability/values/production/`
for:

- durable Loki and Tempo object storage;
- Prometheus, Alertmanager, and Grafana persistence;
- retention periods;
- external secret management for Grafana and alert receivers;
- Gateway/TLS;
- resource requests, limits, replicas, and topology rules;
- cluster/environment labels.

In other words: minikube and production stay structurally aligned, but
production must not blindly deploy the minikube StorageClass or credential
choices.

## Minikube Overlay Notes

The minikube overlay is intentionally smaller than production while preserving
the same storage model:

- Loki uses S3-compatible object storage and an `8Gi` TopoLVM PVC for local
  single-binary state.
- Loki canary and chart tests are disabled in the minikube overlay. The canary
  is useful in larger production setups, but its websocket/tail checks are
  noisy under qemu2 plus S3-backed single-binary Loki. The repository smoke
  script validates the local Loki read path instead.
- Loki readiness is widened and the memberlist headless Service publishes
  not-ready addresses so single-binary startup does not flap while the Pod is
  discovering itself.
- Tempo uses S3-compatible object storage and no durable local trace volume.
- Prometheus uses an `8Gi` TopoLVM PVC.
- Grafana and Alertmanager each use a `2Gi` TopoLVM PVC.
- Grafana uses `Recreate` deployment strategy because it mounts a single RWO
  PVC.
- Grafana provisions Prometheus, Loki, and Tempo through static
  `grafana.datasources` values instead of the datasource sidecar. This keeps
  the minikube rehearsal deterministic and avoids relying on runtime ConfigMap
  sidecar synchronization.
- Grafana external update checks, usage reporting, news feed, plugin admin,
  and plugin preinstall are disabled. The staging rehearsal path should not
  block on `grafana.com` or install plugins at runtime.
- Grafana, Prometheus, Alertmanager, Prometheus Operator, node-exporter,
  OpenTelemetry Collector, kube-state-metrics, and TopoLVM probes are wider
  than production defaults because qemu2 minikube can pause during image pulls,
  SQLite migrations, collector startup, and LVM provisioning.
- The TopoLVM minikube overlay disables controller leader election and snapshot
  support, and uses a single-node rolling update shape. This avoids single-node
  anti-affinity deadlocks and removes the unused CSI snapshotter sidecar from
  the local rehearsal path.

These are local staging rehearsal settings, not production sizing guidance.
Production must set resource requests, limits, retention, and PVC sizes from
real traffic and retention goals.

Current chart notes:

- `grafana/tempo` currently installs successfully but Helm reports the chart as
  deprecated. Track migration to the current Grafana-supported Tempo
  deployment shape after the staging path is stable. Do not blindly switch to
  `tempo-distributed` without rechecking chart metadata, because distributed
  Tempo chart variants may also be deprecated in the active Grafana chart
  repository.
- `fluent/fluent-bit` currently renders with local chart metadata showing
  `name: fluent-bit`, `version: 0.57.9`, and no `deprecated: true` flag. If a
  Helm repository update or install warning reports deprecation in a specific
  environment, track it the same way as Tempo: migrate to the maintained
  official chart path or to a repository-owned DaemonSet manifest, while
  preserving the Loki label allowlist and JSON parsing contract.
- `grafana/loki`, `prometheus-community/kube-prometheus-stack`, and
  `open-telemetry/opentelemetry-collector` are not marked deprecated in the
  current local Helm metadata. Re-check this during platform upgrades.

## Prerequisites

Install Helm before running the chart commands. The repository does not vendor
Helm binaries.

```powershell
helm version --short
```

Add chart repositories:

```powershell
helm repo add grafana https://grafana.github.io/helm-charts
helm repo add fluent https://fluent.github.io/helm-charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

Create the namespace:

```powershell
kubectl create namespace observability --dry-run=client -o yaml | kubectl apply -f -
```

Install Prometheus Operator CRDs before installing charts or application
`ServiceMonitor` resources:

```powershell
$crds = Join-Path $env:TEMP "kube-prometheus-stack-crds.yaml"
helm show crds prometheus-community/kube-prometheus-stack > $crds
kubectl apply --server-side -f $crds
```

This keeps CRD ownership explicit and avoids coupling the application rollout
to Prometheus Operator CRD installation timing.

Install the minikube StorageClass before installing Prometheus:

```powershell
.\scripts\minikube_prepare_lvm_vg.ps1 -Profile noteverse-lvm -WipeExtraDisk
.\scripts\minikube_install_topolvm.ps1
```

This installs TopoLVM and provides:

```text
StorageClass/noteverse-local-lvm
```

The minikube Prometheus/Grafana/Alertmanager overlay uses that StorageClass for
PVCs. Do not replace this with direct workload `hostPath` mounts.

Create the observability S3 Secret before installing Loki or Tempo. Use
dedicated buckets; do not share the application asset bucket.

Required keys:

```text
LOKI_S3_ENDPOINT
LOKI_S3_REGION
LOKI_S3_BUCKET
LOKI_S3_ACCESS_KEY_ID
LOKI_S3_SECRET_ACCESS_KEY
TEMPO_S3_ENDPOINT
TEMPO_S3_REGION
TEMPO_S3_BUCKET
TEMPO_S3_ACCESS_KEY_ID
TEMPO_S3_SECRET_ACCESS_KEY
```

Example shape:

```powershell
kubectl -n observability create secret generic observability-s3 `
  --from-literal=LOKI_S3_ENDPOINT="https://<s3-endpoint>" `
  --from-literal=LOKI_S3_REGION="<region>" `
  --from-literal=LOKI_S3_BUCKET="<staging-loki-bucket>" `
  --from-literal=LOKI_S3_ACCESS_KEY_ID="<access-key>" `
  --from-literal=LOKI_S3_SECRET_ACCESS_KEY="<secret-key>" `
  --from-literal=TEMPO_S3_ENDPOINT="https://<s3-endpoint>" `
  --from-literal=TEMPO_S3_REGION="<region>" `
  --from-literal=TEMPO_S3_BUCKET="<staging-tempo-bucket>" `
  --from-literal=TEMPO_S3_ACCESS_KEY_ID="<access-key>" `
  --from-literal=TEMPO_S3_SECRET_ACCESS_KEY="<secret-key>"
```

## Validate Values Before Installing

Render the Helm manifests locally:

```powershell
helm template loki grafana/loki `
  --namespace observability `
  -f deploy/observability/values/loki.values.yaml `
  > $env:TEMP\noteverse-loki-rendered.yaml

helm template fluent-bit fluent/fluent-bit `
  --namespace observability `
  -f deploy/observability/values/fluent-bit.values.yaml `
  > $env:TEMP\noteverse-fluent-bit-rendered.yaml
```

Run the repository guard:

```powershell
python scripts/check_observability_manifests.py
```

Or render selected releases through the repository helper. Use the `minikube`
profile to include local-only values overlays:

```powershell
python scripts/render_observability_helm.py --profile minikube `
  --release loki `
  --release fluent-bit `
  --release kube-prometheus-stack `
  --release tempo `
  --release otel-collector
```

Rendered manifests are written to:

```text
tmp/observability-rendered/
```

If a chart version changes and the values no longer render, update the values
explicitly. Do not weaken the application logging contract.

Run the repository guard after values changes:

```powershell
python scripts/check_observability_manifests.py
```

## Install Loki

```powershell
helm upgrade --install loki grafana/loki `
  --namespace observability `
  -f deploy/observability/values/loki.values.yaml `
  -f deploy/observability/values/minikube/loki.values.yaml
```

Wait for Loki:

```powershell
kubectl get pods -n observability -l app.kubernetes.io/name=loki -o wide
kubectl wait --for=condition=Ready pod -n observability -l app.kubernetes.io/name=loki --timeout=300s
```

The exact workload name depends on the chart version. Inspect resources with:

```powershell
kubectl get all -n observability
```

## Install Fluent Bit

```powershell
helm upgrade --install fluent-bit fluent/fluent-bit `
  --namespace observability `
  -f deploy/observability/values/fluent-bit.values.yaml
```

Wait for Fluent Bit:

```powershell
kubectl rollout status daemonset/fluent-bit -n observability --timeout=300s
kubectl get pods -n observability -l app.kubernetes.io/name=fluent-bit -o wide
```

## Install Prometheus And Grafana

```powershell
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack `
  --namespace observability `
  -f deploy/observability/values/kube-prometheus-stack.values.yaml `
  -f deploy/observability/values/minikube/kube-prometheus-stack.values.yaml
```

Wait for the metrics stack:

```powershell
kubectl wait --for=condition=Ready pod -n observability --all --timeout=300s
kubectl get pods -n observability -o wide
```

The minikube overlay uses LVM-backed PVCs through TopoLVM. It should not pin
Prometheus to a hard-coded node name.

If a previous run created oversized local PVCs, delete the affected
StatefulSet/Pod/PVC after applying the smaller minikube values. Kubernetes
cannot shrink existing PVCs in place. Do not remove TopoLVM finalizers by hand;
wait for TopoLVM to release the PV and `LogicalVolume` or restart the TopoLVM
controller if its CSI sidecars are stuck.

If the application was applied before Prometheus Operator CRDs existed, apply
the backend ServiceMonitor after installing the stack:

```powershell
kubectl label service noteverse-backend-api -n noteverse-staging `
  app.kubernetes.io/name=noteverse `
  app.kubernetes.io/part-of=noteverse `
  --overwrite

kubectl apply -n noteverse-staging -f deploy/application/base/backend-api-servicemonitor.yaml
```

Verify Prometheus discovery:

```powershell
kubectl port-forward -n observability svc/kube-prometheus-stack-prometheus 19090:9090
```

Then open `http://127.0.0.1:19090/targets` and confirm
`noteverse-backend-api` is `UP`.

Run the local observability smoke:

```powershell
.\scripts\minikube_observability_smoke.ps1 -TimeoutSeconds 180
```

The smoke checks:

- every observability Pod is Ready;
- every observability PVC is Bound;
- Prometheus responds to `/-/ready` and a lightweight `up` query;
- Loki responds to `/ready` and label discovery;
- Tempo responds to `/ready`;
- Grafana is healthy and has `prometheus`, `loki`, and `tempo` datasource
  types.

## Install Tempo

```powershell
helm upgrade --install tempo grafana/tempo `
  --namespace observability `
  -f deploy/observability/values/tempo.values.yaml `
  -f deploy/observability/values/minikube/tempo.values.yaml
```

Wait for Tempo:

```powershell
kubectl wait --for=condition=Ready pod -n observability -l app.kubernetes.io/name=tempo --timeout=300s
kubectl get pods -n observability -l app.kubernetes.io/name=tempo -o wide
```

The minikube overlay stores Tempo traces in S3-compatible object storage. This
matches the production storage model while keeping trace retention short.

## Install OpenTelemetry Collector

```powershell
helm upgrade --install otel-collector open-telemetry/opentelemetry-collector `
  --namespace observability `
  -f deploy/observability/values/otel-collector.values.yaml
```

Wait for the collector:

```powershell
kubectl rollout status deploy/otel-collector-opentelemetry-collector -n observability --timeout=300s
kubectl get pods -n observability -l app.kubernetes.io/name=opentelemetry-collector -o wide
```

The collector currently exposes OTLP on:

```text
otel-collector-opentelemetry-collector.observability.svc.cluster.local:4317
otel-collector-opentelemetry-collector.observability.svc.cluster.local:4318
```

Application services should send traces to that collector endpoint through
explicit environment configuration. Do not configure fallback trace exporters or
default external endpoints.

## Generate Application Logs

Restart the API or run a smoke script:

```powershell
kubectl rollout restart deploy/noteverse-backend-api -n noteverse-staging
kubectl rollout status deploy/noteverse-backend-api -n noteverse-staging --timeout=300s
```

For smoke scripts, port-forward the API in a separate terminal:

```powershell
kubectl port-forward -n noteverse-staging svc/noteverse-backend-api 18000:8000
```

Then run:

```powershell
python scripts/k8s_smoke_storage.py `
  --api-base http://127.0.0.1:18000/api/v1 `
  --ensure-user
```

Stop the port-forward after the smoke test.

## Query Loki Locally

Port-forward Loki:

```powershell
kubectl port-forward -n observability svc/loki 3100:3100
```

Query recent NoteVerse logs:

```powershell
Invoke-RestMethod `
  'http://127.0.0.1:3100/loki/api/v1/query_range?query=%7Bnamespace%3D%22noteverse-staging%22%7D%20%7C%20json&limit=20'
```

Useful LogQL examples:

```logql
{namespace="noteverse-staging"} | json
{namespace="noteverse-staging", container="api"} | json | level="ERROR"
{namespace="noteverse-staging"} | json | request_id="..."
{namespace="noteverse-staging"} | json | task_id="..."
```

Do not rewrite those high-cardinality JSON fields into Loki labels.

## Grafana Datasources

When Grafana is installed through `kube-prometheus-stack`, Prometheus, Loki,
and Tempo are provisioned as static declarative datasources by
`kube-prometheus-stack.values.yaml`.

Minimum datasource shape:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://kube-prometheus-stack-prometheus.observability.svc.cluster.local:9090
    isDefault: true
  - name: Loki
    uid: loki
    type: loki
    access: proxy
    url: http://loki.observability.svc.cluster.local:3100
  - name: Tempo
    uid: tempo
    type: tempo
    access: proxy
    url: http://tempo.observability.svc.cluster.local:3200
```

Keep datasource configuration declarative so minikube and production stay
aligned.

## Troubleshooting

If logs do not appear:

1. Confirm backend pods run with `LOG_FORMAT=json`.
2. Check Fluent Bit pod logs.
3. Check Loki readiness.
4. Confirm Fluent Bit can read Kubernetes container logs.
5. Query by existing low-cardinality labels first, then parse JSON.

Commands:

```powershell
kubectl logs -n observability daemonset/fluent-bit --tail=100
kubectl logs -n observability -l app.kubernetes.io/name=loki --tail=100
kubectl get events -n observability --sort-by=.lastTimestamp
```

## Uninstall

```powershell
helm uninstall fluent-bit -n observability
helm uninstall loki -n observability
helm uninstall otel-collector -n observability
helm uninstall tempo -n observability
helm uninstall kube-prometheus-stack -n observability
```

Do not delete application namespaces, database resources, Redis resources, or
business storage buckets as part of logging rollback.
