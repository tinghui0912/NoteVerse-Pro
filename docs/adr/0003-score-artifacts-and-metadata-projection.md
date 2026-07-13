# ADR 0003: Split Revision Sources, Render Assets, Playback Assets, and Metadata

- Status: Accepted
- Date: 2026-06-22
- Updated: 2026-07-13
- Scope: score-domain storage contract

## Context

The original score-domain design used one generic score artifact concept for canonical MusicXML and
rendered pages. That was acceptable during the first score-domain migration, but it became
too broad once the product added external sharing, backend audio playback, asset retention,
and stricter download permissions.

Canonical source content, visual render output, playable output, and queryable metadata have
different ownership, permissions, retention policies, and rebuild semantics.

## Decision

1. `ScoreRevisionSource` stores canonical source content for a revision. The current source
   format is `MUSICXML`.
2. `ScoreRenderAsset` stores visual derived assets for a revision. The current render kind is
   `RENDERED_PAGE`.
3. `ScorePlaybackAsset` stores playable derived assets for a revision. The current playback
   kind is `AUDIO`.
4. `ScoreRevisionMetadata` remains a typed relational projection keyed by revision.
5. Revision creation stores the canonical source transactionally with the revision.
6. Render assets, playback assets, and metadata are rebuildable from the canonical source and
   are produced asynchronously after revision creation.
7. Score detail and list read models may expose the latest available derived assets, including
   fallback assets from a previous revision when the current revision is still generating.
8. External share and public score APIs expose only presentation-safe derived assets by
   default. Revision source download is included only when policy grants download permission.
9. Import-job review artifacts remain job-scoped pipeline artifacts until the user confirms
   the review and creates a score revision.
10. Verovio page count is render/layout information. UI may display unknown while render and
   metadata rebuilds are pending or failed.

## Storage contract

Revision sources use:

```text
scores/{score_uuid}/revisions/{revision_uuid}/sources/...
```

Render assets use:

```text
scores/{score_uuid}/revisions/{revision_uuid}/render/{profile}/...
```

Playback assets use:

```text
scores/{score_uuid}/revisions/{revision_uuid}/playback/...
```

Processing payloads that do not belong to a confirmed score revision use job-aware storage
keys:

```text
jobs/{job_uuid}/{kind}/...
```

## Consequences

- Canonical MusicXML is no longer mixed with derived images.
- External sharing can play audio and show thumbnails without exposing score structure.
- Render and playback retention can delete stale derived assets without deleting source
  history.
- Metadata stays efficient to query and can be rebuilt independently.
- Asset APIs and frontend types use explicit source/render/playback names instead of a generic
  artifact bucket.

## Rejected alternatives

- Keep one generic artifact table: rejected because source, visual, and playback payloads now
  have different permissions and lifecycle policies.
- Store metadata only as JSON/blob payloads: rejected because list/detail views and future
  filtering need typed queryable fields.
- Put import-job intermediates under score revision assets: rejected because review artifacts
  are not durable score revisions.
- Expose MusicXML for all external playback: rejected because playback should not imply source
  download permission.
