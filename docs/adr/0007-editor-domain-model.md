# ADR 0007: Separate Editor Domain Events From MusicXML Cursor Instructions

- Status: Accepted; implementation in progress
- Date: 2026-08-12
- Scope: Customer Web score editor model, MusicXML import/export adapter boundary, Verovio render mapping, and editor command semantics

Implementation status as of 2026-08-13:

- The legacy `Blank` production type has been removed from Customer Web score
  types.
- The legacy MusicXML parser no longer emits editable events for
  MusicXML `<forward>`; forward elements now advance importer cursor state only.
- The old `ScoreEntity` name has been replaced in Customer Web source/tests
  with `ParsedScoreEvent`, which is still a transitional parser/UI DTO and not
  the final editor-domain model.
- Verovio `[data-class="space"]` is no longer an ordinary editable event hit.
  It remains only as an adapter guard so render spaces do not masquerade as
  domain events.

## Context

The original Customer Web score editor parsed MusicXML directly into editor-facing
entities. `ScoreEntity` contains `note`, `chord`, `rest`, and `blank`, where
`blank` represents a MusicXML `<forward>` element. That representation has
spread beyond import/export: parser output, entity indexes, Inspector editing,
insert/update commands, Verovio hit mapping, and connection reconstruction all
need to understand `blank`.

MusicXML `<forward>` and `<backup>` are cursor movement instructions used to
coordinate multiple voices and staves inside a MusicXML part. They are necessary
for interchange and rendering projections, but they are not the musical objects
users intend to edit. Users edit notes, chords, rests, voices, rhythmic
positions, gaps, and notation relationships.

The project is still in development, so this is the right time to remove the
domain leak instead of preserving compatibility aliases or maintaining a
long-lived dual model.

## Decision

1. The Customer Web editor domain model must represent NoteVerse-owned musical
   concepts, not MusicXML serialization mechanics.
2. The editor will replace `ScoreEntity = note | chord | rest | blank` with a
   domain model centered on:
   - `Voice`;
   - `MusicalPosition`;
   - `RhythmicValue`;
   - `PitchedEvent`;
   - `ExplicitRestEvent`;
   - timeline gaps and derived implicit rests;
   - selection anchors such as event, note atom, caret, timeline gap, derived
     rest, notation, and range.
3. A chord is a `PitchedEvent` with multiple note atoms. It is not a separate
   rhythmic event type.
4. An explicit rest is a persisted event only when the user entered it or an
   imported source explicitly encoded it as a rest.
5. An implicit rest or empty rhythmic span is derived from voice events, meter,
   voice activity, and notation policy. It is not persisted as a normal voice
   event.
6. MusicXML `<forward>`, `<backup>`, `divisions`, and MusicXML chord encoding
   belong to the MusicXML importer/exporter and render projection layers.
7. Verovio element ids are render ids. They map through a render anchor to a
   domain anchor; they do not define domain identity.
8. Because this codebase is not yet carrying production compatibility
   requirements, the migration will delete legacy names and old behavior as
   each boundary moves. It must not add compatibility aliases such as
   `Blank = TimelineGap` or keep two equivalent event models.
9. Notation controls such as stem direction, beam notation/grouping overrides,
   tie orientation, and slur placement belong to a notation layer anchored to
   events, note atoms, ties, beams, or notation ids. They should not be folded
   into `PitchedEvent` as if they were core sounding event identity.
10. The canonical editor model must distinguish three layers:
    - musical facts: sounding events and relationships such as pitched events,
      explicit rests, tie relations, slur relations, voices, and rhythmic
      positions;
    - notation intent: explicit imported or user-authored notation overrides
      such as stem direction, tie placement, slur placement, or manual beam
      grouping;
    - engraving results: automatic or renderer-computed layout output such as
      stem length, beam slope, notehead offsets, and bezier control points.
11. The notation layer stores explicit intent and overrides only. Automatic
    engraving output must not be written back into the canonical editor model
    simply because Verovio or another renderer computed it.
12. Tie, slur, and beam existence must be modeled separately from visual
    controls. For example, a future tie relation defines the sounding
    connection, while an optional tie notation control defines placement or
    orientation overrides for that existing relation.
13. MusicXML import uses a document-order serialization cursor. Voice identity
    and serialization cursor position are separate dimensions: `<backup>`
    rewinds the current XML cursor, and following `<note><voice>...</voice>`
    elements create domain events at that cursor position for their declared
    voice. The MusicXML cursor mechanism must not leak into the domain voice
    model as per-voice mutable cursor state.
14. During migration, each user-editing behavior must have exactly one
    authoritative write path. A non-migrated behavior writes through the legacy
    MusicXML mutation path and then reprojects domain read models from XML. A
    migrated behavior writes through domain commands, exports MusicXML, and then
    refreshes legacy projections. The application must not double-write the
    same behavior through both domain mutation and legacy XML mutation and then
    attempt to merge the results.
15. Empty musical time is selected through caret, timeline-gap, or derived-rest
    anchors. It is not persisted as a `TimelineGapEntity`, and it must not
    reintroduce `Blank` under another name.
16. Rhythmic input placement is a first-class editor concern. Active voice,
    caret position, rhythmic grid resolution, input duration, insertion anchor,
    and render-to-rhythm layout mapping must be modeled separately from
    MusicXML `<forward>` and Verovio space DOM elements.

## Consequences

- `Blank` will be removed from production editor domain code.
- Clicking empty musical time will select a caret, timeline gap, or derived
  rest anchor rather than a MusicXML `<forward>` entity.
- Deleting the last pitch from a pitched event will not silently create a rest.
  Deleting the event creates a gap; creating an explicit rest is a separate
  command.
- Note and chord editing will share one command path based on `PitchedEvent`
  and `NoteAtom`.
- Stem, beam, tie, and slur visual controls can be preserved and edited without
  making them part of the core voice-event identity.
- Absence of a notation override means "let engraving decide"; it is not stored
  as an `auto` value in the canonical model.
- MusicXML import/export tests become the source of truth for `<forward>`,
  `<backup>`, `divisions`, and chord serialization behavior.
- Empty-space insertion can no longer rely on there being a rendered Verovio
  note or space element at the desired rhythmic position. It needs a rhythmic
  input model that can map pointer/keyboard intent to legal positions in the
  active voice.
- Migration parity diagnostics are for proving correctness. They are not a
  runtime double-write merge mechanism.
- Current UI behavior may be temporarily unchanged while the new model is
  introduced, but no new production feature should deepen `blank` as a domain
  entity.

## Delivery Sequence

The detailed implementation plan is
[`editor-domain-model-refactoring-plan.md`](../engineering/plans/editor-domain-model-refactoring-plan.md).

The first implementation phase is intentionally small:

1. Add the new domain type skeleton.
2. Add invariant tests for pitched events, explicit rests, derived gaps, delete
   semantics, and MusicXML cursor movement.
3. Keep current UI behavior untouched until importer/exporter and selection
   migration are ready.

## Rejected Alternatives

- Continue polishing `blank = <forward>` as an editable score entity: rejected
  because it keeps MusicXML transport semantics in the editor domain and
  multiplies special cases in Inspector, selection, and command logic.
- Hide `blank` from the UI but keep it in the domain model: rejected because it
  still leaves future maintainers with two concepts for one empty rhythmic span.
- Rename `Blank` to `TimelineGap` while preserving the same union branch and XML
  identity: rejected because it would be a semantic alias, not a boundary fix.
- Treat zero pitches as a rest in the new domain model: rejected because it
  confuses notehead editing with the explicit user intent to create a rest.
