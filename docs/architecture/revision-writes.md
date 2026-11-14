# Canonical revision writes

`app/modules/revisions/writer.py` owns immutable revision admission. RevisionService
owns authenticated edit/restore requests; ReviewService owns Import confirmation and
Score creation. Both enter one sync RevisionWriter through AsyncSession.run_sync.
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
restore audit when applicable and ScoreRevisionCreated. Outer rollback discards all
semantic writes; callers release the rolled-back reservation. ScoreRevisionEvent is
revision product/audit history; DomainEvent is a cross-module committed fact.

Review confirmation retains ImportDispatch → ImportJob → new Score lock order.
Writer participates with Score creation, thumbnail/input promotion, input accounting,
notification attachment and Job CONFIRMED. Import authorization/state validation and
temporary binary cleanup stay in the Review/Import use case.

## Durable downstream work

ScoreRevisionCreated has type `score.revision.created`, version 1, aggregate `score`
and dedupe key `score.revision.created:{revision_uuid}`. Its typed facts include
external Score/revision IDs, number, actor identity/name, origin, initial/restore
lineage, Score title and fact-time participant IDs. It stores no presentation copy.
Initial revisions record facts without version-saved notification/realtime output.

`revision_notifications_v1` creates version-saved notifications for non-actor
participants and notification.created wake-ups. `revision_realtime_v1` creates
score.revision.created for the captured audience. Each commits DB writes with an
independent checkpoint; five-second Domain Event maintenance recovers failures
without recreating a revision. Projection handlers never read ObjectStorage.

One RevisionMetadataOutbox per new revision owns execution, separately from the read
row. It stores source fingerprint, request/trace correlation and shared durable
delivery fields. Claim creates a DeliveryAttemptLease. Source read and extraction
run outside final locks. Final admission locks Score then refreshed metadata outbox,
validates exact lease/source, and atomically writes metadata, completes delivery and
adds score.metadata.updated realtime. Stale workers change none of these facts.

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

Post-commit render/playback/metadata relay and projection catch-up are latency hints.
Durable evidence already exists. Retention is background reconciliation under current
head demand, not request-path cleanup. There is no universal revision/background runner.

See [Domain Events](domain-events-and-projections.md),
[durable delivery](durable-asynchronous-delivery.md) and
[revision derivatives](revision-derivatives.md).
