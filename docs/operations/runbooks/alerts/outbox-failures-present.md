# Outbox Failure Records

Alert: `NoteVerseOutboxFailuresPresent`

Severity: `warning`

## Meaning

One or more render, playback, or mail outbox records are in a failure state for
longer than the alert window.

## User Impact

Users may see unavailable previews, disabled playback, delayed email flows, or
missing notification delivery.

## First Checks

Open the `Outbox Records By Status` panel and identify `kind` and `status`.

Then inspect recent operations through the ops API or database-backed ops view
when available. Keep raw internal diagnostics out of user-facing UI.

## Triage

1. Identify whether failures are render, playback, or mail.
2. Check if failures are retryable or permanent in the ops view/logs.
3. Check object storage access for render/playback failures.
4. Check provider configuration and delivery quota for mail failures.
5. Check whether failures correlate with a deployment.

## Mitigation

- For transient provider failures, monitor retry recovery.
- For configuration failures, repair Secret/config and trigger the normal retry
  path.
- For release regressions, roll back only after checking migration and outbox
  compatibility.

## Escalation

Escalate when failures affect core import/review/score playback flows or keep
increasing after retry windows.
