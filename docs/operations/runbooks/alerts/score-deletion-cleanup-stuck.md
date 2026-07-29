# Score Deletion Cleanup Stuck

Alert: `NoteVerseScoreDeletionCleanupStuck`

Severity: `warning`

## Meaning

One or more scores have remained in cleanup/deleting state beyond the expected
cleanup service-level objective.

## User Impact

Users may see storage quota not released promptly, or deleted scores may remain
in backend cleanup state. The deleted score should not reappear in product
lists.

## First Checks

Open `Score Deletions By Status` and check how many records are in `deleting`.

Check cleanup worker and scheduler health:

```powershell
kubectl logs -n noteverse-staging deploy/noteverse-backend-beat --tail=100
kubectl logs -n noteverse-staging deploy/noteverse-backend-worker --tail=100
```

## Triage

1. Confirm cleanup tasks are being dispatched.
2. Check storage deletion errors in structured logs.
3. Check object storage credentials and bucket access.
4. Check if database rows are blocked by references that should have been
   cleaned by lifecycle services.

## Mitigation

- Fix storage credentials or object store availability first.
- Retry cleanup through the normal cleanup worker path.
- Avoid manual row deletion unless the lifecycle service cannot recover and a
  written data-repair plan exists.

## Escalation

Escalate if user quota is materially wrong, cleanup backlog keeps growing, or
object storage deletion repeatedly fails.
