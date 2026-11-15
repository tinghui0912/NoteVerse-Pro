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

The daily Beat pass reconciles disposable presentation; revision requests do not run
retention cleanup after commit.
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

RevisionWriter admits render/playback and metadata outboxes with source/head/accounting
and non-initial notification/realtime consequences in the canonical business transaction. Its result carries
durable work identities. After COMMIT, the API attempts best-effort relay and projection
catch-up. Metadata extraction is independently fenced durable execution. Guest Preview
settings only change bearer access and do not enqueue or reactivate derivative work.

The neutral revision dispatcher and Beat maintenance use the same producer: mark and
commit DISPATCHED, publish the stable Celery task, and release dispatch on broker failure.
The shared `app.task_queue` package owns Celery assembly, runtime options, producer tracing
and schedule wiring; it imports no worker execution implementation. API relays execute
after the semantic transaction using a short-lived synchronous Session.

Broker or dispatcher failure does not invalidate the saved revision. A released PENDING
outbox is due for Beat recovery. A relay crash that leaves DISPATCHED work is recoverable
through its finite lease. Beat retains stale PROCESSING recovery and existing retry/backoff.

## Worker admission and lock order

Workers lock Score before outbox, recheck current demand, then claim expensive generation.
After physical generation and ObjectWriteIntent prewrite, workers lock and refresh
Score, then the exact outbox. They validate the immutable DeliveryAttemptLease and
target revision, source fingerprint and render profile/audio kind before semantic
asset adoption or quota allocation. This final admission uses the same
presentation-demand policy and serializes with head writers. Score precedes outbox,
then subordinate object/adoption locks. Claim uses the same order; maintenance and
terminal outcome commands lock outboxes without subsequently acquiring Score.
Retention/head writers lock Score before changing presentation or rearming outboxes.

Asset replacement, StoredObject adoption, usage allocation/release, retirement enqueue
and exact delivery completion commit in one worker-owned transaction. Generation
services flush that transaction without committing it. Ready realtime rows follow
accepted completion in the same transaction. Physical render/audio computation and
storage prewrite run outside aggregate/delivery locks.

Ready and accepted failed signals use strict `publish_score_event`. Recipient
lookup, every RealtimeEvent flush and transactional pg_notify must succeed before
the caller commits. Ready publication failure rolls back adoption, usage,
retirements, completion and partial recipient rows. ObjectWriteIntent retains
the unadopted physical prewrites for cleanup. The worker can fail its exact lease
in a new transaction and publish failed atomically with that transition.

Failed publication failure also propagates: FAILED and partial signals roll back,
leaving the processing lease for maintenance recovery. No best-effort fallback
weakens these accepted-outcome guarantees. Genuine best-effort notification hints
remain a separate explicit policy and retain their own transaction handling.

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

Thumbnail claim and final adoption lock ImportJob before RenderOutbox, followed by
subordinate adoption/accounting locks. Review confirmation and Import deletion acquire
ImportDispatch before ImportJob; they never acquire ImportDispatch after holding a
thumbnail outbox. Confirmation/temporary-artifact release serializes on ImportJob,
so thumbnail final admission observes current state/source before any mutation.
Thumbnail artifact replacement, TEMP_IMPORT accounting, retirement and outbox
completion share one transaction.

Lease loss raises StaleDeliveryAttempt and returns `stale` without completing,
failing or superseding the current attempt. Domain head/source invalidation remains
a separate superseded/unavailable outcome. A stale generator leaves only physical
prewrites owned by ObjectWriteIntent cleanup, with no semantic asset/accounting write
or ready/failed realtime publication. Mail external delivery remains at-least-once;
its provider side effect is outside these database adoption transactions.

Structured superseded/fast-dispatch failure logs carry Score, revision, outbox and
asset-kind correlation without MusicXML or bearer tokens.
