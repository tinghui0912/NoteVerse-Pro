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
already-prepared timeline loader. Meter, tempo and artifact construction therefore
refer to the exact notation IDs delivered to the browser.

The frozen bundle contains score/revision identity, prepared MusicXML bytes and a
frozen artifact representation with canonical JSON bytes. Artifact values exposed to
consumers are detached projections of those immutable bytes. The processing-layer
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

`include_notation=false` returns `notation=null`. Setup uses that option.
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
PerformanceTake rows and active upload authorizations retain snapshots. Ineligible
state, races and storage failures fail closed. Outbox retries preserve durable cleanup
ownership. PostgreSQL tests use independent sessions and controlled synchronization
to exercise cached state, lease expiry and simultaneous fingerprint creation.

## Performance Take

PerformanceTake authorizes access to the take, identifies its source snapshot and
calls the public Practice Source service. Upload authorization pins a source through
that service and consumes the returned score, revision, artifact and snapshot
identities. Media upload/finalization and take ownership belong to PerformanceTake;
source construction, hashing, object writes, validation and retention belong to
Practice Source.

```text
GET /performance-takes/{take_id}/practice-source?include_notation=true
```

The saved-source route returns the same envelope and verifies one snapshot bundle
per request. Saved-take presentation requests notation. Snapshot reads remain available
after live score deletion while a durable take retains the snapshot.

The [artifact contract](practice-moment-artifact.md) owns schema3 notation/moment
semantics. Source representation ownership does not define evaluation, timing,
resource budgets or recording evidence semantics.
