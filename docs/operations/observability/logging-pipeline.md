# Kubernetes Logging Pipeline

Application JSON goes to stdout/stderr, Kubernetes container logs, the Fluent Bit
DaemonSet, Loki and Grafana Explore. Application runtime does not depend on a
local log file. Checked-in values under `deploy/observability/values` configure
Kubernetes metadata enrichment and Loki output.

Fluent Bit parses NoteVerse JSON through the Kubernetes filter's `Merge_Parser`.
With `Keep_Log Off`, a later parser cannot recover the discarded raw payload.
The configured direct Loki service endpoint avoids an unnecessary gateway hop.

Labels describe bounded infrastructure dimensions such as namespace, container,
component and environment. Request, trace, span, task, score, revision, job and
outbox identifiers remain JSON fields, never Loki labels. Do not enable automatic
Kubernetes labels or expose unbounded URLs, filenames or user content as labels.
Not every JSON field is permitted: the backend logger's default-deny policy in
[Log Event Schema](log-event-schema.md) is authoritative.

Operators query opaque IDs with `| json` and use trace IDs to navigate to Tempo.
Audit records remain in their controlled database contract rather than relying
on log retention. Debug logging is a bounded operational decision with the same
redaction policy. Environment retention and storage settings are explicit;
application logs are not a permanent archive.

See [Grafana/Loki Queries](grafana-loki-query-runbook.md),
[Observability Platform](observability-platform.md) and
[Minikube Observability](minikube-observability-runbook.md).
