# Backend Target Down

Alert: `NoteVerseBackendTargetDown`

Severity: `critical`

## Meaning

Prometheus has not been able to scrape the NoteVerse backend API target for at
least 5 minutes. This usually means the API Pod, Service, ServiceMonitor, or
network path is unavailable.

## User Impact

Users may see failed requests, broken realtime connections, or unavailable
practice source flows.

## First Checks

```powershell
kubectl get pods -n noteverse-staging -o wide
kubectl get svc -n noteverse-staging
kubectl get servicemonitor -n noteverse-staging
kubectl get endpoints -n noteverse-staging
```

For production, replace `noteverse-staging` with the production namespace.

## Triage

1. Confirm the backend API target is missing or unhealthy.
2. Check Pod readiness and recent restarts.
3. Check Deployment rollout status.
4. Check Service selectors and endpoint population.
5. Check Prometheus targets for scrape error details.
6. Review recent application logs in Loki for the same time window.

Useful commands:

```powershell
kubectl rollout status deploy/noteverse-backend-api -n noteverse-staging
kubectl logs -n noteverse-staging deploy/noteverse-backend-api --tail=100
```

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
