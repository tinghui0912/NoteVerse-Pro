# Backend Structured Logging Audit

This audit tracks backend logging cleanup for the Kubernetes observability target:

```text
stdout/stderr -> Fluent Bit -> Loki -> Grafana
```

The product UI must only expose stable public messages. Logs may contain operational
diagnostics, but they must remain structured, searchable, and safe for Loki cardinality.

## Completed

### Request and Error Boundaries

- API request middleware emits structured request lifecycle events.
- Central exception handlers now emit structured events:
  - `http.app_exception`
  - `http.request_validation_failed`
  - `http.data_validation_failed`
  - `http.unhandled_exception`
- Validation logs summarize error count, first location, and first type instead of logging
  the full request validation payload.
- Unhandled exceptions are logged with exception metadata and traceback through the
  structured logger, while API responses keep the public error contract.

### Runtime Startup

- Lifespan logs now emit:
  - `app.starting`
  - `app.stopping`
- Startup runtime checks now emit one structured event per configured runtime capability
  or directory preparation result.

### User-Facing Background Side Effects

- Avatar processing logs now use structured events under `account.avatar.*`.
- Notification and realtime best-effort failures now use structured loguru events rather
  than standard-library `logging` extras.
- Practice runtime registration failure is now structured as
  `practice.session_runtime.registration_failed`.
- Import job execution start/failure is structured as:
  - `import_job.pipeline_started`
  - `import_job.pipeline_failed`
- Derived asset retention cleanup and storage object deletion failures now use structured
  events under `derived_asset_retention.*`.

## Current Field Policy

Use these as JSON fields, not Loki labels:

- `request_id`, `originating_request_id`, `task_id`
- `user_id`, `score_id`, `revision_id`, `job_id`
- `storage_key`, `object_id`, `asset_id`
- `exception_type`, `public_code`, `status_code`

Allowed Loki labels remain low-cardinality only:

- `cluster`
- `namespace`
- `service`
- `component`
- `environment`
- `pod`
- `container`
- `level`
- optionally curated bounded `event`

## Remaining Work

### Import Pipeline

The following modules still contain free-form worker logs and should be converted in a
dedicated import-pipeline pass:

- `backend/app/pipeline/context.py`
- `backend/app/pipeline/base.py`
- `backend/app/pipeline/step_tracker.py`
- `backend/app/pipeline/steps/*.py`

Target event pattern:

```text
import_pipeline.step_started
import_pipeline.step_completed
import_pipeline.step_failed
import_pipeline.progress_update_failed
```

Required fields:

- `job_id`
- `step`
- `progress`
- `public_code` when applicable
- `exception_type` on failure

### Processing Engines and Processors

These modules still contain implementation-level logs:

- `backend/app/processing/processors/text_recognition.py`
- `backend/app/processing/processors/text_integration.py`
- `backend/app/processing/engines/paddle.py`
- `backend/app/processing/engines/omr/legato.py`
- `backend/app/processing/engines/matchmaker_live.py`

This is acceptable for the current development phase because they are not exposed to
ordinary users, but they should be cleaned before production:

- replace subprocess command strings with `event`, `engine`, `operation`, `exit_code`
- avoid logging full text payloads or full file paths unless needed for ops debugging
- log traceback through `.opt(exception=...)`, not a separate `Traceback: ...` message

### Logging Facade Cleanup

The backend still contains a few standard-library logging integration points for framework
loggers. That is acceptable when the logs are framework-owned, but application modules
should continue to use `app.core.logger.logger`.

## Next Recommended Pass

1. Convert `backend/app/pipeline/*` to structured import-pipeline events.
2. Convert text recognition/integration processors.
3. Add a lightweight test or lint-style check that blocks new `logger.error(f"...")` and
   `logger.exception(..., extra=...)` patterns in application modules.
4. Add example Grafana Explore queries for `event` and `request_id` to the runbook.
