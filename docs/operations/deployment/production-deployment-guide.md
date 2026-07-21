# Production Deployment Guide

This is the production operator entry point. It intentionally shares concepts
with the minikube runbooks, but it is a separate path because production must
not inherit local-only workarounds.

Use this guide when preparing a real Kubernetes deployment for NoteVerse Pro.

## Read First

Read these documents in order:

1. [Kubernetes Deployment Runbook](k8s-deployment-runbook.md)
2. [Kubernetes Production Preflight Checklist](k8s-production-preflight-checklist.md)
3. [Kubernetes Ingress And TLS](k8s-ingress-and-tls.md)
4. [Kubernetes Secrets And Storage Template](k8s-secrets-and-storage-template.md)
5. [Container Image Build Strategy](../release/container-image-build-strategy.md)
6. [CI/CD Release Strategy](../release/cicd-release-strategy.md)
7. [Kubernetes Observability Deployment Skeleton](../observability/k8s-observability-deployment-skeleton.md)
8. [Kubernetes Application Runtime Contract](../../architecture/runtime/k8s-application-runtime-contract.md)

## Production Target Shape

- model assets: node-local PV/PVC for worker nodes;
- user uploads, score sources, rendered pages, and audio: S3-compatible object
  storage;
- database: managed PostgreSQL;
- Redis and Celery broker: managed Redis;
- logs: container stdout/stderr -> Fluent Bit -> Loki -> Grafana;
- metrics: Prometheus -> Grafana;
- traces: OpenTelemetry Collector -> Tempo -> Grafana;
- images: immutable registry tags or digests from CI.
- ingress: Ingress Controller exposed through `Service/type=LoadBalancer`;
- TLS: cert-manager DNS-01 issuer or cloud-managed certificate automation.

## What Is Shared With Minikube

The following should stay conceptually aligned with local Kubernetes:

- namespace and workload naming conventions;
- ConfigMap and Secret key names;
- readiness, liveness, and runtime-check expectations;
- object storage contract;
- node-local model cache mount contract;
- observability pipeline shape;
- smoke-test categories.

## What Must Be Different From Minikube

Production must not copy local-only shortcuts:

- no `minikube image build --all`;
- no `minikube image load`;
- no Docker Desktop insecure-registry dependency;
- no local CoreDNS patch as a deployment step;
- no test S3 bucket or development database credentials;
- no placeholder hostnames, TLS names, image tags, or cookie settings;
- no committed Secret manifests with real values;
- no relaxed ingress, CORS, or cookie security settings.

## Execution Order

1. Confirm infrastructure readiness.

   Managed PostgreSQL, managed Redis, S3-compatible object storage, ingress
   controller, DNS, TLS automation, Kubernetes nodes, and observability storage
   must exist before app manifests are applied.

2. Prepare image artifacts.

   CI must build, scan, and push immutable frontend and backend images. Deploy
   manifests should reference immutable tags or digests, not mutable local tags.

3. Create production namespace and Secrets.

   Use the naming and required-key contract from
   [Kubernetes Secrets And Storage Template](k8s-secrets-and-storage-template.md).
   Secrets should come from the approved secret-management path, not from
   committed manifests.

4. Render a production overlay.

   Use `scripts/render_k8s_release_overlay.py` with production values, including
   `--auth-cookie-secure true`. Strict validation must fail if placeholders
   remain.

5. Validate manifests before applying.

   ```powershell
   python scripts/check_k8s_application_manifests.py build/k8s-release/production --strict
   .\scripts\quality.ps1 -Check k8s
   ```

6. Deploy observability first.

   Deploy Prometheus, Loki, Grafana, Tempo, Fluent Bit, and the OpenTelemetry
   Collector before enabling full application traffic. This ensures failed
   startup, migrations, and worker failures are observable.

7. Apply database migrations deliberately.

   Run migrations as a controlled release step. Do not rely on arbitrary pod
   startup order to mutate production schema.

8. Deploy application workloads.

   Apply ConfigMaps, Secrets, PVCs, model initialization, API, frontend, worker,
   beat, and ingress resources. Roll out workers only after model assets and
   runtime checks are ready.

   Model assets are prepared by the `model-cache-agent` DaemonSet on nodes
   labeled `noteverse.io/model-cache=enabled`. Worker pods mount that
   node-local cache read-only. Roll workers only after the model-cache DaemonSet
   is ready on the target nodes. API pods do not require model-cache scheduling.

9. Run production smoke checks.

   Validate:

   - health endpoints;
   - authentication and CSRF cookie behavior;
   - realtime/SSE path through ingress;
   - S3 object writes and reads;
   - upload/review/confirm/edit derived-asset flow;
   - deletion cleanup and quota release;
   - logs, metrics, and traces in Grafana.

10. Keep rollback ready.

   Production release notes must identify image digests, migration revisions,
   runtime settings, and rollback constraints.

## Manual Versus Scripted Steps

| Area | Manual | Scripted |
| --- | --- | --- |
| Cloud resources | choose provider services, create databases, Redis, buckets, DNS, TLS | provider-specific automation, outside this repo for now |
| Secrets | approve and inject real secret values | no real Secret files in repo |
| Image publication | review CI result and release tag | GitHub Actions build/push jobs |
| Manifest rendering | choose release values | `scripts/render_k8s_release_overlay.py` |
| Manifest validation | review generated production overlay | `scripts/check_k8s_application_manifests.py`, `scripts/quality.ps1 -Check k8s` |
| Observability | confirm retention, sampling, storage budget | Helm render and validation scripts |
| Smoke tests | choose production-safe test account and data | repository smoke scripts where safe |

## Deployment Gate

Do not deploy production if any of these are true:

- rendered manifests contain placeholders;
- required Secrets or PVCs are missing;
- backend runtime checks fail;
- model cache is not ready on worker nodes;
- object storage writes fail;
- realtime/SSE does not work through the production ingress path;
- Grafana cannot query logs, metrics, and traces;
- rollback constraints are unknown.
