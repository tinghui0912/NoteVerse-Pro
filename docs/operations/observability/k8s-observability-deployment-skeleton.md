# Kubernetes Observability Deployment Skeleton

This document defines the first deployment skeleton for the self-hosted
NoteVerse Pro observability stack.

Target stack:

```text
Fluent Bit -> Loki -> Grafana
Prometheus -> Grafana
OpenTelemetry Collector -> Tempo -> Grafana
```

This is a planning and configuration skeleton. It is not yet a production
installation runbook.

## Namespace

Use a dedicated namespace:

```text
observability
```

Application namespaces should not own observability storage. Application pods
only expose logs, metrics, and future OTLP endpoints.

Application workload ports, probes, environment variables, runtime checks, and
ServiceMonitor selectors are defined separately in
`docs/architecture/runtime/k8s-application-runtime-contract.md`.

## Helm Release Boundaries

Recommended releases:

| Release | Chart family | Owns |
| --- | --- | --- |
| `loki` | Grafana Loki | log storage and query backend |
| `fluent-bit` | Fluent Bit | node-level container log collection |
| `kube-prometheus-stack` | Prometheus community | Prometheus, Alertmanager, Grafana, kube-state-metrics |
| `tempo` | Grafana Tempo | trace storage and query backend |
| `otel-collector` | OpenTelemetry Collector | OTLP ingest, batching, sampling, exporting |

Keep these releases separate. Do not hide everything behind one giant umbrella
chart until the operational model is stable.

## Directory Skeleton

Repository skeleton:

```text
deploy/
  observability/
    README.md
    values/
      fluent-bit.values.yaml
      loki.values.yaml
      kube-prometheus-stack.values.yaml
      tempo.values.yaml
      otel-collector.values.yaml
```

Initial skeleton files are available under `deploy/observability`.

Environment-specific overlays can be added later:

```text
deploy/
  observability/
    envs/
      staging/
      production/
```

Do not add fallback DSNs, default external endpoints, or development credentials
to these files.

## Component Responsibilities

### Fluent Bit

Responsibilities:

- tail Kubernetes container logs;
- enrich logs with Kubernetes metadata;
- parse NoteVerse JSON log bodies;
- forward logs to Loki;
- keep Loki labels low-cardinality.

It must not:

- add `request_id`, `score_id`, `job_id`, `user_id`, `storage_key`, or file
  hashes as Loki labels;
- parse or store request/response bodies;
- rewrite application messages into product-facing text.

### Loki

Responsibilities:

- store operational logs;
- support Grafana Explore and dashboard log links;
- retain logs for a bounded operational window.

It must not:

- act as audit storage;
- act as billing/storage-usage source of truth;
- store labels with unbounded cardinality.

### Prometheus

Responsibilities:

- scrape `/metrics`;
- store service health and SLO metrics;
- alert on user-impacting or operator-actionable degradation.

It must not:

- use raw IDs such as `score_id`, `job_id`, `user_id`, or `request_id` as labels.

### Tempo

Responsibilities:

- store sampled distributed traces;
- support trace-to-log correlation in Grafana;
- receive traces through the OpenTelemetry Collector.

It must not:

- receive traces directly from every application pod when a collector exists;
- store request bodies, MusicXML, OCR text, raw audio, tokens, or emails as span
  attributes.

### OpenTelemetry Collector

Responsibilities:

- receive OTLP traces;
- batch and memory-limit telemetry;
- apply sampling policy;
- export to Tempo.

The collector is the right place for sampling and redaction policy, not random
application modules.

## Application Integration

### Backend

Current:

- writes structured logs to stdout/stderr;
- exposes Prometheus metrics at `/metrics`;
- carries `request_id` and `originating_request_id`.

Future:

- emit `trace_id` and `span_id` in structured logs after OTel is enabled;
- export OTLP traces to the collector;
- persist trace context on durable async records.

### Frontend

Current:

- uses a vendor-neutral observability facade;
- avoids browser console debug logs in source;
- does not send telemetry to Sentry.

Future:

- add OpenTelemetry behind the facade;
- propagate W3C trace context to backend API requests.

## Production Defaults

Recommended starting defaults:

- Loki retention: 14 to 30 days.
- Tempo retention: shorter than logs unless trace volume is proven low.
- Prometheus retention: based on disk budget and SLO needs.
- Practice audio diagnostics: disabled.
- Trace sampling:
  - low percentage for successful requests;
  - 100% for API 5xx;
  - 100% for async terminal failures;
  - explicit diagnostic windows only for high-volume practice spans.

## Grafana Integration

Grafana should include:

- Prometheus datasource;
- Loki datasource;
- Tempo datasource;
- derived field from Loki `trace_id` JSON field to Tempo;
- dashboard links from metrics panels to Loki Explore.

See:

- `docs/operations/observability/grafana-dashboard-requirements.md`
- `docs/operations/observability/grafana-loki-query-runbook.md`
- `docs/operations/observability/minikube-observability-runbook.md`
- `docs/operations/observability/opentelemetry-tempo-tracing-plan.md`

## Deployment Order

1. Create `observability` namespace.
2. Deploy Loki.
3. Deploy Grafana and Prometheus through `kube-prometheus-stack`.
4. Deploy Fluent Bit and confirm JSON logs parse correctly.
5. Add Grafana Loki datasource and query runbook links.
6. Deploy Tempo.
7. Deploy OpenTelemetry Collector.
8. Enable backend OTel in staging only.
9. Add trace-to-log derived fields in Grafana.
10. Review storage, retention, and sampling before production rollout.

## Verification Checklist

- API logs appear in Loki as JSON.
- Worker logs appear in Loki as JSON.
- `request_id` is queryable from JSON body.
- `request_id` is not a Loki label.
- Prometheus scrapes backend `/metrics`.
- Grafana can link from dashboard panels to Loki Explore.
- Tempo is installed but receives no application traces until explicitly enabled.
- Missing telemetry endpoints fail clearly; nothing exports to a test/default
  endpoint silently.
