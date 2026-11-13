# Revision presentation derivatives

ScoreRevision owns a durable immutable complete canonical MusicXML snapshot. Rendered
pages and playback audio are rebuildable presentation, with independent durable outboxes.

## Demand and retention

`presentation_demand.py` is the shared render/audio admission policy. It verifies the
active Score, same-Score revision, source fingerprint and canonical source record.
Presentation is demanded only for the current head. Guest Preview reads that head and
its enabled state does not change derivative demand.

Derived-asset retention protects exactly the current head. Other historical presentation
rows and derived usage are eligible for cleanup immediately, even while new head
presentation is pending. Cleanup releases semantic references and accounting, then queues
unreferenced StoredObjects for durable retirement. Canonical MusicXML snapshots and
PracticeBundle ownership remain independent and durable.

Post-save/restore cleanup and the daily Beat pass reconcile disposable presentation.
Cleanup locks Score and reads its current head; callers supply no head snapshot or
history-window policy.

ScoreRead describes only current-head presentation and exposes `status` and `asset_id`.
Missing head images/audio never select another revision. Generic playback delivery is
exact to its requested revision; Guest Preview resolves the current head on every request.

Score Detail and Library use neutral placeholders for missing head presentation.
Pending/processing can show visual progress; unavailable uses a non-spinning neutral
control. No derived-state visible error/status copy, hover tooltip, toast or Retry action
is provided. Accessibility labels remain. Realtime readiness invalidation reveals the
new head asset naturally. Explicit owner downloads remain revision-exact; canonical
MusicXML download does not wait for derived presentation.

## Durable production

Editor save, append-only restore and Review confirmation create render/playback outboxes
inside the canonical business transaction. RevisionDerivativeService returns both durable
identities. After COMMIT, the API immediately attempts best-effort dispatch. Guest Preview
settings only change bearer access and do not enqueue or reactivate derivative work.

The neutral revision dispatcher and Beat maintenance use the same producer: mark and
commit DISPATCHED, publish the stable Celery task, and release dispatch on broker failure.
The shared `app.task_queue` package owns Celery assembly, runtime options, producer tracing
and schedule wiring; it imports no worker execution implementation. API relays execute
outside the async transaction on a sync database connection.

Broker or dispatcher failure does not invalidate the saved revision. A released PENDING
outbox is due for Beat recovery. A relay crash that leaves DISPATCHED work is recoverable
through its finite lease. Beat retains stale PROCESSING recovery and existing retry/backoff.

## Worker admission and lock order

Workers lock Score before outbox, recheck current demand, then claim expensive generation.
After physical generation, workers lock and refresh Score again before semantic asset
adoption or quota allocation. This final admission uses the same presentation-demand
policy and serializes with head writers. Score locks precede adoption and intent locks.

If the revision loses head status, final admission discards its generated receipts without
creating asset rows or allocating derived usage. ObjectWriteIntent cleanup owns physical
convergence of those unadopted writes. No direct storage deletion substitutes for that
lifecycle. Missing/deleted resources and stale fingerprints remain unavailable failures.

## Outbox outcomes

Valid work without demand becomes SUPERSEDED, a non-error terminal state. Claim-time
supersession does not increase the attempt count. In-flight work that loses demand also
becomes SUPERSEDED after final admission; completion cannot overwrite this outcome.
Neither path publishes a ready event. Duplicate superseded tasks are ignored. Operational
outbox history remains distinct from replaceable derived assets.

REVIEW_THUMBNAIL is outside revision demand. It continues to follow PENDING_REVIEW and
its current source fingerprint. Current-head public status remains presentation-oriented;
an internal SUPERSEDED record maps safely to pending when no ready asset exists.

Structured superseded/fast-dispatch failure logs carry Score, revision, outbox and
asset-kind correlation without MusicXML or bearer tokens.
