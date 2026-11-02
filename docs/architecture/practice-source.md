# Practice Source

PracticeSource is one immutable durable source: a semantic artifact, a prepared-MusicXML
notation representation, and one canonical source_id. HTTP consumers may omit notation
from the response; both representations are always durably verified.

## Ownership

```text
ScoreRevision canonical MusicXML
  -> PracticeSourceService: authorize and resolve revision
  -> PracticeSourceBuilder: construct immutable PracticeSource
  -> PracticeSourceRepository: get/create and verify durable READY source
  -> same source_id
       -> live Setup / Practice
       -> durable save admission snapshots provenance
```

The backend package `app/modules/practice/source/` owns domain values, construction,
transport, persistence and retention. `AuthorizedPracticeSource` returns the verified
source, its `PracticeSourceRef` and authorized score/revision metadata together.
`PracticeSourceRef.id` identifies the internal database row; `source_id` identifies
its immutable canonical contents. The upload service consumes the public service
only for new durable save admission.

## Construction and Identity

`PracticeSourceBuilder` prepares MusicXML note IDs exactly once per source build.
The resulting UTF-8 bytes are both the notation representation and the input to the
[Practice score compiler](practice-score-compiler.md). Meter, tempo and artifact
construction refer to the exact notation IDs delivered to the browser.

The frozen PracticeSource contains score/revision identity, prepared MusicXML bytes and a
frozen artifact representation with canonical JSON bytes. Artifact values exposed to
consumers are detached projections of those immutable bytes. The score-domain
`canonical_practice_artifact_bytes` primitive owns JSON serialization: sorted keys,
compact separators, UTF-8, and finite JSON numbers.

`source_id` is the SHA-256 of the UTF-8 pipe-separated tuple:

```text
score_id | revision_id | artifact_id | artifact_schema_version |
prepared_musicxml_sha256 | canonical_artifact_sha256
```

The unique `practice_sources.source_id` stores this identity. Equal revision/source inputs
produce equal representation bytes and source IDs. A representation checksum change
changes the source ID. Including notation in the response does not change the source
identity. HTTP formatting is not the canonical representation checksum input.

## Source Resource and Browser Consumers

The authenticated live route is:

```text
GET /practice/scores/{score_id}/revisions/{revision_id}/source
    ?include_notation=true
```

One request authorizes one revision, constructs one candidate and obtains the verified
READY durable source through the repository before returning. The response is:

```text
{
  source_id,
  artifact,
  notation: null | {
    musicxml,
    mime_type: "application/vnd.recordare.musicxml+xml"
  }
}
```

Setup Start Practice requests `include_notation=true` and admits the complete sourceId,
artifact and prepared MusicXML in one fresh request. `source/admit-practice-source.ts`
passes the command's AbortSignal directly to transport. `source/source-envelope.ts`
strictly parses the artifact, checks requested revision identity and requires notation.
It freezes the admitted representation without copying its artifact graph.
`usePracticeRouteScore` supplies metadata and revision pinning on Setup only.
The optional saved-Take export loader uses the same envelope boundary and verifies
canonical sourceId and descriptive identities through generic live authorization.

## Browser Score Admission and Execution

Setup mounts and configuration edits perform no Source admission. Its explicit command
admits the complete pinned representation before physical acquisition and same-root
validation. Invalid score admission blocks the pinned revision; a transient load failure
remains retryable through the same CTA. Source failure permits no physical acquisition.

PreparedPractice explicitly owns that browser-local representation and its retained
ResourceBinding. Artifact owns score/revision/artifact identity. Practice checks URL and
configuration against these admitted facts and never re-reads Source or Score capability.
Planning and controllers borrow the admitted representation. A direct Practice visit or
reload has no PreparedPractice, performs no Source read and shows Setup required.

The current execution owns its Continuous completion. View Review explicitly hands
that payload and the admitted artifact/MusicXML to a workspace-owned
TransientReviewSession and releases physical roots. Review and its current local
composite/export read only that handoff. Deleting a Score or Revision blocks a future
admission, but does not revoke an already admitted browser transaction. No React Query
cache, persisted browser state or server source read reconstructs that transaction.
Direct Review reload is expired. [Session planning](practice-session-planning.md)
owns these browser lifetimes and transition ordering.

## Durable Admission and Verification

`PracticeSourceRepository.get_or_create` accepts a canonical PracticeSource and the
resolved live revision database identity. It owns source_id lookup, unique creation,
object keys, the CREATING lease, exact representation writes/read-back and the READY
transition. Live responses always consume the repository's verified durable read.
Existing source reuse performs the same verification and does not rewrite objects.
Corruption fails closed; live revision contents do not repair durable storage.

Representation objects use these exact keys:

```text
practice-sources/{source_id}/score.musicxml
practice-sources/{source_id}/artifact.json
```

Every durable read verifies MusicXML/artifact SHA-256 and byte size, artifact schema,
score/revision/artifact identity, canonical artifact JSON bytes and source_id
recomputation. The database owns lifecycle admission: READY queries filter in SQL,
refresh ORM attributes and lock the eligible row throughout verification. Concurrent
unique-source creation admits only a READY source. Final creation admission locks a
CREATING row with a non-null unexpired lease and freshly populated values.

