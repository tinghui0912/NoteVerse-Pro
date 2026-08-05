# Backend Log Event Schema

## Purpose

First-party backend logs are structured operational records. They are not a
debugging dump, a request archive, or a substitute for object storage. Every
record is emitted to stdout and may be retained by the centralized log platform.

## Stable envelope

Every JSON record includes `timestamp`, `level`, `logger`, `message`,
`function`, `line`, and `schema_version`. HTTP records may additionally include
`request_id`, `trace_id`, and `span_id`; `trace_id` and `span_id` are emitted
only from a valid active OpenTelemetry span.

## Field policy

`backend/app/core/logger.py` is the enforcement point. It uses a default-deny
allowlist for bound fields. Adding a field requires all of the following:

1. Classify it in `StructuredLogFieldPolicy` as allowed or forbidden.
2. Explain why the field is necessary for an operational decision.
3. Confirm it has bounded cardinality/value size and contains no secrets or
   user content.
4. Keep identifiers in the JSON body, never as Loki labels.

The regression contract rejects unclassified `logger.bind(...)` keyword fields.

## Never emit

Do not emit request bodies, cookies, authorization headers, passwords, tokens,
email addresses, MusicXML, OCR text, media bytes, local file paths, filenames,
object-storage keys, subprocess stdout/stderr, raw exceptions, or stack traces.
Use a stable `public_code`, `exception_type`, status, and opaque resource ID
instead.

## Allowed operational examples

`event`, `operation_kind`, opaque resource IDs (`job_id`, `score_id`,
`outbox_id`), bounded counters/durations, `status_code`, `public_code`, task
attempt metadata, and scheduler identifiers are allowed when needed.

Practice WebSocket records use `practice.websocket.accepted`,
`practice.websocket.ready`, and one terminal `practice.websocket.closed` or
`practice.websocket.failed` event. They may include opaque session/user IDs,
duration, close status, and a stable public code. They never include control
payloads, audio bytes, alignment content, or client headers.

This policy concerns logs only. Full diagnostics required for a privileged
operator workflow remain in the controlled operations data contract and are
never copied into stdout logs.
