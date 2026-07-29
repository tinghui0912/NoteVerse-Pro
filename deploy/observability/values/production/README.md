# Production Observability Values

This directory is reserved for production-only Helm values overlays.

The shared baseline lives in `deploy/observability/values/*.yaml`. Production
must reuse that baseline and add only environment-specific overrides here.

Do not create placeholder production values with fake endpoints, fake secrets,
or minikube storage settings. Add each production override only when the real
cluster decision is known.

Production should use explicit, tested chart and image versions. It should not
float to the latest Helm chart during deployment, and it should not blindly copy
minikube-only compromises. Treat the shared chart versions as the current
validated baseline. If production needs a newer kube-prometheus-stack, Grafana,
Loki, Tempo, Fluent Bit, or OpenTelemetry Collector version, validate that exact
version first and record the promotion decision before rollout.

Expected production overlays before launch:

- `loki.values.yaml`
  - object storage backend;
  - production retention;
  - deployment mode and replica strategy;
  - resource requests and limits.
- `kube-prometheus-stack.values.yaml`
  - Prometheus, Alertmanager, and Grafana persistence;
  - Grafana admin credentials through external secret management;
  - alert routes and receivers;
  - Gateway exposure and TLS policy;
  - resource requests and limits.
- `tempo.values.yaml`
  - object storage backend;
  - production retention;
  - resource requests and limits.
- `otel-collector.values.yaml`
  - sampling policy;
  - resource attributes such as `deployment.environment` and cluster name;
  - replica strategy and resource limits.
- `fluent-bit.values.yaml`
  - cluster label if needed;
  - output TLS/auth if Loki is exposed through a secured endpoint;
  - resource limits for high-volume nodes.

Alert receiver values are intentionally not defined here yet. Before launch,
production must configure Alertmanager or an equivalent notification path
through non-committed Secrets or External Secrets. Dashboard visibility alone is
not production alerting.
