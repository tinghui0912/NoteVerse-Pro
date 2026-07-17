# Grafana Loki Query Runbook

This runbook defines the first operator workflows for troubleshooting
NoteVerse Pro logs in Grafana Explore.

Target stack:

```text
Kubernetes container logs -> Fluent Bit -> Loki -> Grafana Explore
```

See `docs/k8s-logging-loki-fluent-bit-plan.md` for deployment shape and label
policy.

## Query Rules

Use Loki labels only for low-cardinality infrastructure dimensions:

- `namespace`
- `container`
- `level`
- `environment`
- `service`
- `component`

Use JSON fields for high-cardinality diagnostic values:

- `request_id`
- `originating_request_id`
- `task_id`
- `job_id`
- `score_id`
- `revision_id`
- `outbox_id`
- `storage_key`
- `event`

Do not turn IDs into dashboard variables or Loki labels. Operators should paste
IDs into Explore queries when investigating one incident.

Examples below use `namespace="noteverse-prod"`. Replace it with the actual
namespace in each environment.

## API Request Investigation

### Find One Request

Use the `request_id` from a user report, frontend toast/report, API response,
or backend error payload.

```logql
{namespace="noteverse-prod", container="backend-api"}
| json
| request_id="abc12345"
```

Expected fields:

- `event`
- `method`
- `path`
- `status_code`
- `duration_ms`
- `public_code`
- `exception_type` for unexpected failures

### Find Slow Requests

```logql
{namespace="noteverse-prod", container="backend-api"}
| json
| event="api.request_completed"
| duration_ms > 1000
```

Use this after latency alerts to identify routes and request IDs for deeper
inspection.

### Find API 5xx Errors

```logql
{namespace="noteverse-prod", container="backend-api"}
| json
| status_code >= 500
```

If too noisy, narrow to exception-boundary events:

```logql
{namespace="noteverse-prod", container="backend-api"}
| json
| event="http.unhandled_exception"
```

## Async Operation Investigation

### Follow Work Created By One Request

Use this when a request succeeds but a derived asset, email, deletion, or import
operation later fails.

```logql
{namespace="noteverse-prod"}
| json
| originating_request_id="abc12345"
```

Useful fields:

- `operation_kind`
- `job_id`
- `outbox_id`
- `score_id`
- `revision_id`
- `attempt`
- `max_attempts`
- `next_retry_at`
- `public_code`
- `internal_error_class`

### Import Job Lifecycle

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| job_id="8f5a..."
```

To see only pipeline transitions:

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| job_id="8f5a..."
| event =~ "import_pipeline\\..*"
```

Common events:

- `import_job.pipeline_started`
- `import_pipeline.step_started`
- `import_pipeline.step_completed`
- `import_pipeline.step_failed`
- `import_pipeline.progress_updated`
- `import_pipeline.job_completed`
- `import_job.pipeline_failed`

### Render And Playback Failures

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| event="render.failed"
```

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| event="playback.failed"
```

When investigating a specific score:

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| score_id="score_uuid_here"
```

## Score Deletion And Storage Cleanup

### Score Deletion Lifecycle

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| score_id="score_uuid_here"
| event =~ "score_deletion\\..*"
```

Expected events:

- `score_deletion.started`
- `score_deletion.completed`
- `score_deletion.failed`

### Derived Asset Retention

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| event =~ "derived_asset_retention\\..*"
```

Use this for cases where storage usage does not drop after retention cleanup.

### Storage Object Delete Failures

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| event="derived_asset_retention.storage_object_delete_failed"
```

`storage_key` remains a JSON field, not a Loki label.

## Realtime And Notifications

### Notification Creation Failure

```logql
{namespace="noteverse-prod"}
| json
| event="notification.event.create_failed"
```

### Realtime Publish Failure

```logql
{namespace="noteverse-prod"}
| json
| event =~ "realtime\\..*publish_failed"
```

Use this when the database state changes but the UI does not receive an update
until refresh.

## Practice And Audio Diagnostics

Most practice diagnostics should remain disabled in production unless an
incident requires a short targeted window.

Production defaults:

- `PRACTICE_AUDIO_DIAGNOSTICS=false`
- `PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL=15`
- `PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL=15`

If diagnostics are temporarily enabled, keep the interval values greater than
`1` unless the incident window is very short and the operator explicitly accepts
the Loki volume.

```logql
{namespace="noteverse-prod", container="backend-api"}
| json
| event =~ "practice_.*|practice\\..*"
```

High-volume diagnostic examples:

- `practice_audio.gate_diagnostic`
- `practice_alignment.update`
- `practice_alignment.decision`

Do not alert directly on these without sampling or clear thresholds.

## Text Recognition And OMR

### Text Recognition Failures

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| event =~ "text_recognition\\..*failed"
```

### OCR Subprocess Failures

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| event =~ "paddle_ocr\\..*"
```

### OMR Failures

```logql
{namespace="noteverse-prod", container="backend-worker"}
| json
| event =~ "legato_omr\\..*failed|legato_omr\\.failure"
```

Implementation names are allowed in ops logs because they are not product UI
messages. Do not surface these names to ordinary users.

## Dashboard-To-Explore Link Templates

Grafana dashboard panels should link to Explore with these query shapes.

### By Request ID

```logql
{namespace="$namespace"} | json | request_id="$request_id"
```

### By Originating Request ID

```logql
{namespace="$namespace"} | json | originating_request_id="$originating_request_id"
```

### By Async Operation Kind

```logql
{namespace="$namespace", container="backend-worker"} | json | operation_kind="$operation_kind"
```

### By Event

```logql
{namespace="$namespace"} | json | event="$event"
```

Use `$event` only for curated low-cardinality values. Do not expose raw IDs as
drop-down variables.

## Future Trace Correlation

After OpenTelemetry + Tempo is enabled, backend logs should include `trace_id`
and `span_id` in the JSON body. They must remain JSON fields, not Loki labels.

From logs to traces:

```logql
{namespace="$namespace"} | json | trace_id="$trace_id"
```

Grafana derived fields can turn the `trace_id` field into a link to Tempo.

From traces to logs:

- open a trace in Tempo;
- copy `trace_id`;
- query Loki with the LogQL shape above;
- narrow by `request_id` or `originating_request_id` when investigating a
  specific support incident.

Tracing design is documented in `docs/opentelemetry-tempo-tracing-plan.md`.

## Incident Checklist

1. Start from the user-visible request ID, operation ID, score ID, or alerting
   panel.
2. Query narrow infrastructure labels first: namespace and container.
3. Parse JSON with `| json`.
4. Filter by high-cardinality fields in the JSON body.
5. If the failure started from an API request, also query
   `originating_request_id`.
6. Use Prometheus dashboards for rates and SLO impact; use Loki for concrete
   incident details.
7. Do not copy internal stack traces, storage keys, or implementation names into
   user-facing support replies.

## Anti-Patterns

Avoid:

- `{request_id="..."}` as a Loki label selector.
- Dashboard variables listing `score_id`, `job_id`, `user_id`, or `storage_key`.
- Logging request/response bodies by default.
- Searching for raw exception text before trying `event`, `request_id`, and
  `originating_request_id`.
- Treating Loki as the source of record for audit or billing events.
