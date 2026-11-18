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

`app.modules.revisions` owns `ScoreRevisionRenderOutbox` admission, delivery,
revision target resolution, dispatch and exact revision/profile status queries.
Its table `score_revision_render_outbox` has one durable record per revision/profile.
`ScoreRevisionRenderStatus` owns its typed delivery states, including SUPERSEDED.
`app.modules.rendering` provides only the renderer and execution-manifest mechanics:
MusicXML bytes become normalized pages without database or object-storage access.
`score_assets` owns ScoreRenderAsset adoption, replacement, retirement and accounting.
The worker executes only a Score revision target and fences final adoption against
that exact revision, source fingerprint, render profile and attempt lease.
Import Review owns temporary MusicXML and original uploads; confirmation creates
canonical revision demand, and accepted revision execution creates the first pages.

RevisionWriter admits render/playback and metadata outboxes with source/head/accounting
and non-initial notification/realtime consequences in the canonical business transaction. Its result carries
durable work identities. After COMMIT, the API attempts best-effort relay and projection
catch-up. Metadata extraction is independently fenced durable execution. Guest Preview
settings only change bearer access and do not enqueue or reactivate derivative work.

The post-commit coordinator and Beat maintenance use the domain-owned relays:
`revisions/render_dispatch.py`, `playback/dispatch.py`, and `revisions/metadata_dispatch.py`.
Each relay has its own producer protocol: mark and commit DISPATCHED, publish the stable Celery task, and release
dispatch on broker failure.
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
services flush that transaction without committing it. A score.derived_assets.changed row follows
accepted completion in the same transaction. Physical render/audio computation and
storage prewrite run outside aggregate/delivery locks.

Ready and accepted failed outcomes publish the same score.derived_assets.changed
cache hint through strict `publish_score_change`. Recipient
lookup, every RealtimeChange flush and transactional pg_notify must succeed before
the caller commits. Ready publication failure rolls back adoption, usage,
retirements, completion and partial recipient rows. ObjectWriteIntent retains
the unadopted physical prewrites for cleanup. The worker can fail its exact lease
in a new transaction and admit the same change kind atomically with that transition.

Failed publication failure also propagates: FAILED and partial signals roll back,
leaving the processing lease for maintenance recovery. No best-effort fallback
weakens these accepted-outcome guarantees. Notification admission also uses strict
transactional change publication.

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

Current-head public status remains presentation-oriented; an internal SUPERSEDED
record maps to pending when no ready asset exists.

Lease loss raises StaleDeliveryAttempt and returns `stale` without completing,
failing or superseding the current attempt. Domain head/source invalidation remains
a separate superseded/unavailable outcome. A stale generator leaves only physical
prewrites owned by ObjectWriteIntent cleanup, with no semantic asset/accounting write
or ready/failed realtime publication. Mail external delivery remains at-least-once;
its provider side effect is outside these database adoption transactions.

Structured superseded/fast-dispatch failure logs carry Score, revision, outbox and
asset-kind correlation without MusicXML or bearer tokens.

## Render variant identity

`SCORE_PRESENTATION_RENDER_PROFILE` is the product presentation identity, projected
from `contracts/score/render-profile.json`. It is independent of the renderer's
execution-profile fingerprint. Both preview asset selection and delivery status
query the exact revision/profile pair; neither borrows another variant's facts.
`RenderAssetRead.render_profile` identifies every listed variant. Image downloads
use the presentation profile, and archives require an explicit profile and filter
revision, rendered-page kind and profile together.

The Control Plane exposes this work as `revision_render`, with the revision UUID as
resource identity and the outbox UUID as operation identity. Worker tasks, Beat
maintenance, tracing and `REVISION_RENDER_*` settings use revision-render naming.
