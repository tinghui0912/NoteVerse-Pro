# Revision presentation derivatives

ScoreRevision owns a durable immutable complete canonical MusicXML snapshot. Rendered
pages and playback audio are rebuildable presentation, with independent durable outboxes.

## Demand and retention

`presentation_demand.py` is the shared render/audio claim policy. It verifies the active
Score, same-Score revision, source fingerprint and canonical source record. Presentation
is demanded only for the current head or a revision pinned by a non-revoked Guest Preview
whose expiry is in the future. A recent historical revision without a live pin has no
generation demand.

The existing ten-revision derived-asset retention window controls garbage collection of
already-created assets. It creates no generation demand. Head, recent-history retention,
active Preview exclusions and daily cleanup retain their existing policy. Canonical
MusicXML and PracticeSource ownership are independent of presentation scheduling.

## Durable production

Editor save, append-only restore and Review confirmation create render/playback outboxes
inside the canonical business transaction. RevisionDerivativeService returns both durable
identities. After COMMIT, the API immediately attempts best-effort dispatch. Guest Preview
creation also ensures its pinned revision's work and dispatches after commit.

The neutral revision dispatcher and Beat maintenance use the same producer: mark and
commit DISPATCHED, publish the stable Celery task, and release dispatch on broker failure.
The shared `app.task_queue` package owns Celery assembly, runtime options, producer tracing
and schedule wiring; it imports no worker execution implementation. API relays execute
outside the async transaction on a sync database connection.

Broker or dispatcher failure does not invalidate the saved revision or Preview. A released
PENDING outbox is due for Beat recovery. A relay crash that leaves DISPATCHED work is
recoverable through its finite lease. Beat retains stale PROCESSING recovery and existing
retry/backoff. No Beat interval change supplies normal-path immediacy.

## Claim and Preview transaction ordering

Workers lock Score before outbox, recheck current demand, then claim expensive generation.
Guest Preview creation holds the same Score lock while ensuring/rearming the two outboxes
and inserting the pin. A command retains the revision it resolved, even if a concurrent
save advances the head before the command acquires its lock.

If a worker supersedes that historical revision first, the Preview transaction rearms its
work to PENDING before committing the pin. If Preview holds the lock first, the worker
waits and observes committed Preview demand. The pin and its dispatchable work are one
atomic fact. Missing work is created under existing revision/profile/kind uniqueness.
COMPLETED work with valid matching assets remains complete; missing completed assets are
rearmed. No duplicate outboxes or source copies are created.

## Outbox outcomes

Valid work without demand becomes SUPERSEDED, a non-error terminal state. Attempt count
does not increase; dispatch/processing timestamps, backoff and error diagnostics are
cleared. No renderer/audio generator or failed/ready realtime event runs for this outcome.
A later Preview demand can rearm it with a fresh delivery budget. Already PROCESSING work
is allowed to finish. Missing/deleted resources and stale fingerprints remain genuine
unavailable-resource failures, not SUPERSEDED work.

REVIEW_THUMBNAIL is outside revision demand. It continues to follow PENDING_REVIEW and
its current source fingerprint. Current-head public status remains presentation-oriented;
an internal SUPERSEDED record maps safely to pending when no ready asset exists.

Structured superseded/reactivated/fast-dispatch failure logs carry Score, revision,
outbox and asset-kind correlation without MusicXML or bearer tokens.
