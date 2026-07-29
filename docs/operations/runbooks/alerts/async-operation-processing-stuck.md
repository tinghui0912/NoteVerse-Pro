# Async Operation Processing Stuck

Alert: `NoteVerseAsyncOperationProcessingStuck`

Severity: `warning`

## Meaning

An async operation has remained in a processing state for longer than expected.
This may indicate a lost worker lease, a long-running dependency call, or a
worker crash after claiming work.

## User Impact

Users may wait longer for imports, previews, playback audio, or emails. Product
UI should continue to show stable business states instead of low-level runtime
errors.

## First Checks

```powershell
kubectl get pods -n noteverse-staging -o wide
kubectl logs -n noteverse-staging deploy/noteverse-backend-beat --tail=100
kubectl logs -n noteverse-staging deploy/noteverse-backend-worker --tail=100
```

For production, replace the namespace.

## Triage

1. Identify the affected `kind` label.
2. Compare processing age to the expected worker timeout and retry grace window.
3. Check whether lease-expiry repair tasks are running.
4. Check worker logs for terminal diagnostics.
5. Confirm database connectivity and object storage availability.

## Mitigation

- Restart the affected worker only after logs are collected.
- If the issue started after a release, pause further rollout and evaluate
  rollback.
- If stale leases are not being repaired, inspect beat/scheduler health.

## Escalation

Escalate if processing age exceeds the worker timeout plus retry grace window or
if multiple operation kinds are stuck.
