# Alertmanager Receiver Plan

This plan defines the production alert delivery path for NoteVerse. Dashboard
panels and PrometheusRule resources are not enough for production operations;
alerts need receiver routing, grouping, inhibition, and escalation.

## Current State

Implemented:

- `PrometheusRule/noteverse-application`
- backend target-down alert
- backend 5xx-rate alert
- backend p95-latency alert
- runbook URLs for the first alert group

Not implemented yet:

- Alertmanager receiver configuration;
- notification credentials;
- severity-based routing;
- silence and inhibition policy;
- production on-call escalation.

## Target Path

```text
PrometheusRule
  -> Prometheus
  -> Alertmanager
  -> route by severity/service/environment
  -> receiver
  -> operator action
```

## Receiver Policy

Recommended first production receivers:

- `critical`: paging or high-urgency on-call channel, plus operations chat.
- `warning`: operations chat or low-urgency email.
- `info`: non-paging notification or dashboard-only annotation.

Email can be used for warning or audit notifications. It should not be the only
channel for critical production outages.

## Secret Handling

Receiver credentials must not be committed to Git.

Allowed sources:

- Kubernetes Secret created by an operator script;
- ExternalSecret from a cloud or self-managed secret store;
- sealed or encrypted secret mechanism introduced later.

Forbidden:

- raw webhook URLs in Helm values committed to the repository;
- SMTP passwords in release packages;
- chat tokens in ConfigMaps.

## Alert Grouping And Inhibition

Initial grouping keys:

```text
alertname
namespace
job
severity
```

Initial inhibition rule:

- if `NoteVerseBackendTargetDown` is firing for a target, inhibit lower-severity
  latency and error-rate alerts for the same namespace/job where appropriate.

## Implementation Steps

1. Decide staging receiver channel.
2. Decide production receiver channel and approval owner.
3. Add non-secret Alertmanager values structure to
   `deploy/observability/values/production/kube-prometheus-stack.values.yaml`.
4. Reference receiver credentials through Secret or ExternalSecret.
5. Add a synthetic test alert in staging.
6. Verify grouping, delivery, silence, and resolved notifications.
7. Document receiver rotation and incident response ownership.

## Validation

- A synthetic staging alert reaches the expected receiver.
- Critical alerts include runbook URLs.
- Alertmanager silences work.
- No receiver secret appears in rendered release packages.
- Production package validation does not require real secret values in Git.
