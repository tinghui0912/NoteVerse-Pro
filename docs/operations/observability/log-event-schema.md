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

`RequestCorrelationMiddleware` owns HTTP request correlation at application ingress,
outside routing, security middleware and framework error handling. It preserves a
valid incoming `X-Request-ID` or generates a validated ID, binds request state and
the logging context, and attaches the same response header. Customer application
error bodies always carry that nonempty `request_id`. Logging, Origin admission and exception
presentation only consume the established ID. The request binding resets on
completion or exception; detached tasks cannot retain ambient HTTP correlation
after the owning request ends. Durable work records capture originating request
correlation explicitly.

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

Application realtime notification records use bounded event names for SSE
connection open/close and domain notifications. They may include opaque
session/user IDs, durations, close status, and a stable public code. They never
include control payloads, audio bytes, score content, or client headers.
Practice execution and its session diagnostics are browser-local.

This policy concerns logs only. Full diagnostics required for a privileged
operator workflow remain in the controlled operations data contract and are
never copied into stdout logs.
