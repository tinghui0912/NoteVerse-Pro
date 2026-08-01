# NoteVerseSchedulerScanStale

This alert means a scheduler maintenance job has not completed a successful
scan recently.

## User Impact

New async work may stop being dispatched even though existing worker Pods are
healthy. Imports, derived preview rendering, playback generation, email
delivery, realtime cleanup, or deletion cleanup can appear delayed.

## First Checks

1. Check `noteverse-backend-beat` Pod status.
2. Check backend API `/metrics` for `noteverse_scheduler_last_success_timestamp_seconds`.
3. Check Beat logs around `scheduler.scan_failed` and `scheduler.scan_completed`.
4. If Beat has multiple replicas in staging, check `scheduler.scan_skipped`
   logs and `noteverse_scheduler_lock_skipped_total` to confirm only lock
   contention is occurring.
5. Check PostgreSQL connectivity from backend workloads.
6. Check Redis/Celery broker connectivity only after confirming the scheduler
   scan itself is healthy.

## Resolution

- Restart `noteverse-backend-beat` if the process is stuck.
- Fix database or broker connectivity if errors are present.
- If only one scheduler job is stale, inspect that job's outbox or maintenance
  service before restarting unrelated components.
