# Operations

Current deployment, release, observability and recovery procedures are grouped
by operational responsibility. Configuration describes supported repository
behavior; live readiness still requires environment-specific verification.

## Deployment

- [Production Deployment Guide](deployment/production-deployment-guide.md)
- [Kubernetes Deployment Runbook](deployment/k8s-deployment-runbook.md)
- [Gateway and TLS](deployment/k8s-gateway-and-tls.md)
- [Production Preflight](deployment/k8s-production-preflight-checklist.md)
- [Secrets and Storage](deployment/k8s-secrets-and-storage-template.md)
- [Platform Storage](../../deploy/platform/storage/README.md)

## Delivery

- [Container Image Builds](release/container-image-build-strategy.md)
- [CI/CD Release Strategy](release/cicd-release-strategy.md)
- [GitOps Delivery Strategy](release/gitops-delivery-strategy.md)
- [Release Packages](release/release-package-runbook.md)
- [Argo CD Minikube](release/argocd-minikube-runbook.md)

## Observability

- [Platform](observability/observability-platform.md)
- [Logging Pipeline](observability/logging-pipeline.md)
- [Log Event Schema](observability/log-event-schema.md)
- [Distributed Tracing](observability/distributed-tracing.md)
- [Scheduler Operations](observability/scheduler-operations.md)
- [Alert Delivery](observability/alert-delivery.md)
- [Grafana Dashboards](observability/grafana-dashboard-requirements.md)
- [Grafana/Loki Queries](observability/grafana-loki-query-runbook.md)
- [Minikube Observability](observability/minikube-observability-runbook.md)

## Local Runtime

- [Docker Backend Runtime](runbooks/docker-backend-runtime-runbook.md)
- [Minikube From Zero](runbooks/minikube-from-zero.md)
- [Local VM Kubernetes Lab](runbooks/local-vm-k8s-lab.md)
