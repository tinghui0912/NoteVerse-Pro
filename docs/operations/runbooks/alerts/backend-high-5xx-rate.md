# Backend High 5xx Rate

Alert: `NoteVerseBackendHigh5xxRate`

Severity: `warning`

## Meaning

More than 5% of NoteVerse backend requests are returning 5xx responses for 10
minutes.

## User Impact

Users may see failed uploads, failed settings changes, broken score actions, or
realtime/practice errors. 5xx responses represent platform-side failures, not
expected user validation errors.

## First Checks

Open the `NoteVerse Application Overview` dashboard and inspect:

- request rate by backend job and status code;
- 5xx error ratio;
- latency during the same time window.

Then query logs around the alert window:

```logql
{namespace="noteverse-staging"} | json | level="ERROR"
```

For production, use the production namespace label.

## Triage

1. Identify which service is producing 5xx responses.
2. Identify whether failures started after a deploy, migration, dependency
   outage, or traffic spike.
3. Check backend logs by request ID when available.
4. Check database, Redis, object storage, and mail provider health from their
   own dashboards or managed service consoles.
5. Check whether async operation failures are rising at the same time.

## Mitigation

- If a recent release caused the issue and schema compatibility allows it,
  roll back the affected workload.
- If an external dependency is degraded, keep user-facing messages stable and
  monitor recovery.
- If load is the cause, scale the affected deployment only after confirming the
  database and downstream services can handle the extra traffic.

## Escalation

Escalate if the 5xx rate continues for more than one alert window, affects core
flows, or coincides with target-down alerts.
