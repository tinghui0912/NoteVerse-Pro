# NoteVerseSchedulerLagHigh

This alert means one async operation kind has due records whose
`next_attempt_at` or `next_dispatch_at` has passed, but the scheduler has not
dispatched them within the expected window.

## User Impact

Users may see imports, score previews, playback assets, emails, or cleanup
tasks take longer than expected.

## First Checks

1. Inspect the `Scheduler Lag` panel in Grafana.
2. Compare lag with `Outbox Records By Status`.
3. Check whether `noteverse-backend-beat` is still recording successful scans.
4. Check worker availability for the affected operation kind.
5. Check Redis/Celery broker health if due records are marked dispatched but
   workers do not start processing them.

## Resolution

- If scheduler scans are stale, follow `NoteVerseSchedulerScanStale`.
- If scheduler scans are healthy but lag remains high, inspect worker capacity
  and operation-specific failures.
- Do not manually mutate outbox rows unless a runbook explicitly instructs it.
