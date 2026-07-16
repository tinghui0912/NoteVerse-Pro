# NoteVerse Observability Deployment Skeleton

This directory contains the first Helm values skeleton for the future
Kubernetes observability stack.

It is intentionally not a turnkey production deployment yet. Use it as the
starting point for staging cluster validation.

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
```

## Rules

- Do not commit secrets.
- Do not add fallback external endpoints.
- Do not make `request_id`, `score_id`, `job_id`, `user_id`, or storage keys
  Loki labels.
- Do not enable high-volume practice tracing by default.
- Add environment overlays only when staging/production cluster details are
  known.

## Validation

Run the lightweight guard:

```bash
python scripts/check_observability_manifests.py
```
