# NoteVerseSchedulerFailuresIncreasing

This alert means one or more scheduler scans failed recently.

## User Impact

Depending on the failed job, async processing may be delayed or retry later.
The alert is warning-level because individual scan failures can recover on the
next Beat tick.

## First Checks

1. Check Beat logs for `scheduler.scan_failed`.
2. Identify the `scheduler_job` label in metrics and logs.
3. Check database connectivity and schema migration status.
4. Check operation-specific outbox or cleanup service errors.

## Resolution

- Fix the root operation failure if the same scheduler job keeps failing.
- Restart Beat only when the process is stuck or no longer records scans.
- Escalate if failures correlate with growing scheduler lag or async backlog.