`PracticeSourceRecord` persists in `practice_sources`. Its bigint primary key is the
internal foreign-key target; its unique source_id is the public canonical identity.
Immutable source_score_uuid/source_revision_uuid describe the source independently
of live score rows. The nullable live_revision_id foreign key references ScoreRevision
with ON DELETE SET NULL. Repository resolution binds that owner under revision and
source locks, so a live response cannot leave its source unowned.

## Retention and Deletion

PracticeSource is owned only by ScoreRevision. A READY source is eligible for deletion
exactly when live_revision_id IS NULL. Take and reservation provenance do not retain
representations. Revision deletion releases the live foreign key; Score code has no
Practice cleanup dependency. The maintenance poller discovers orphan READY sources
in bounded batches independently of Take deletion and reservation cleanup.

Failed or expired CREATING sources have a separate cleanup path. Incomplete
representations have no usable live source ownership and can enter DELETING even
while their originating revision exists. Creation lease admission prevents a stale
creator from restoring an ineligible source to READY.

Practice Source owns `PracticeSourceDeleteOutbox` in `practice_source_delete_outbox`
and the `practice_source_deletion` worker/dispatch operation. The outbox retains
canonical source_id and exact representation keys. A worker claims an attempt,
rechecks lifecycle and live revision ownership under current source/outbox locks before object
I/O, deletes the exact objects and source row, and completes the outbox. The locks
fence live revision binding and attempt replacement through deletion. New ownership
cancels or fails cleanup safely. Storage failures remain retryable through the outbox.

## Exact Source Access and Provenance

`sourceId` is admitted once and propagated verbatim through the session plan, local
execution, Continuous Result schema8, completion, Review and save request. It is
never reconstructed downstream from descriptive score/revision/artifact identities.
`localSessionId` identifies browser execution; takeId identifies a saved performance;
VideoExport sessionId identifies browser-local composition/export. Each is distinct
from sourceId. Current Review VideoExport consumes its transient admitted inputs;
saved Take VideoExport requires the generic live authorization below. Neither export
creates a server asset or grants sharing access.

```text
GET /practice/sources/{source_id}?include_notation=true
```

The exact-source route reads an existing READY durable source and does not compile
or resolve revision contents. Source possession is not authorization. The service
requires a live_revision_id, applies Score Practice access policy to persisted
score/revision provenance and verifies that the authorized revision is the live owner.
The repository refreshes and locks READY state, then verifies the exact stored bytes.
This endpoint authorizes server reads independently of browser handoff ownership.
An admitted Practice/Review flow does not call it. Shared source-envelope parsing
validates the current saved-Take browser read. Each saved-export entry requests fresh
authorization and withholds cached representation data until that read succeeds.
An unavailable/non-READY exact source is not found; no alternate source is selected.

Ordinary exact-source access and new save admission fail closed after logical Score
deletion or revision removal. A saved source_id is an exact historical representation
fingerprint, not a guaranteed retrievable resource handle. Optional saved-Take local
score-based export calls the generic exact-source route under current Score/Revision
access. If unavailable, raw Take playback and download remain usable.

## Durable Save Admission

An upload request submits source: { source_id }, scope/tempo selections and recording/media
evidence. `PracticeSourceService.authorize_source_for_save` owns lock-bearing admission.
It obtains locks in Score -> Revision -> selected membership/grant/redemption -> Source
order. The ordinary read-only ScoreAccessPolicy remains unchanged. Authorization facts
and READY representation verification stay protected until the reservation commits.

A save that holds admission locks commits its snapshot before a waiting Score deletion.
If deletion commits DELETING first, a new save fails. No browser admission token grants
server save access after deletion. Pure [Practice planning](practice-session-planning.md#durable-save-planning)
derives canonical scope/tempo from the exact verified artifact during admission only.

UploadReservation persists source_id, source_score_uuid, source_revision_uuid,
source_artifact_id and score_title_snapshot, alongside server-resolved planning and media
facts. linked_score_id is optional navigation with ON DELETE SET NULL. A committed
reservation is self-contained: replay, upload refresh, cancellation, expiry, finalize,
recovery and cleanup do not read or retain PracticeSource.

PerformanceTake owns raw media and the immutable provenance snapshot copied from its
reservation. Listing, playback, download and deletion use Take ownership alone.
Finalization never re-reads Source, revision or score title; it copies persisted canonical
scope/tempo/timebase. A saved Take remains readable after Source GC and Score deletion.
The [reservation architecture](performance-take-reservations.md) owns upload lifecycle,
transactional quota effects and media object ownership.

The [artifact contract](practice-moment-artifact.md) owns schemaVersion 1 notation/moment
semantics. Source persistence does not define evaluation, timing, resource budgets
or recording evidence semantics.

## Frontend Failure Contract

The Source envelope boundary exposes `SourceFailure.INVALID_SCORE` for deterministic parser,
identity or notation contract failures, and `SourceFailure.LOAD_FAILED` for transport
or service failures. The original cause is retained for diagnostics and safe API-code
formatting. Setup stops before qualification on either failure; load failure is retryable
through Start Practice. The shared strict parser
remains the full score admission authority. See [failure boundaries](practice-failures.md).

## Score Admission

The [Practice score compiler](practice-score-compiler.md) owns quarter-note chronology,
explicit initial meter admission and physical note placement. The builder consumes
its compiled facts for meter, tempo and artifact projections. Deterministic invalid
score input maps to HTTP 422 `practice_score_invalid` at the Source service boundary.
