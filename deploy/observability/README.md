# NoteVerse Observability Deployment Skeleton

This directory contains the shared Helm values baseline for the future
Kubernetes observability stack.

The files under `deploy/observability/values/` are shared baseline values.
Minikube/staging uses the matching overlays under
`deploy/observability/values/minikube/` whenever an overlay exists.

They are intentionally not a turnkey production deployment. Production should
reuse this baseline, then add environment-specific overlays under
`deploy/observability/values/production/` for storage durability, retention,
credentials, Gateway exposure, alert routing, and scale.

Do not fork a completely separate observability stack for minikube and
production. Keep the component choices and label policy shared, and put only
environment differences in overlays.

Target namespace:

```text
observability
```

Planned stack:

- Fluent Bit for Kubernetes log collection.
- Loki for log storage and query.
- kube-prometheus-stack for Prometheus, Alertmanager, Grafana, and Kubernetes
  platform metrics.
- Tempo for trace storage.
- OpenTelemetry Collector for OTLP ingest, batching, sampling, and exporting.

Reference documents:

- `docs/k8s-deployment-runbook.md`
- `docs/k8s-observability-deployment-skeleton.md`
- `docs/k8s-logging-loki-fluent-bit-plan.md`
- `docs/minikube-observability-runbook.md`
- `docs/grafana-dashboard-requirements.md`
- `docs/grafana-loki-query-runbook.md`
- `docs/opentelemetry-tempo-tracing-plan.md`

## Files

```text
values/
  fluent-bit.values.yaml
  loki.values.yaml
  kube-prometheus-stack.values.yaml
  tempo.values.yaml
  otel-collector.values.yaml
  minikube/
    loki.values.yaml
    kube-prometheus-stack.values.yaml
    tempo.values.yaml
  production/
    loki.values.yaml
    kube-prometheus-stack.values.yaml
    tempo.values.yaml
    otel-collector.values.yaml
    README.md
```

Current role of these values:

| File | Current role | Production notes |
| --- | --- | --- |
| `fluent-bit.values.yaml` | Base values, also used directly in minikube | Usually reusable as-is except output destination, TLS, resource limits, and cluster labels |
| `loki.values.yaml` | Shared single-binary baseline | Minikube and production overlays switch storage to S3-compatible object storage and set environment retention |
| `kube-prometheus-stack.values.yaml` | Base metrics/Grafana setup, used with a minikube overlay | Production overlay sets persistent volumes, retention, and PVC sizing; credentials and alert routes come from environment-owned secret management |
| `tempo.values.yaml` | Shared tracing baseline | Minikube and production overlays use S3-compatible object storage and environment retention |
| `otel-collector.values.yaml` | OTLP trace collector baseline | Production overlay adds tail sampling for errors, slow requests, and low-rate baseline traces |

Only releases with real environment differences need overlay files. The current
minikube overlays are intentionally scoped:

- Loki and Tempo use S3-compatible object storage because minikube is the local
  staging rehearsal environment.
- Prometheus, Alertmanager, and Grafana use PVCs backed by
  `StorageClass/noteverse-local-lvm`.
- The minikube StorageClass is provided by TopoLVM over per-node extra block
  disks in the qemu2 minikube profile.

Production overlays define durable storage shape, retention, and trace sampling,
but still reference Kubernetes Secrets instead of committing credentials.

Required Secret contract for Loki and Tempo object storage:

```text
Secret/observability-s3
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

## Rules

- Do not commit secrets.
- Do not add fallback external endpoints.
- Do not make `pod`, `request_id`, `trace_id`, `span_id`, `score_id`,
  `revision_id`, `job_id`, `outbox_id`, `user_id`, email addresses, file
  hashes, or storage keys Loki labels.
- Keep operational IDs in the structured JSON log body and query them with
  LogQL `| json`.
- Do not enable high-volume practice tracing by default.
- Add environment overlays only when staging/production cluster details are
  known.

## Validation

Run the lightweight guard:

```bash
python scripts/check_observability_manifests.py
```

Render Helm manifests before installing:

```bash
python scripts/render_observability_helm.py --profile minikube --release loki --release fluent-bit
python scripts/render_observability_helm.py --profile production --release loki --release fluent-bit
```
