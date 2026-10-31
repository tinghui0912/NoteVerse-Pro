# Practice Source

Practice Source combines a semantic artifact, optional prepared-MusicXML notation,
and one source identity for an authorized immutable score revision.

## Ownership

```text
ScoreRevision canonical MusicXML
  -> PracticeSourceService: authorize and resolve revision
  -> PracticeSourceBuilder: prepare notation and construct bundle
  -> immutable PracticeSourceBundle
       -> source response: artifact + optional notation + source_id
       -> PracticeSourceRepository -> PracticeSourceSnapshot
```

The backend package `app/modules/practice/source/` owns domain values, construction,
transport, persistence and retention. The service returns authorized score/revision
metadata together with the bundle or pinned snapshot reference. Consumers use that
resolution throughout the calling operation.

## Construction and Identity

`PracticeSourceBuilder` prepares MusicXML note IDs exactly once per bundle build.
The resulting UTF-8 bytes are both the notation representation and the input to the
[Practice score compiler](practice-score-compiler.md). Meter, tempo and artifact
construction refer to the exact notation IDs delivered to the browser.

The frozen bundle contains score/revision identity, prepared MusicXML bytes and a
frozen artifact representation with canonical JSON bytes. Artifact values exposed to
consumers are detached projections of those immutable bytes. The score-domain
`canonical_practice_artifact_bytes` primitive owns JSON serialization: sorted keys,
compact separators, UTF-8, and finite JSON numbers.

`source_id` is the SHA-256 of the UTF-8 pipe-separated tuple:

```text
score_id | revision_id | artifact_id | artifact_schema_version |
prepared_musicxml_sha256 | canonical_artifact_sha256
```

The durable `source_fingerprint` is this same identity. Equal revision/source inputs
produce equal representation bytes and source IDs. A representation checksum change
changes the source ID. Including notation in the response does not change the bundle
identity. HTTP formatting is not the canonical representation checksum input.

## Source Resource and Browser Consumers

The authenticated live route is:

```text
GET /practice/scores/{score_id}/revisions/{revision_id}/source
    ?include_notation=false
```

One request authorizes and resolves one revision and builds one bundle. The response is:

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
to that query owner. `usePracticeSnapshotSource` uses the same envelope parser for
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

## Durable Materialization and Admission

`PracticeSourceRepository` consumes a complete bundle. It owns fingerprint lookup,
object keys, the CREATING lease, exact representation writes/read-back, concurrent
creation admission and the READY transition. Reads verify checksums, byte sizes,
artifact structure, score/revision/artifact identity, canonical artifact bytes and
bundle fingerprint before exposing the source.

The database owns lifecycle admission. READY queries filter by READY in SQL and
populate current row attributes. Verified reads use that eligible row under a lock
throughout verification. Fingerprint reuse and unique-create collisions use the same
READY admission. The final creation query locks only a CREATING row with a non-null,
unexpired lease and populates its current attributes. Cached ORM state cannot admit
a DELETING row or restore an ineligible creator to READY.

`PracticeSourceSnapshot` is a durable materialization of the immutable bundle. Its
table and foreign keys model that relationship directly. Storage identity is
independent of the continued existence of the live Score row.

Practice Source retention owns reference checks, deletion outbox and worker policy.
PerformanceTake rows and active upload reservations retain snapshots. Ineligible
state, races and storage failures fail closed. Outbox retries preserve durable cleanup
ownership. PostgreSQL tests use independent sessions and controlled synchronization
to exercise cached state, lease expiry and simultaneous fingerprint creation.

## Performance Take

PerformanceTake authorizes access to the take, identifies its source snapshot and
calls the public Practice Source service. An immutable upload reservation pins a source through
that service and consumes the returned score, revision, artifact and snapshot
identities. Media upload/finalization and take ownership belong to PerformanceTake;
source construction, hashing, object writes, validation and retention belong to
Practice Source. Reservation creation supplies source and save metadata once. Finalize
identifies the public upload reservation and consumes its pinned source without live-score
admission. A completed Take retains the snapshot; the reservation releases its temporary
reference. Its upload UUID is distinct from the internal storage-quota reservation handle.

```text
GET /performance-takes/{take_id}/practice-source?include_notation=true
```

The saved-source route returns the same envelope and verifies one snapshot bundle
per request. Saved-take presentation requests notation. Snapshot reads remain available
after live score deletion while a durable take retains the snapshot.

The [artifact contract](practice-moment-artifact.md) owns schemaVersion 1 notation/moment
semantics. Source representation ownership does not define evaluation, timing,
resource budgets or recording evidence semantics.

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
