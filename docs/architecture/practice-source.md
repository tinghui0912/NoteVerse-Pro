# Practice Source

Practice Source is the authorized, deterministic representation of one immutable score revision.
It supplies artifact and notation representations with a common identity.

## Ownership

```text
ScoreRevision canonical MusicXML
  -> PracticeSourceService: authorize and resolve revision
  -> PracticeSourceBuilder: prepare notation and construct bundle
  -> immutable PracticeSourceBundle
       -> live artifact / content representations
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
changes the source ID. HTTP envelopes project the bundle value; their formatting is
not the canonical representation checksum input.

## Live Representations

Authenticated routes under `/practice/scores/{score_id}/revisions/{revision_id}` are:

- `GET /source/artifact`: `{ source_id, artifact }`.
- `GET /source/content`: `{ source_id, score_id, revision_id, content, mime_type }`.

Both requests use the same service and builder. Separate requests independently
construct deterministic bundles; there is no source cache lifecycle. Setup requests
only the artifact. Practice and Review request both representations.

`usePracticeRevisionSource` owns transport mapping, runtime artifact parsing,
score/revision validation and source-ID agreement. It exposes requested representations
only as a coherent source. `usePracticeSource` adapts score-route access and revision
pinning to that query owner. `usePracticeSnapshotSource` uses the same representation
boundary for saved takes. Practice domains consume validated artifacts and remain
independent of API clients and generated DTOs.

## Durable Materialization

`PracticeSourceRepository` consumes a complete bundle. It owns fingerprint lookup,
object keys, the CREATING lease, exact representation writes/read-back, concurrent
creation admission and the READY transition. Reads verify checksums, byte sizes,
artifact structure, score/revision/artifact identity, canonical artifact bytes and
bundle fingerprint before exposing representations.

`PracticeSourceSnapshot` is a durable materialization of the immutable bundle. Its
existing table and foreign keys model that relationship directly. Storage identity is
independent of the continued existence of the live Score row.

Practice Source retention owns reference checks, deletion outbox and worker policy.
PerformanceTake rows and active upload authorizations retain snapshots. A creating
or deleting snapshot cannot be admitted as ready; races and storage failures fail
closed. Outbox retries preserve durable cleanup ownership.

## Performance Take

PerformanceTake authorizes access to the take, identifies its source snapshot and
calls the public Practice Source service for verified reads. Upload authorization
pins an authorized source through that service and consumes the returned score,
revision, artifact and snapshot identities. Media upload/finalization and take
ownership belong to PerformanceTake; source construction, hashing, object writes,
representation validation and retention belong to Practice Source.

Saved-take `/practice-source/artifact` and `/practice-source/content` routes expose
the same source-ID representation concept as live revisions. Snapshot reads remain
available after live score deletion while a durable take retains the snapshot.

The [artifact contract](practice-moment-artifact.md) owns schema3 notation/moment
semantics. Source representation ownership does not define evaluation, timing,
resource budgets or recording evidence semantics.
