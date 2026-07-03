# ADR 0003: Keep Stored Artifacts Separate From Structured Metadata Projections

- Status: Accepted
- Date: 2026-06-22
- Scope: P0-1 score-domain contract

## Context

The current `File` table stores original inputs, pipeline intermediates, canonical XML, and
rendered pages under a task and `FileKind`. A proposal to treat metadata as another artifact
would unify storage vocabulary but make common score queries depend on JSON/blob parsing and
weaken relational constraints.

## Decision

1. `ScoreArtifact` represents immutable stored payloads associated with one revision.
2. The current closed artifact kinds are `MUSICXML` and `RENDERED_PAGE`. Add export,
   audio, or diagnostics artifact kinds only when a product workflow creates and consumes them.
3. Exactly one canonical `MUSICXML` artifact exists per revision.
4. Rendered artifacts additionally identify page number, renderer-independent render profile,
   generator, and generator version.
5. Original uploads, OMR output, enhanced XML, and other internal pipeline products remain
   job inputs or `ImportArtifact` records until they explicitly become a score revision.
6. `ScoreRevisionMetadata` is a typed, one-to-one relational projection keyed by revision.
7. Metadata is rebuildable from canonical MusicXML and records extraction status, version,
   and classified failure.
8. Frequently displayed or filtered facts use typed columns. Changing key, meter, and tempo
   use structured event arrays.
9. An optional metadata JSON artifact may support diagnostics and reproducibility, but the
   API does not parse it for routine score reads.
10. Verovio page count is layout/render information, not score metadata.

## Metadata semantics

- `measure_count` counts logical measures, not the total number of `<measure>` elements
  across all parts. The extractor uses the reference part and validates cross-part alignment.
- `primary_key_fifths` and `primary_mode` describe the first valid key declaration. All later
  changes remain in `key_signature_events`.
- meter and tempo changes retain their logical measure location.
- `playback_duration_ms` follows the documented repeat-expansion and tempo-change policy.
  Fermatas and performance interpretation are outside the first extractor contract.
- invalid individual metadata declarations are classified. They must not fabricate a zero
  value or invalidate an otherwise readable canonical revision.

## Storage contract

New score payloads use:

```text
scores/{score_uuid}/revisions/{revision_uuid}/{kind}/...
```

New processing payloads use:

```text
jobs/{job_uuid}/{kind}/...
```

Existing objects are not moved merely to normalize paths. A later compaction operation may
copy, hash-verify, switch records, and delete old objects through the storage abstraction.

## Consequences

- Metadata is efficient to query and may be rebuilt independently of stored artifacts.
- Rendered pages and exports remain reproducible and attributable to a revision/profile.
- The artifact table does not become a generic EAV database.
- Revision creation and canonical artifact persistence need a single consistency boundary.
- Metadata extraction may complete asynchronously after revision commit and must expose
  `PENDING`, `READY`, or `FAILED` rather than fake values.

## Rejected alternatives

- Store metadata only as JSON/blob artifacts: rejected because results and future filtering
  need typed queryable data.
- Put all pipeline intermediates under `ScoreArtifact`: rejected because job diagnostics are
  not durable score revisions.
- Store renderer page count on `Score`: rejected because responsive layout changes it.
- Introduce PDF/audio artifact rows before features generate them: rejected as speculative.
