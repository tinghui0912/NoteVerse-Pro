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
