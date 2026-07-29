# Backend High P95 Latency

Alert: `NoteVerseBackendHighLatencyP95`

Severity: `warning`

## Meaning

The p95 request latency for a NoteVerse backend service is above 2.5 seconds for
10 minutes.

## User Impact

Users may experience slow uploads, slow score pages, delayed settings changes,
or sluggish realtime/practice setup.

## First Checks

Open the `NoteVerse Application Overview` dashboard and inspect:

- request latency p50 and p95;
- request rate;
- 5xx ratio;
- realtime active connections.

Check Kubernetes resource pressure:

```powershell
kubectl top pods -n noteverse-staging
kubectl top nodes
```

For production, replace the namespace.

## Triage

1. Identify whether latency is isolated to API, practice backend, or both.
2. Check whether request rate increased before latency rose.
3. Check Pod CPU and memory pressure.
4. Check database and Redis latency from their provider dashboards.
5. Check logs for slow operation names, request IDs, and route labels.
6. Check whether an async backlog or storage operation is affecting request
   paths.

## Mitigation

- Scale stateless backend replicas if CPU-bound and downstream dependencies are
  healthy.
- Roll back recent code if latency correlates with a deploy and no dependency
  issue is present.
- Reduce non-critical traffic or disable expensive optional actions only through
  explicit feature flags or operational controls.

## Escalation

Escalate if latency affects core flows, continues for more than two alert
windows, or appears together with high 5xx rate.
