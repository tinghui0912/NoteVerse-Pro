# Backend Target Down

Alerts: `NoteVerseBackendTargetDown`, `NoteVerseControlPlaneTargetDown`

Severity: `critical`

## Meaning

Prometheus cannot scrape Customer API or Control Plane for at least 5 minutes.
Use the alert's `job` label to select the workload. The Pod, Service,
ServiceMonitor or internal Cilium network path can be unavailable.

## User Impact

Users may see failed requests, broken realtime connections, or unavailable
Practice bundle flows.

Control Plane loss interrupts operator access and durable scheduler, async
operation and storage-cleanup metrics. Missing scrape data is not a zero backlog.

## First Checks

```powershell
kubectl get pods -n noteverse-staging -o wide
kubectl get svc -n noteverse-staging
kubectl get servicemonitor -n noteverse-staging
kubectl get endpoints -n noteverse-staging
```

For production, replace `noteverse-staging` with the production namespace.

## Triage

1. Confirm the affected target and workload from the alert labels.
2. Check Pod readiness and recent restarts.
3. Check Deployment rollout status.
4. Check Service selectors and endpoint population.
5. Check Prometheus targets for scrape error details.
6. Review recent application logs in Loki for the same time window.

Useful commands:

```powershell
kubectl rollout status deploy/noteverse-backend-api -n noteverse-staging
kubectl logs -n noteverse-staging deploy/noteverse-backend-api --tail=100
kubectl rollout status deploy/noteverse-control-plane -n noteverse-staging
kubectl logs -n noteverse-staging deploy/noteverse-control-plane --tail=100
```

Prometheus reaches `/metrics` directly on the cluster Service at TCP 8000. Check
its monitoring namespace and Pod selector against the workload's Cilium ingress
rule. Gateway `/api` routes preserve the path and do not publish this endpoint;
an external `/metrics` response is not a valid scrape diagnostic.

## Mitigation

- If a rollout is stuck, pause further deploys and inspect the new image and
  migration state.
- If only one replica is unhealthy and enough replicas remain, restart the
  affected Pod after collecting logs.
- If all replicas are failing after a recent release, follow the release
  rollback decision tree in `docs/operations/release/cicd-release-strategy.md`.

## Escalation

Escalate immediately if production API traffic is user-impacting and there is no
healthy replica.
