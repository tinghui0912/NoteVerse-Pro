# ADR 0003: Split Revision Sources, Render Assets, Playback Assets, and Metadata

- Status: Accepted
- Date: 2026-06-22
- Scope: score-domain storage contract

## Context

Canonical source content, visual render output, playable output and queryable metadata have distinct ownership, permissions, retention and rebuild semantics.

## Decision

1. `ScoreRevisionSource` stores canonical source content for a revision. The current source
   format is `MUSICXML`, with `score-partwise` bytes accepted by
   [canonical document admission](../architecture/score-semantics.md#document-admission).
   The source checksum and revision content hash describe those exact admitted bytes.
2. `ScoreRenderAsset` stores visual derived assets for a revision. The current render kind is
   `RENDERED_PAGE`.
3. `ScorePlaybackAsset` stores playable derived assets for a revision. The current playback
   kind is `AUDIO`.
4. `ScoreRevisionMetadata` remains a typed relational projection keyed by revision.
5. Revision creation stores the canonical source transactionally with the revision.
6. Render assets, playback assets, and metadata are rebuildable from the canonical source and
   are produced asynchronously after revision creation.
7. Score detail and list read models expose only the current head's derived assets.
   Missing head presentation uses neutral placeholders. Only the current head protects render/audio assets; other historical presentation is disposable.
8. Guest Preview exposes only the current head’s rendered pages and generated audio.
   It delivers no revision sources and never falls back to another revision. Guest Preview
   does not retain historical presentation assets.
9. Import-job review artifacts remain job-scoped pipeline artifacts until the user confirms
   the review and creates a score revision.
10. Verovio page count is render/layout information. Pending presentation uses a neutral
    skeleton; unavailable presentation uses a dash. Derived status has no visible error,
    preparation message or Retry action. Accessibility labels remain.

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

- Canonical MusicXML is stored separately from derived images.
- Guest Preview displays current-head rendered pages and audio without exposing score structure.
- Render and playback retention can delete stale derived assets without deleting source
  history.
- Metadata stays efficient to query and can be rebuilt independently.
- Asset APIs and frontend types use explicit source/render/playback names instead of a generic
  artifact bucket.
