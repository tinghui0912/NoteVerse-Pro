# Production Observability Values

This directory is reserved for production-only Helm values overlays.

The shared baseline lives in `deploy/observability/values/*.yaml`. Production
must reuse that baseline and add only environment-specific overrides here.

Do not create placeholder production values with fake endpoints, fake secrets,
or minikube storage settings. Add each production override only when the real
cluster decision is known.

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
  - ingress and TLS policy;
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

