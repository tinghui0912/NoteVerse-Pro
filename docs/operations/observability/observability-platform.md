# Observability Platform

The `observability` namespace contains separately managed Helm releases for
Fluent Bit, Loki, kube-prometheus-stack (Prometheus, Alertmanager and Grafana),
OpenTelemetry Collector and Tempo. The pinned install commands and values live
in `deploy/observability/README.md` and its environment-specific values.

Application namespaces own their workloads, probes, ServiceMonitors and
PrometheusRules. The internal observability exporter reads database-backed
operational state and exposes metrics; the customer API does not own that scrape.
Application pods emit JSON and explicitly configured OTLP. They do not manage
telemetry storage or receiver credentials.

Loki and Tempo use separate storage configuration and buckets from application
objects. Prometheus/Grafana/Alertmanager storage is governed by their environment
values. Secret values are operator-owned and must not appear in Helm values or
release packages. A rendered chart configuration is not evidence that a cluster
is healthy or an alert receiver is delivering.

The checked-in application alert rules cover target health, latency/errors,
schedulers and asynchronous processing. Receiver routing/escalation requires
environment configuration and a synthetic delivery test. Operations must verify
retention, storage pressure, export failures and correlation before relying on
the installation during incidents.

- [Minikube installation and verification](minikube-observability-runbook.md)
- [Logging pipeline](logging-pipeline.md)
- [Distributed tracing](distributed-tracing.md)
- [Scheduler operations](scheduler-operations.md)
- [Alert delivery](alert-delivery.md)
- [Application runtime contract](../../architecture/runtime/k8s-application-runtime-contract.md)
