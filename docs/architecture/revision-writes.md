# Canonical revision writes

`app/modules/revisions/writer.py` owns immutable revision admission. RevisionService
owns authenticated edit/restore requests; ImportReviewService owns Import confirmation and
Score creation. Both call the canonical RevisionWriter with the same synchronous Session.
Writer participates in the caller's transaction and never commits or rolls back.

PreparedRevisionSource carries revision UUID, durable ObjectWriteReceipt, canonical
hash, generator/version and SOURCE reservation. MusicXML admission precedes physical
prewrite. Writer checks receipt hash, canonical MIME type, exact Score/revision object
identity and reservation owner/category/size before semantic adoption. Unused physical
writes remain ObjectWriteIntent cleanup-owned.

InitialRevisionWrite requires an empty Score revision sequence, creates revision 1
and preserves the initial Score version. AppendRevisionWrite locks and refreshes the
active Score, validates exact expected head and assigns head revision number plus one.
Idempotency resolves under that lock before head conflict. Same-content admission
returns the current head. No-op admission releases the unused reservation.
RestoreLineage identifies a same-Score revision with matching content and adds a
RESTORE ScoreRevisionEvent with the new revision. Notes remain separate commands.

A created revision transaction includes source adoption, initial PENDING metadata,
render/playback/metadata outboxes, head/version, SOURCE reservation accounting,
restore audit when applicable and notification/realtime consequences for non-initial
revisions. Outer rollback discards all semantic writes; callers release the rolled-back
reservation. ScoreRevisionEvent retains revision product/audit history.

Review confirmation retains ImportDispatch → ImportJob → new Score lock order.
Writer participates with Score creation, thumbnail/input promotion, input accounting,
notification attachment and Job CONFIRMED. Import authorization/state validation and
temporary binary cleanup stay in the Review/Import use case.

## Durable downstream work

For each new non-initial revision, Writer resolves the current owner and active-member
audience inside the revision transaction. Non-actor participants receive version-saved
Notification rows and notifications.changed realtime wake-ups; all participants,
including the actor, receive score.revisions.changed realtime rows. Initial revisions
produce neither version-saved notifications nor revision-created realtime.

Notification admission and transactional pg_notify are strict transaction participants.
A failure rolls back the revision, source adoption, accounting, outboxes and all partial
notification/realtime writes together. Idempotent or same-content admissions do not
repeat these consequences. Membership changes after commit do not alter stored recipients.

One RevisionMetadataOutbox per new revision owns execution, separately from the read
row. It stores source fingerprint, request/trace correlation and shared durable
delivery fields. Claim creates a DeliveryAttemptLease. Source read and extraction
run outside final locks. Final admission locks Score then refreshed metadata outbox,
validates exact lease/source, and atomically writes metadata, completes delivery and
adds score.metadata.changed realtime. Stale workers change none of these facts.

`publish_score_change` is strict transactional persistence: recipient resolution,
RealtimeChange inserts/flush and PostgreSQL NOTIFY share the caller transaction.
It never commits, rolls back or catches publication failures. A partial-recipient
or NOTIFY failure rolls back metadata result and delivery completion together; the
worker may then fail the same processing lease in a new transaction for retry.
This includes semantic FAILED metadata results as well as READY results.

MetadataExtractionError is a semantic FAILED result with stable error code, completing
delivery successfully. Storage/read/infrastructure exceptions retry delivery, leaving
metadata PENDING until a result exists. Missing/mismatched canonical source is also
a delivery failure. Source-owned policy is five attempts, 60-second exponential retry,
300-second dispatch/processing leases, 50-row batches and five-second Beat recovery.
Dispatch and broker release consume no attempt.

The metadata rebuild CLI rearms existing durable work and relays it; it never
computes inline or creates a parallel metadata/source admission path. In-flight
DISPATCHED/PROCESSING work cannot be rearmed by that command. Integration seed and
derived-asset smoke setup also use Writer with prepared canonical sources.

Post-commit render/playback/metadata relays are latency hints.
Durable evidence already exists. Retention is background reconciliation under current
head demand, not request-path cleanup. There is no universal revision/background runner.

See [durable delivery](durable-asynchronous-delivery.md) and
[revision derivatives](revision-derivatives.md).
