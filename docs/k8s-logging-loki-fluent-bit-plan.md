# Kubernetes Logging Plan: Fluent Bit + Loki + Grafana

This document defines the production logging path for NoteVerse Pro on
Kubernetes.

## Target Architecture

```text
backend-api stdout/stderr
backend-worker stdout/stderr
backend-beat stdout/stderr
frontend stdout/stderr
        |
        v
Kubernetes container logs
        |
        v
Fluent Bit DaemonSet
        |
        v
Loki
        |
        v
Grafana Explore / dashboards
```

The application must emit structured JSON logs to stdout/stderr in production.
It must not depend on local log files.

## Service Names

Use stable service labels in Kubernetes metadata:

| Workload | `app.kubernetes.io/name` | `app.kubernetes.io/component` |
| --- | --- | --- |
| FastAPI API | `noteverse` | `backend-api` |
| Celery worker | `noteverse` | `backend-worker` |
| Celery beat | `noteverse` | `backend-beat` |
| Next.js frontend | `noteverse` | `frontend` |

Grafana and Loki queries should use these component names instead of pod names
whenever possible.

## Loki Label Policy

Labels must be low-cardinality. They describe infrastructure dimensions, not
individual users or resources.

Allowed labels:

- `cluster`
- `namespace`
- `service`
- `component`
- `environment`
- `pod`
- `container`
- `level`

Conditionally allowed labels:

- `event`: only if it remains bounded and curated. Start without this as a
  Loki label; query it from JSON body first.

Forbidden labels:

- `request_id`
- `originating_request_id`
- `trace_id`
- `span_id`
- `task_id`
- `user_id`
- `score_id`
- `revision_id`
- `job_id`
- `outbox_id`
- `email`
- `storage_key`
- `sha256`
- file names
- URLs with path parameters or query strings

These fields should remain in the structured JSON log body and be queried with
LogQL JSON parsing.

## Backend JSON Fields

Current backend structured logs should preserve these fields when relevant:

- `timestamp`
- `level`
- `logger`
- `event`
- `message`
- `request_id`
- `trace_id`
- `task_id`
- `originating_request_id`
- `method`
- `path`
- `status_code`
- `duration_ms`
- `operation_kind`
- `job_id`
- `outbox_id`
- `score_id`
- `revision_id`
- `attempt`
- `max_attempts`
- `next_retry_at`
- `internal_error_class`

The same field can be present in the JSON body without becoming a Loki label.

## Fluent Bit Configuration Shape

Use Kubernetes metadata enrichment and parse JSON application logs.

Example shape:

```ini
[SERVICE]
    Flush        1
    Log_Level    info
    Parsers_File parsers.conf

[INPUT]
    Name              tail
    Path              /var/log/containers/*.log
    Parser            cri
    Tag               kube.*
    Refresh_Interval  5
    Rotate_Wait       30
    Mem_Buf_Limit     50MB
    Skip_Long_Lines   On

[FILTER]
    Name                kubernetes
    Match               kube.*
    Merge_Log           On
    Keep_Log            Off
    K8S-Logging.Parser  On
    K8S-Logging.Exclude On

[FILTER]
    Name   parser
    Match  kube.*
    Key_Name log
    Parser noteverse_json
    Reserve_Data On

[OUTPUT]
    Name        loki
    Match       kube.*
    Host        loki-gateway.observability.svc.cluster.local
    Port        80
    Labels      cluster=$cluster,namespace=$kubernetes['namespace_name'],pod=$kubernetes['pod_name'],container=$kubernetes['container_name']
    Label_Keys  level
    Line_Format json
```

Parser sketch:

```ini
[PARSER]
    Name        noteverse_json
    Format      json
    Time_Key    timestamp
    Time_Format %Y-%m-%dT%H:%M:%S.%LZ
```

Important: do not use `request_id`, `user_id`, `score_id`, `job_id`, or
`outbox_id` in `Labels` or `Label_Keys`.

## LogQL Query Examples

For the full operator runbook, see `docs/grafana-loki-query-runbook.md`.

Find backend API errors:

```logql
{namespace="noteverse-prod", container="backend-api"} | json | level="ERROR"
```

Find one API request by request ID:

```logql
{namespace="noteverse-prod", container="backend-api"} | json | request_id="abc12345"
```

Find async work created by one API request:

```logql
{namespace="noteverse-prod"} | json | originating_request_id="abc12345"
```

Find render failures:

```logql
{namespace="noteverse-prod", container="backend-worker"} | json | event="render.failed"
```

Find slow API requests:

```logql
{namespace="noteverse-prod", container="backend-api"} | json | event="api.request_completed" | duration_ms > 1000
```

Find score deletion cleanup failures:

```logql
{namespace="noteverse-prod", container="backend-worker"} | json | event="score_deletion.failed"
```

## Grafana Links

Grafana dashboard panels should link to Explore with query templates:

- by `request_id`
- by `originating_request_id`
- by `operation_kind`
- by `event`

Do not use high-cardinality fields as dashboard variables unless the query is
manually entered by an operator.

## Retention

Initial retention recommendation:

- API and worker operational logs: 14 to 30 days.
- Security/audit events: keep in database audit tables, not only in Loki.
- Debug-level logs: disabled in production unless temporarily enabled for a
  targeted incident window.

## Next Work

1. Add Helm/Kustomize manifests for Fluent Bit and Loki.
2. Confirm application JSON logs parse correctly in a staging cluster.
3. Add Grafana Explore links from operations dashboards.
4. Introduce OpenTelemetry and Tempo after trace sampling and retention policy
   are decided. See `docs/opentelemetry-tempo-tracing-plan.md`.
