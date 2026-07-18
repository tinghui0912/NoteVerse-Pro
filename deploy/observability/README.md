# NoteVerse Observability Deployment Skeleton

This directory contains the shared Helm values baseline for the future
Kubernetes observability stack.

The files under `deploy/observability/values/` are shared baseline values. They
are also usable for local minikube validation unless a release has a matching
overlay under `deploy/observability/values/minikube/`.

They are intentionally not a turnkey production deployment. Production should
reuse this baseline, then add environment-specific overlays under
`deploy/observability/values/production/` for storage durability, retention,
credentials, ingress, alert routing, and scale.

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
    kube-prometheus-stack.values.yaml
    tempo.values.yaml
  production/
    README.md
```

Current role of these values:

| File | Current role | Production notes |
| --- | --- | --- |
| `fluent-bit.values.yaml` | Base values, also used directly in minikube | Usually reusable as-is except output destination, TLS, resource limits, and cluster labels |
| `loki.values.yaml` | Local/minikube single-binary filesystem setup | Replace with durable object storage, production retention, and a production deployment mode before launch |
| `kube-prometheus-stack.values.yaml` | Base metrics/Grafana setup, usable in minikube with its overlay | Add persistent volumes, admin credentials from external secrets, alert routes, and resource requests |
| `tempo.values.yaml` | Local tracing baseline, usable in minikube with its overlay | Add object storage, retention, resource requests, and a production topology before launch |
| `otel-collector.values.yaml` | OTLP trace collector baseline | Tune sampling, resource attributes, replica strategy, and resource limits per environment |

Only releases with real environment differences need overlay files. The current
minikube overlays are intentionally small:

- Prometheus is pinned to the primary minikube node because the current local
  two-node profile has asymmetric Pod IP networking.
- Tempo persistence is disabled because the local single-binary chart otherwise
  hits minikube PVC ownership issues.

Production overlays are currently docs-only on purpose. Do not create fake
production values before the real cluster storage, ingress, secret, and scaling
choices are known.

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
