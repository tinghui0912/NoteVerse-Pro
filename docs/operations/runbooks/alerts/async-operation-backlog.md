# Async Operation Backlog

Alert: `NoteVerseAsyncOperationBacklogOld`

Severity: `warning`

## Meaning

At least one async operation kind has had an open non-terminal record for longer
than the configured alert threshold. This can indicate that import, render,
playback, mail, or score-deletion dispatch is not draining.

## User Impact

Users may see delayed imports, missing derived previews, unavailable playback,
or delayed emails. Keep user-facing messages stable and avoid exposing internal
queue or worker details in product UI.

## First Checks

Open the `NoteVerse Application Overview` dashboard and inspect:

- `Import Jobs By State`
- `Outbox Records By Status`
- `Oldest Async Operation Age`
- `Completed Async Duration Average`

## Triage

1. Identify the affected `kind` label.
2. Check whether the relevant worker or scheduler is running.
3. Check the shared Ops projection for `queued`, `dispatched`, `processing` or
   `retrying` work. These are the open states used by the backlog metric.
   `succeeded`, `failed` and `superseded` are terminal. Inspect explicit failure
   code, stage, classification and automatic retryability before choosing manual rearm.
4. Check recent deployment and migration history.
5. Review structured logs for operation IDs in the same time window.

## Mitigation

- If dispatch is stopped, restart or roll back the scheduler/worker component
  after collecting logs.
- If downstream storage or provider access is degraded, wait for recovery or
  pause non-critical retries according to the incident plan.
- If a recent release introduced incompatible outbox state handling, follow the
  release rollback decision tree.

## Escalation

Escalate if backlog age keeps increasing or affects import/review/score detail
flows.

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

`NoteVerseResourceErasureFailed` alerts on stopped account/retirement work through the
same unified status metric. `noteverse_async_operation_oldest_unfinished_age_seconds`
includes stopped failures as well as open delivery. The completion-duration series
measures creation-to-completion for these multi-attempt cleanup operations, including
all committed units and retry delays, rather than only the final worker lease.
