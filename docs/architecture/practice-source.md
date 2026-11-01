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
       -> saved PerformanceTake
```

The backend package `app/modules/practice/source/` owns domain values, construction,
transport, persistence and retention. `AuthorizedPracticeSource` returns the verified
source, its `PracticeSourceRef` and authorized score/revision metadata together.
`PracticeSourceRef.id` identifies the internal database row; `source_id` identifies
its immutable canonical contents. PerformanceTake consumes the public service.

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
    ?include_notation=false
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

`include_notation=false` returns `notation=null`. Setup requests that representation only
when the user presses Start Practice, forcing a fresh request on every command.
`include_notation=true` includes the exact prepared Practice MusicXML. Practice and
Review request notation for browser presentation consumers such as Verovio.
Notation is a rendering representation, not an evaluation/domain input. STEP and
Continuous consume the validated semantic artifact.

`usePracticeRevisionSource` owns one network query, maps the generated source DTO,
parses the artifact once and validates requested score/revision identity. Its cache
identity includes the notation option. It exposes `sourceId`, `artifact`, `musicXml`
and `sourceQuery`. `usePracticeSource` adapts score-route access and revision pinning
to that query owner. `usePerformanceTakePracticeSource` uses the same envelope parser for
saved takes and additionally validates the take's artifact identity. Practice domains
remain independent of API clients and generated transport DTOs.

## Browser Score Admission and Execution

The source projection's strict `parsePracticeScoreArtifact()` call owns revision-wide
score correctness. It returns the runtime artifact or invalid-source state. Setup performs
no Source request on mount or configuration edits. Its explicit Start Practice command
refetches the pinned revision through this parser before capability checks or Environment
qualification. Invalid revision admission disables that command for the pinned revision;
transient load failure remains retryable. Qualification never runs after Source failure.
Practice loads its artifact and notation through the same parser. Absent/failed/invalid
Source data disables DeviceLease execution and cannot create a plan or controller. These
states render in place; they never automatically route to Setup. Score revision pinning
remains part of the Source query identity.

Planning consumes the admitted artifact, checks its own intent/sourceId/scope/tempo
inputs and produces a candidate plan. Explicit Start captures that plan in the single
PracticeExecutionOwner. Mode controllers and pure execution projections consume
resolved truth without re-traversing the full artifact contract. See
[session planning and execution](practice-session-planning.md).

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

A READY source is retained by any of these current owners:

- its live ScoreRevision;
- a PerformanceTake;
- an active RESERVED or FINALIZING upload reservation.

READY deletion eligibility requires live_revision_id IS NULL and no Take or active
reservation references. Revision deletion releases its live ownership through the
foreign key. Score code has no Practice cleanup dependency. The durable maintenance
poller performs a bounded orphan-source scan independently of Take deletion.
Terminal reservations do not retain sources; completed Takes own their references.

Failed or expired CREATING sources have a separate cleanup path. Incomplete
representations have no usable live source ownership and can enter DELETING even
while their originating revision exists. Creation lease admission prevents a stale
creator from restoring an ineligible source to READY.

Practice Source owns `PracticeSourceDeleteOutbox` in `practice_source_delete_outbox`
and the `practice_source_deletion` worker/dispatch operation. The outbox retains
canonical source_id and exact representation keys. A worker claims an attempt,
rechecks lifecycle and all owners under current source/outbox locks before object
I/O, deletes the exact objects and source row, and completes the outbox. The locks
fence reference admission and attempt replacement through deletion. New ownership
cancels or fails cleanup safely. Storage failures remain retryable through the outbox.

## Exact Source Access and Provenance

`sourceId` is admitted once and propagated verbatim through the session plan, local
execution, Continuous Result schema8, completion, Review and save request. It is
never reconstructed downstream from descriptive score/revision/artifact identities.
`localSessionId` identifies browser execution; takeId identifies a saved performance;
Share Video sessionId identifies presentation/export. Each is distinct from sourceId.

```text
GET /practice/sources/{source_id}?include_notation=true
```

The exact-source route reads an existing READY durable source and does not compile
or resolve revision contents. Source possession is not authorization. The service
requires a live_revision_id, applies Score Practice access policy to persisted
score/revision provenance and verifies that the authorized revision is the live owner.
The repository refreshes and locks READY state, then verifies the exact stored bytes.
Review requests Result.sourceId and verifies the envelope source_id plus artifact
score/revision/artifact projections. Shared source-envelope parsing owns these checks.

Ordinary exact-source access and new save admission fail closed after live revision
deletion. A saved Take authorizes its source through Take ownership and remains
readable independently of the live revision. Active reservations retain their admitted
source through finalization.

## Performance Take

An upload reservation accepts only source: { source_id }. PracticeSourceService
locks and authorizes that exact existing READY source, retaining the lock through
reservation reference creation and commit. Reservation practice_source_id is the sole
immutable Source lineage; linked_score_id is optional live navigation, and score_title
is presentation history. The reservation accepts scope/tempo selections and recording/media evidence.
Pure [Practice planning](practice-session-planning.md#durable-save-planning) derives
canonical durable scope and tempo from the verified exact Source, without rebuilding
or resolving a revision. Finalization consumes its admitted reference without
live score admission; a completed Take becomes the durable source owner.

PerformanceTake owns media upload/finalization and take authorization. Source
construction, serialization, hashing, object persistence, verification and retention
belong to Practice Source. Saved-source access authorizes the Take and delegates its
practice_source_id to PracticeSourceService.read_source_by_id.

```text
GET /performance-takes/{take_id}/practice-source?include_notation=true
```

The saved route returns the same PracticeSourceRead envelope and verifies the same
durable representations once per request. Take-owned source reads remain available
after live score/revision deletion. Saved presentation requests prepared notation.
PerformanceTakeRead.source_id and descriptive source_score_id/source_revision_id/
source_artifact_id come from its SourceRef. RESERVED/FINALIZING replay metadata uses
the reservation SourceRef; COMPLETED replay uses the completed Take SourceRef.

The [artifact contract](practice-moment-artifact.md) owns schemaVersion 1 notation/moment
semantics. Source persistence does not define evaluation, timing, resource budgets
or recording evidence semantics.

## Frontend Failure Contract

The source query exposes `SourceFailure.INVALID_SCORE` for deterministic parser,
identity or notation contract failures, and `SourceFailure.LOAD_FAILED` for transport
or service failures. The original cause is retained for diagnostics and safe API-code
formatting. Setup stops before qualification on either failure; load failure is retryable
through Start Practice. Practice presents failure in place. The shared strict parser
remains the full score admission authority. See [failure boundaries](practice-failures.md).

## Score Admission

The [Practice score compiler](practice-score-compiler.md) owns quarter-note chronology,
explicit initial meter admission and physical note placement. The builder consumes
its compiled facts for meter, tempo and artifact projections. Deterministic invalid
score input maps to HTTP 422 `practice_score_invalid` at the Source service boundary.
