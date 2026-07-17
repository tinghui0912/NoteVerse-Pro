# Minikube Observability Runbook

This runbook turns the NoteVerse observability skeleton into a local
minikube validation path.

Target path:

```text
Application stdout -> Fluent Bit -> Loki -> Grafana
Prometheus -> Grafana
OpenTelemetry Collector -> Tempo -> Grafana
```

Start with logs. Metrics and traces should be enabled after the logging path is
stable.

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

Or render selected releases through the repository helper:

```powershell
python scripts/render_observability_helm.py --release loki --release fluent-bit
```

Rendered manifests are written to:

```text
tmp/observability-rendered/
```

If a chart version changes and the values no longer render, update the values
explicitly. Do not weaken the application logging contract.

## Install Loki

```powershell
helm upgrade --install loki grafana/loki `
  --namespace observability `
  -f deploy/observability/values/loki.values.yaml
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
  'http://127.0.0.1:3100/loki/api/v1/query_range?query={namespace="noteverse-staging"}|json&limit=20'
```

Useful LogQL examples:

```logql
{namespace="noteverse-staging"} | json
{namespace="noteverse-staging", container="api"} | json | level="ERROR"
{namespace="noteverse-staging"} | json | request_id="..."
{namespace="noteverse-staging"} | json | task_id="..."
```

Do not rewrite those high-cardinality JSON fields into Loki labels.

## Grafana Datasource

When Grafana is installed through `kube-prometheus-stack`, add Loki as a
declarative datasource.

Minimum datasource shape:

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki-gateway.observability.svc.cluster.local
    isDefault: false
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
```

Do not delete application namespaces, database resources, Redis resources, or
business storage buckets as part of logging rollback.
