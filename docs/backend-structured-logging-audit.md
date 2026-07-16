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
- Import pipeline orchestration and steps now use structured events under:
  - `import_pipeline.step_*`
  - `import_pipeline.progress_*`
  - `import_pipeline.input_copy_*`
  - `import_pipeline.omr_*`
  - `import_pipeline.xml_*`
  - `import_pipeline.text_*`
- Derived asset retention cleanup and storage object deletion failures now use structured
  events under `derived_asset_retention.*`.
- Orphan upload cleanup and score fingering failures now use structured events.
- Text recognition, text integration, OCR subprocess execution, LEGATO OMR, and
  practice matchmaker diagnostics now use structured events and avoid logging
  recognized user text as ordinary message content.
- High-volume practice diagnostics are disabled by default and additionally
  sampled through `PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL` and
  `PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL` when enabled.

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

### Logging Facade Cleanup

The backend still contains a few standard-library logging integration points for framework
loggers. That is acceptable when the logs are framework-owned, but application modules
should continue to use `app.core.logger.logger`.

### Regression Guard

`backend/tests/test_structured_logging_contract.py` scans application Python files with
AST and blocks these patterns from coming back:

- `from celery.utils.log import get_task_logger`
- `logging.getLogger(...)` outside framework logging setup
- `logger.info(f"...")`, `logger.warning(f"...")`, `logger.error(f"...")`, etc.
- `logger.exception(..., extra=...)`

This is intentionally small and strict. If a future module genuinely needs a different
logging integration, document the exception before relaxing the guard.

## Next Recommended Pass

1. Add trace correlation fields once OpenTelemetry and Tempo are introduced.
2. Periodically review diagnostic event volume after staging traffic exists.
