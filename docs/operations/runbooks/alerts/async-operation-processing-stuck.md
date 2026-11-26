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
4. Check the Ops failure code, stage, classification, retryable flag and bounded
   detail, then correlate worker logs by operation identity. Processing age uses
   the same canonical SQL status projection as Ops; superseded work is terminal.
5. Confirm database connectivity and object storage availability.

## Mitigation

- Restart the affected worker only after logs are collected.
- If the issue started after a release, pause further rollout and evaluate
  rollback.
- If stale leases are not being repaired, inspect beat/scheduler health.

## Escalation

Escalate if processing age exceeds the worker timeout plus retry grace window or
if multiple operation kinds are stuck.

## Account erasure and physical retirement

Inspect `account_deletion` and `stored_object_retirement` in the same Ops list,
summary and `noteverse_async_operations_by_status` metrics. Check failed counts as
well as backlog: automatic retry exhaustion must remain visible. Scheduler heartbeat
keys are `account_deletion` and `stored_object_retirement`; compare scan failures,
due/dispatched counts and kind-specific dispatch lag. Cancelled retirement is terminal.

Account access has already ended even if erasure fails. Never ask the former user to
log back in. Inspect the failure stage/code/classification and operation ID. Repair
the responsible domain invariant, then use the existing Ops retry command with an
explicit reason. An accepted retry and its operator audit commit together. Account
cleanup resumes its saved phase. Physical retirement is independent; account completion
does not guarantee destruction of shared bytes, provider versions or backups.

For retirement integrity failures, inspect the immutable snapshot and all nine
semantic reference edges in a restricted diagnostic environment. Preserve references,
RESTRICT FKs and the irreversible fence. Never clear the fence, delete ownership
rows to unblock IO, or reactivate cancelled/completed work through SQL. Fix storage
availability for transient failures, then rearm only when domain validation permits.

Backup/version/legal retention periods are not configured in this repository. Before
launch the deployment owner must define them and verify recovery retains authoritative
AccountDeletionOperation evidence newer than a business backup. Do not expose a restored
system to traffic if it can reactivate a closed subject. See the
[business lifecycle contract](../../../architecture/business-resource-lifecycle.md#backup-and-retained-data-boundary).


Physical transfer and media verification work also appears in the exporter through
`noteverse_media_resource_backlog` and `noteverse_media_resource_oldest_age_seconds`.
Unknown writes, unknown completion, expired uncleaned sessions and failed Take media
processing follow the [media recovery runbook](../media-storage-recovery.md).
