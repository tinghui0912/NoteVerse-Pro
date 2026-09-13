# Editor Domain Model Refactoring Plan

> Status: in progress  
> Created: 2026-08-12  
> Scope: Customer Web score editor domain model, MusicXML adapter boundary, Verovio hit mapping, and editor command model.  
> Policy: the project is still in development, so this plan intentionally avoids compatibility aliases, legacy fallbacks, and long-lived dual models.

## Progress as of 2026-08-13

- The legacy `Blank` type and old `ScoreEntity` / `ScoreEntityType` names have
  been removed from Customer Web source and tests.
- The legacy MusicXML parser no longer emits editable events for
  MusicXML `<forward>`; forward now advances the voice cursor only.
- `getEntityGroupsFromMeasure` excludes MusicXML `forward` groups by default.
  Timing adapters can explicitly request `includeForwardGroups: true` when
  cursor gaps are needed for repair/projection logic.
- `InspectorWritableEntity = Note | Chord | Rest` now marks the temporary
  Inspector-only legacy XML mutation boundary. Add-mode explicit rest writes
  and matched Inspector explicit-rest rhythm writes no longer use it.
- `ParsedScoreEvent = Note | Chord | Rest` is still a transitional parser/UI DTO.
  It is not the final editor-domain model.
- The transitional `ScoreData` voice collection has been renamed from
  `Voice.notes` to `Voice.events` so it no longer claims that rests/chords are
  plain notes.
- Verovio `[data-class="space"]` is no longer an ordinary editable event hit.
  The remaining reference is an intentional adapter guard.
- The Verovio lookup now exposes render ids and measure/staff geometry only.
  The parsed-hit reverse lookup `findParsedScoreEventByRenderId(...)` and the
  `PreviewParsedHit` / parser-domain parity bridge have been deleted.
- The old visual insertion helper
  `src/lib/editor/visual-insert-placement.ts` has been deleted. Add-mode preview
  placement now goes through `src/lib/editor/rhythmic-insert-placement.ts`,
  which resolves a domain caret/rhythmic position and only projects to legacy
  `AddLocation.tick` at the temporary write boundary.
- Verovio measure/staff hit geometry has been moved into
  `src/lib/editor/verovio-geometry.ts`, including direct measure/staff queries,
  horizontal bounds, measure hit lookup, measure index lookup, and nearest staff
  selection.
- Legacy delete mutation has been moved out of `use-entity-editor.ts` into
  `src/hooks/editor/entity-editor/delete-entity.ts`, matching the existing
  insert/update helper boundary.
- Shared XML mutation context helpers now live in
  `src/hooks/editor/entity-editor/musicxml-mutation-context.ts`, centralizing
  parse/location-to-measure lookup and serialize/reparse result creation across
  insert, update, and delete.
- The unused legacy Inspector helper `toWritableEntity` has been deleted from
  `event-inspector-editable-event.ts`; remaining legacy Inspector save
  conversion is named through the explicit `InspectorWritableEntity` bridge.
- Pitch deletion no longer turns the final remaining pitch into a rest. The
  temporary Inspector view model still uses pitch count for display, but
  explicit rest creation/editing is no longer hidden behind the per-pitch
  delete action.
- Inspector option constants have been split from the event save projection
  helper, keeping UI choices separate from transitional writable-entity
  conversion.
- The React Inspector panel now reads its core controls from the current domain
  Inspector projection when available. Legacy `InspectorEditState` is no longer
  the panel's mutable read model; it is generated only at the remaining
  unported legacy XML mutation boundary.
- `ScoreDocument` now carries `notationControls`, and the editor-domain
  MusicXML importer/exporter has a first narrow notation-control round trip for
  event-level stem overrides.
- `setEventStemDirectionOverride` centralizes setting, replacing, and clearing
  event-level stem notation controls so future UI code does not mutate
  `notationControls` arrays directly.
- `getEventNotationControl` and `getEventStemDirectionOverride` centralize
  event-level notation reads so exporters and future UI code do not scan
  `notationControls` directly.
- Writable XML mutation helpers now reject impossible chord writes such as empty
  chords and ambiguous non-empty per-note metadata arrays.
- The legacy MusicXML parser no longer converts a malformed pitchless chord
  member into a single-note chord.
- A read-only React domain source now exists for the editor:
  `useEditorDomainDocument` derives `ScoreDocument` from the current MusicXML,
  and `useEditingDomainInspectorViewModel` resolves the current domain anchor
  to a domain Inspector view model. The view model now includes event-level
  notation controls such as stem direction, so Inspector display no longer
  reads parsed-score event notation as a fallback.
- `EditingSelectionState` is now domain-only. It stores `domainAnchor` and an
  optional domain companion; parsed-score event/location DTOs no longer enter
  global editor selection state. Select/edit no longer opens without a domain
  companion, and `useEditingDomainInspectorViewModel` resolves only from the
  current domain anchor.
- The React Inspector now consumes the domain Inspector projection for read-only
  summary data:
  - event type label;
  - pitch summary;
  - summary icon;
  - duration summary;
  - measure / voice display metadata;
  - supported stem-direction control state.
- The Inspector no longer opens or displays an ordinary event panel solely
  because a parsed legacy event was hit in the preview. Event Inspector content
  must be represented by a current domain Inspector view model. Unsupported
  domain view models, such as timeline gaps until their own UI exists, are not
  silently projected to legacy editable events.
- Ordinary Inspector event writes, delete, beam edits, and tie/slur connection
  writes now use editor-domain commands plus MusicXML export. The remaining
  high-value legacy boundaries are preview/select-edit DTO shape,
  parser-derived `ScoreData` surfaces, and selection companion cleanup.
- Add-mode insert and undo/redo refresh preserve a domain anchor for the selected
  event when the event still exists in the current domain document.
- The legacy-only `useEntityEditor().handleEditEntity(...)` entrypoint has been
  deleted. Existing-event Inspector opens must go through a select/edit payload
  that carries domain identity.
- The preview click adapter no longer creates parsed-hit edit contexts.
  Select/edit opens the Inspector directly from a domain selection companion.
- A first source-id render anchor bridge now exists:
  `createSourceRenderAnchorsFromDocument` builds domain anchors from
  `ScoreDocument` source ids, and `resolveDomainAnchorFromRenderOrSourceId`
  can resolve a Verovio/source id to a domain anchor without depending on
  legacy `ScoreData`.
- The preview select/edit path now resolves a domain anchor, creates a domain
  Inspector companion, and passes that companion directly to
  `useEntityEditor().handleDomainSelectionCompanion(...)`.
- Editor state now stores one `editingSelection` object for the current
  Inspector-open event. Reads and writes now go through `editingSelection`,
  `openEditingSelection`, and `clearEditingSelection`. The state is now
  domain-only: it stores `domainAnchor` and an optional domain companion, not
  parsed event/location DTOs.
- Preview add-mode placement no longer requires clicking an existing parsed
  event or Verovio space. It resolves measure/staff geometry, active track,
  rhythmic grid, and domain document placement through
  `resolveRhythmicInsertPlacement(...)`.
- Preview add-mode placement now returns a domain `InsertionAnchor`. Positions
  inside derived timeline gaps produce `timelineGap` insertion anchors; other
  rhythmic positions produce caret insertion anchors. `ScoreDocument` remains
  separate from derived gaps, which are passed explicitly from the domain import
  state.
- Add-mode command execution now receives `InsertionAnchor` directly. The
  legacy `AddLocation.tick` projection remains only in preview placement UI
  state for caret/mobile comparison; it is no longer the write-command input.
- Editor state now stores the current note-entry `insertionPreview`
  independently from Inspector `editingSelection`. Preview add-mode hover/click
  writes `{ anchor, inputDuration }` and clears it on tool change, escape,
  mouse leave, or confirmed insert. This is not a selection state.
- Domain caret anchors now carry a full `MusicalPosition` instead of only
  `measureId`, so caret selections no longer lose rhythmic offset.
- Preview tie/slur add/delete target validation no longer consumes
  `PreviewParsedHit`. It resolves domain anchors plus render/source ids through
  `getConnectionTarget(...)`, with source ids as the narrow XML-export adapter
  boundary.

Remaining work should focus on replacing `ParsedScoreEvent` / `ScoreData`
consumer paths with the new `editor-domain` projections and command flow,
instead of reintroducing `blank`, `ScoreEntity`, or compatibility aliases.

## Completion assessment as of 2026-08-13

This plan is not complete yet.

Completed or mostly complete:

- Phase 1 target contract: ADR, domain types, and invariant tests exist.
- Phase 2 MusicXML-to-domain importer: importer and focused tests exist.
- Phase 3 domain-to-MusicXML exporter/projection: exporter and round-trip tests
  exist.
- Parts of Phase 6: `Blank`, old `ScoreEntity` names, `Voice.notes`, and
  default `forward` UI grouping have been removed.

Still incomplete:

- Phase 4 selection semantics have moved substantially toward real domain
  selections. Global editor selection is domain-only; select/edit, add/delete,
  and tie/slur preview tools consume domain anchors; connection target
  adaptation is source-id based. The remaining incomplete selection work is
  first-class caret/gap anchors, not parsed-hit parity.
- Phase 4B rhythmic input semantics are partially implemented. The project now
  has pure active-voice/caret/grid/input-duration/insertion-anchor primitives,
  rhythmic-grid snapping tests, `RhythmicLayoutMap` projection tests, preview
  UI wiring for placement-grid/input-duration controls, and domain-backed
  add-mode explicit-rest insertion. Preview add-mode placement now uses
  measure/staff geometry instead of existing parsed event hits and returns a
  domain `InsertionAnchor`, and add command execution consumes that anchor
  directly. The current active insertion anchor is stored in editor state.
  Pitched add-mode input and persistent caret/gap Inspector UI are still not
  implemented.
- Phase 5 Inspector and command model still use transitional
  `InspectorDraft -> InspectorWritableEntity -> XML mutation` projection for
  unmigrated controls. React Inspector state is domain-draft based, and the
  command/exporter path is wired for matched pitched rhythm/dotted/stem,
  explicit-rest rhythm/dotted, note-atom fingering, note-atom accidental, and
  existing note-atom pitch name/octave edits, add/remove pitch, and beam
  direction / join / break edits. Tie/slur edits remain legacy XML paths.
  Beam direction now writes through domain event-notation controls. Beam
  relationships are now represented in
  `ScoreDocument.beamRelationships`, imported from MusicXML, exported back to
  MusicXML, and editable through domain join/break commands from the Inspector
  UI.
- Phase 6 is not fully complete because `Note` and `Chord` remain separate
  transitional parser/UI DTOs instead of one `PitchedEvent`.
- Phase 7 downstream projections still consume `ScoreData` / parsed events in
  measure status, tracks, connections, preview placement, XML updater, history,
  and mutation helpers.

## Decision summary

The editor domain model should describe music-editing concepts, not MusicXML serialization mechanics.

The original `blank` score entity was a parsed representation of MusicXML `<forward>`. That was useful as a short-term bridge, but it is the wrong long-term domain boundary. MusicXML `<forward>` and `<backup>` should be owned by the MusicXML import/export adapter. The editor should instead model voice events, rhythmic positions, explicit rests, derived gaps, and selections.

Target principle:

> NoteVerse users edit voices, rhythmic positions, notes, chords, explicit rests, implicit rests, and notation relationships. They do not edit MusicXML cursor instructions such as `<forward>`, `<backup>`, `divisions`, or MusicXML chord encoding.

## Original implementation evidence

The pre-REC-007 implementation exposed MusicXML transport details across the editor surface:

- `apps/customer-web/src/types/score-types.ts` defines `ScoreEntityType = 'note' | 'chord' | 'rest' | 'blank'`, and `Blank` is part of the persistent editor-facing `ScoreEntity` union.
- `apps/customer-web/src/lib/musicxml/parser.ts` converts MusicXML `<forward>` elements into `Blank` entities and increments voice cursors.
- `apps/customer-web/src/lib/musicxml/core.ts` maps MusicXML `note` and `forward` elements to UI `entityIndex` groups, including `type: 'forward'`.
- `apps/customer-web/src/hooks/editor/entity-editor/insert-entity.ts` creates `<forward>` when inserting a `blank` entity.
- `apps/customer-web/src/hooks/editor/entity-editor/update-existing-entity.ts` has a forward-specific replacement path for updating `blank`, or converting it into note/rest/chord XML.
- `apps/customer-web/src/lib/editor/verovio-entity-map.ts` treats Verovio `[data-class="space"]` as a score-entity hit so rendered spaces can resolve to `blank`.
- `apps/customer-web/src/lib/editor/editable-event.ts` uses pitch count to infer `rest`, `note`, or `chord`; `apps/customer-web/src/components/editor/event-inspector-event-model.ts` preserves original `blank` when an edited event has zero pitches.

These facts were the baseline that justified REC-007. The current source has
already removed `Blank` and the old `ScoreEntity` name; keep this section as
historical evidence and use the progress section above plus the executable
legacy inventory for the current state.

## Target model

The editor should move toward a first-class score document model:

```ts
type VoiceEvent =
  | PitchedEvent
  | ExplicitRestEvent;

type EditorSelection =
  | EventSelection
  | NoteAtomSelection
  | CaretSelection
  | TimelineGapSelection
  | DerivedRestSelection
  | NotationSelection
  | RangeSelection;
```

Recommended core concepts:

- `ScoreDocument`: NoteVerse-owned canonical editor document.
- `Part`, `Staff`, `Voice`, `Measure`: structural score entities.
- `MusicalPosition`: measure plus rhythmic offset.
- `RhythmicValue`: timeline duration plus notation value.
  `timelineDuration` uses quarter-note units: quarter = `1`, half = `2`, whole
  = `4`.
- `PitchedEvent`: one onset, one duration, one voice, and one or more `NoteAtom` values.
- `NoteAtom`: pitch, accidental, fingering, tie anchors, and notehead-level metadata.
- `ExplicitRestEvent`: user-entered or imported explicit rest.
- `TimelineGap`: derived empty span between events in a voice, not a persisted `ScoreEntity`.
- `DerivedRest`: notation projection for an implicit rest generated from gaps, meter, voice activity, and display policy.
- `MusicXmlImporter` / `MusicXmlExporter`: the only layer that understands `<forward>`, `<backup>`, MusicXML `divisions`, and MusicXML chord serialization.
- `RenderProjection`: temporary render document and `RenderAnchor -> DomainAnchor` mapping for Verovio.
- `NotationControl`: event/note/relationship-anchored notation controls such
  as stem direction, beam notation/grouping override, tie orientation, and slur
  placement. These are not core sounding event identity and should store
  explicit imported or user-authored intent, not renderer-computed output.
- `EngravingProjection`: automatic/render-computed display result. This may use
  notation controls as inputs, but its calculated stem lengths, beam slopes,
  bezier control points, and similar layout details should not be written back
  to the canonical editor document by default.
- `ActiveVoice`: the current voice that receives keyboard, palette, or
  empty-space insertion commands.
- `Caret`: a collapsed insertion position in a measure/staff/voice at a
  rhythmic offset.
- `RhythmicGridResolution`: the quantization grid used for placement, snapping,
  keyboard navigation, and empty-space hit resolution.
- `InputDuration`: the duration of the event the user is about to insert. It is
  independent from `RhythmicGridResolution`.
- `InsertionAnchor`: the resolved domain target for insertion, derived from a
  caret, timeline gap, selected event edge, explicit rest action, or derived-rest
  action.
- `RhythmicLayoutMap`: an adapter projection from rendered measure/staff
  geometry to rhythmic positions for each voice. It may consume Verovio geometry
  at the adapter edge, but it must not require a rendered note or
  `[data-class="space"]` element at the target position.

## Non-goals

- Do not keep `Blank` as a long-lived compatibility alias.
- Do not support both `ScoreEntity` and the new event model indefinitely.
- Do not preserve `0 pitches = rest` as a hidden domain conversion rule.
- Do not expose MusicXML `<forward>` or `<backup>` labels in user-facing editor UI.
- Do not refactor unrelated backend, deployment, or Practice runtime code as part of this plan.

## Invariants to enforce

- A `PitchedEvent` always has at least one `NoteAtom`.
- A chord is a `PitchedEvent` with multiple `NoteAtom` values, not a separate rhythmic event type.
- An `ExplicitRestEvent` is intentionally stored; an implicit rest is derived and not persisted as a normal event.
- Deleting a pitched event removes that event and creates a timeline gap. It does not automatically create an explicit rest.
- Clicking empty time selects a rhythmic position or timeline gap, not a MusicXML `<forward>` entity.
- Importing MusicXML `<forward>` advances the import cursor. It does not create a persisted editor event.
- Exporting to MusicXML may generate `<forward>` and `<backup>` from the domain timeline.
- MusicXML `divisions` is adapter state. Domain rhythmic positions and
  durations use quarter-note units: quarter = `1`, half = `2`, whole = `4`.
  Import/export and temporary legacy write boundaries convert between domain
  rationals and source ticks.
- MusicXML import uses a document-order serialization cursor. Voice identity and
  the XML cursor are separate dimensions: `<backup>` rewinds the current XML
  cursor, and following notes create domain events at that cursor position for
  their declared voice.
- Verovio ids are render ids. They map back to stable domain anchors, not to MusicXML element identity as the source of truth.
- Stem direction, beam notation/grouping override, tie orientation, and slur
  placement are notation controls anchored to domain objects. They are not
  modeled as properties that decide whether a voice event is a note, chord, or
  rest.
- Missing notation control state means automatic engraving. Do not persist
  `auto` as an override value.
- Tie/slur/beam relation existence is distinct from visual placement or
  geometry overrides. The relation belongs to musical/notation structure; the
  placement override belongs to notation intent; final shape/coordinates belong
  to engraving projection.
- Timeline gaps can be selected, hovered, and used for insertion, but they must
  remain derived spans. Do not persist a `TimelineGapEntity` or recreate `Blank`
  under a new name.
- `InputDuration` and `RhythmicGridResolution` are independent. For example, a
  quarter note may be inserted on a sixteenth-note grid position.
- Empty voice insertion must not depend on an existing rendered note, rest, or
  Verovio space element in that voice.
- During migration, each user-editing behavior has exactly one authoritative
  write path. Non-migrated behavior writes through legacy MusicXML mutation and
  reprojects domain read models from XML. Migrated behavior writes through
  domain commands, exports MusicXML, and refreshes legacy projections. Do not
  double-write the same behavior through both paths and then merge.

## Refactoring sequence

### Phase 1: Freeze the target contract

1. Add an ADR for the editor domain model and link it from this plan. Done in
   [ADR 0007](../../adr/0007-editor-domain-model.md).
2. Define the new TypeScript domain types under a dedicated editor-domain location, for example `apps/customer-web/src/lib/editor-domain/`.
3. Add unit tests for the core invariants:
   - one `PitchedEvent` can contain one or many notes;
   - explicit rest and derived gap are different concepts;
   - deleting an event produces a gap, not a stored rest;
   - MusicXML `forward` import advances the cursor only.
4. Keep this phase additive only for tests and types, but do not add compatibility aliases from old names to new names.

### Phase 2: Introduce a MusicXML-to-domain importer

1. Create a dedicated importer that reads MusicXML `note`, `forward`, and `backup` in document order.
2. Convert root notes plus MusicXML `<chord/>` members into one `PitchedEvent`.
3. Convert `<note><rest/></note>` into `ExplicitRestEvent`.
4. Treat `<forward>` as cursor movement only.
5. Treat `<backup>` as cursor rewind only.
6. Keep the importer cursor as document-order serialization state only. Do not
   model it as per-voice cursor state inside `Voice`.
7. Preserve imported element ids only as adapter/source metadata when needed for diagnostics or round-trip tests, not as domain identity.
8. Add focused importer fixtures for:
   - single voice with a gap;
   - two voices using `backup`;
   - chord encoding with `<chord/>`;
   - explicit rests;
   - cross-staff or staff-specific voice data.

### Phase 3: Introduce domain-to-MusicXML export/projection

1. Create an exporter/projection that writes temporary MusicXML from the new domain model.
2. Build a measure-level serialization plan before writing XML. The plan owns
   event ordering, voice/staff switching, cursor advancement, and cursor rewind
   policy.
3. Generate MusicXML `<forward>` when the next serialized event starts after the
   current XML cursor.
4. Generate MusicXML `<backup>` when the serialization plan moves the XML
   cursor backward inside the same measure.
5. Serialize `PitchedEvent.notes` with root `<note>` plus MusicXML `<chord/>` members.
6. Serialize `ExplicitRestEvent` as `<note><rest/></note>`.
7. Keep automatic beam repair and backup recalculation adapter-owned, or replace them with projection-owned logic if the new exporter makes them redundant.
8. Add round-trip tests that compare domain invariants, not exact XML formatting.
9. Add notation-control import/export tests that prove absent controls do not
   create MusicXML overrides, explicit controls round-trip, and automatic
   engraving results are not persisted as controls. Done for event-level stem
   override controls.

### Phase 4: Replace editor selection semantics

1. Replace `selectedEntity` and `EntityLocation.entityIndex` flows with domain selections:
   - event selection;
   - note atom selection;
   - caret selection;
   - timeline gap selection;
   - derived rest selection.
2. Keep empty-space interaction, but map it to `TimelineGapSelection` or `CaretSelection`.
3. Keep Verovio `[data-class="space"]` hit testing only if it maps to a domain gap/caret anchor. It must not resolve to `Blank`.
4. Update `editor-preview-panel.tsx` and `verovio-entity-map.ts` to return domain anchors instead of `ScoreEntity` hits.

Current selection migration checkpoint:

| Selection area | Current source | Status | Next safe action |
| --- | --- | --- | --- |
| Extracting a render/source id from Verovio target | `getVerovioRenderElementIdFromTarget` | Transitional but acceptable at adapter edge | Keep this DOM concern local to the Verovio adapter. |
| Resolving render/source id to parser-hit diagnostics | Removed | Deleted | Do not reintroduce parsed-hit edit contexts. |
| Resolving source ids to domain anchors | `createSourceRenderAnchorsFromDocument` + `resolveDomainAnchorFromRenderOrSourceId` | Read-side bridge added | Expand only when a concrete branch can consume the resolved domain anchor. |
| React access to domain anchors | `useEditorDomainRenderAnchors` | Diagnostic hook added | Continue using as the single React source for domain anchors. |
| Domain anchor to Inspector companion | `createDomainSelectionCompanion` | Select/edit read-side consumption added | Use as the select/edit domain input. |
| Parsed/domain selection parity | Removed | Deleted | Do not reintroduce diagnostic bridges that require parsed event DTOs. |
| Select/edit branch input | `handleDomainSelectionCompanion(...)` | Domain anchor is resolved from render/source id; parsed hit is gone | Continue rebuilding any remaining companion snapshots from the current domain document. |
| Inspector-open domain input | `editingSelection.domainAnchor` + `useEditingDomainInspectorViewModel` | Domain-only opening supported for current domain projections | Rebuild the Inspector view model from the current domain document on every XML refresh; do not retain companion snapshots as source of truth. |
| Inspector editing-state writes | `openEditingSelection` / `clearEditingSelection` | Grouped write entrypoints; state stores domain anchor and optional domain companion only | Keep editor state writes grouped; delete companion storage when all read paths can rebuild from the current document. |
| Inspector editing-state reads | `editingSelection` | First read consumers migrated | Continue only for consumers that naturally need grouped state; avoid cosmetic rewrites. |
| Legacy mutation location read | Removed from global selection and ordinary entity mutation | Domain command/export path active for ordinary entity edits/deletes | Do not reintroduce parsed `EntityLocation` mutation helpers. |
| Entity editor hook state surface | `useEntityEditor` | Action-only hook | Keep editor state reads in `useEditorState`; do not reintroduce duplicated state returns. |
| Preview selected-event highlight | `editingSelection.domainAnchor` -> `getRenderIdsForDomainAnchor(...)` | Domain-first for render-id-backed selection | Continue deriving visual source ids from domain anchors and render anchors. |
| Select/edit parity fixture | Real MusicXML through legacy parser + domain importer + source anchor + companion | Fixture added | Use as safety evidence before replacing more select/edit read behavior with domain input. |
| Empty-space / gap selection | Verovio measure/staff geometry + rhythmic insert placement + `InsertionAnchor` + note-entry `insertionPreview` | Add-mode placement and command execution use caret/gap insertion anchors; insertion preview is in editor state as `{ anchor, inputDuration }`; persistent gap/caret Inspector UI is intentionally not exposed | Keep ordinary selection event-based; use insertion preview only for Note Entry / Add mode until explicit gap tools are designed. |
| Connection source id for chord members | `getConnectionTarget(...)` with domain note-atom render anchors | Migrated away from parsed-hit DTOs | Keep source ids as the narrow MusicXML adapter boundary until relationship commands can address note atoms directly end-to-end. |

### Phase 4B: Define rhythmic input and empty-space placement

Phase 4 selection answers "what did the user select?" Phase 4B answers "where
can the user intentionally place the next event when there is no existing event
or Verovio space DOM element to click?" Keep these concepts domain/editor-owned;
do not encode them as MusicXML `<forward>` entities.

Target concepts:

- `ActiveVoice`: the voice that receives keyboard, palette, or empty-space
  insertion commands. It is user/editing context, not MusicXML cursor state.
- `Caret`: a collapsed insertion position in a measure/staff/voice at a
  rhythmic offset.
- `RhythmicGridResolution`: the quantization grid used for placement, snapping,
  keyboard navigation, and empty-space hit resolution.
- `InputDuration`: the duration of the event the user is about to insert.
  `InputDuration` and `RhythmicGridResolution` are independent. A quarter note
  can be inserted on a sixteenth-note grid position.
- `InsertionAnchor`: the resolved domain target for insertion, derived from a
  caret, timeline gap, selected event edge, explicit rest action, or derived-rest
  action.
- `RhythmicLayoutMap`: an adapter projection from rendered measure/staff
  geometry to rhythmic positions for each voice. It may use Verovio geometry at
  the edge, but it must not require a rendered note or `[data-class="space"]`
  element at the target position.

Required invariants:

- Empty voice insertion works when no note, rest, or Verovio space element exists
  in that voice.
- Empty-space insertion uses active voice plus rhythmic position; it must not
  infer voice from a MusicXML `<forward>` element.
- Pointer hit testing can use rendered measure/staff geometry, but the final
  editing target must be a domain caret/gap/insertion anchor.
- Moving an event to a new position changes domain event position; MusicXML
  `<forward>` and `<backup>` are recalculated by the exporter.
- UI must not expose source `divisions`, `<forward>`, `<backup>`, or XML cursor
  state as user-editable concepts.

Recommended implementation order:

1. Add pure domain/editor types and tests for `ActiveVoice`, `Caret`,
   `RhythmicGridResolution`, `InputDuration`, and `InsertionAnchor`. Done for
   the first pure model in `editor-domain/rhythmic-input.ts`.
2. Add pure snapping helpers that convert measure/grid input into legal
   rhythmic positions without reading Verovio event DOM. Done in
   `editor-domain/rhythmic-input.ts`; the helpers also keep the measure end as
   a legal caret boundary when the grid step does not divide the measure
   exactly.
3. Add `RhythmicLayoutMap` tests using synthetic measure geometry before wiring
   the preview UI. Done in `editor-domain/rhythmic-layout-map.ts`; the map uses
   rendered rhythmic anchors and interpolation so placement is not limited to a
   linear beat-only fallback.
4. Replace visual insertion placement's legacy `ScoreData` helper with a domain
   gap/caret projection when the same behavior is covered. Done for
   `editor-preview-panel.tsx` insertion target construction via
   `lib/editor/rhythmic-insert-placement.ts`; final add writes still project to
   legacy `AddLocation.tick`.
5. Add interaction coverage for inserting into an empty voice at quarter, eighth,
   and sixteenth grid positions. Started with component coverage for empty-staff
   quarter-grid preview/click placement through
   `editor-preview-panel-add-mode.test.tsx`; eighth/sixteenth and final domain
   add writes still need coverage.
6. Add triplet placement only after tuplets/time-modification semantics are
   modeled end-to-end.

#### Add mode target migration

The current add mode is a partially migrated transitional implementation:

- `editor-preview-panel.tsx` resolves the target staff/voice from the active
  track plus pointer location.
- It now calls `resolveRhythmicInsertPlacement`, which builds a
  `RhythmicLayoutMap` from rendered rhythmic anchors and measure geometry, then
  resolves a domain caret/rhythmic position before projecting that position back
  to legacy `AddLocation.tick`.
- Empty staff/voice placement no longer depends on an existing rendered
  note/rest/space element; it can use measure bounds plus rhythmic grid.
- `useEntityEditor.handleAddEntity` now accepts an explicit add-mode insert
  command. Explicit-rest add writes go through `applyAddModeDomainInsert(...)`,
  which applies the editor-domain command, exports MusicXML, reparses the result,
  and reopens the Inspector on the inserted event.
- The old `getVisualInsertPlacement` helper and beat-only
  `snapMeasureXToGridTick` fallback have been deleted after add-mode preview
  interaction coverage proved the rhythmic placement path.

Target mature add mode:

- Add mode owns explicit input state:
  - `activeVoice`;
  - `inputDuration`;
  - `rhythmicGridResolution`;
  - current `caret`;
  - optional hovered `InsertionAnchor`.
- Pointer movement over a measure/staff resolves through `RhythmicLayoutMap` to
  the nearest legal grid position for the active voice. The result drives a
  vertical caret, shadow note/rest, and musical-position tooltip.
- `inputDuration` controls what will be inserted. It must not constrain where
  the caret can land.
- `rhythmicGridResolution` controls legal placement/caret movement positions. It
  must not change the duration of inserted notes/rests.
- Empty voice insertion is generated from measure + meter + active voice + grid,
  not from existing Verovio note/space DOM elements.
- Clicking in add mode should resolve an `InsertionAnchor` and apply an explicit
  domain command:
  - insert pitched event when the active input tool contains pitch information;
  - insert explicit rest when the user explicitly chooses rest input;
  - move caret only when the user is positioning before entering pitch.
- The domain command/export path owns the write. MusicXML `<forward>` and
  `<backup>` are produced later by the exporter; the UI never edits them.

Recommended add-mode migration order:

1. Introduce pure `ActiveVoice`, `InputDuration`, `RhythmicGridResolution`,
   `Caret`, and `InsertionAnchor` types with tests. Done.
2. Add pure snapping helpers that convert measure/meter/grid input into legal
   rhythmic positions without reading Verovio event DOM. Done.
3. Add `RhythmicLayoutMap` projection tests that map legal rhythmic positions to
   rendered x coordinates using synthetic non-linear spacing. Done.
4. Replace add-mode preview location construction in
   `editor-preview-panel.tsx` with a caret/insertion-anchor result. Done:
   add-mode writes send `InsertionAnchor` plus `AddModeInsertCommand` to
   `handleAddEntity`; `AddLocation` remains only as local preview/mobile
   comparison metadata.
5. Add interaction/component coverage for the migrated preview placement before
   deleting old placement helpers. Started for empty-staff quarter-grid
   click/mousemove placement.
6. Add UI controls or state plumbing for independent `inputDuration` and
   `rhythmicGridResolution`. Done for rest `InputDuration`: `EditorStateContext`
   now owns `addModeInputDuration`, `editor-sidebar.tsx` exposes a Note Entry
   duration toolbar for whole, half, quarter, eighth, 16th, and 32nd values, and
   `editor-preview-panel.tsx` passes the selected value into explicit add-mode
   commands. Done for
   `RhythmicGridResolution`: `EditorStateContext` owns
   `addModeGridResolution`, `editor-sidebar.tsx` exposes a placement-grid
   selector, and `editor-preview-panel.tsx` passes the selected grid into
   `resolveRhythmicInsertPlacement`.
7. Replace `handleAddEntity`'s hard-coded quarter-rest insertion with explicit
   add-mode commands:
   - insert rest with selected `inputDuration` for rest input;
   - insert pitched event with selected `inputDuration` for note input;
   - move caret without writing XML when the user is only positioning.
   Done for explicit rest and first pitched note input: `handleAddEntity`
   accepts `AddModeInsertCommand`, `applyAddModeInsertCommandToDomain(...)`
   applies either `insertExplicitRest(...)` or `insertPitchedEvent(...)`, and
   `applyAddModeDomainInsert(...)` exports MusicXML from the editor-domain
   document, reparses the result, and refreshes the inserted selection. The old
   `toWritableEntityFromAddModeCommand(...) -> insertEntity(...)` add projection
   has been deleted. Rest-vs-note input is visible in the sidebar; pitched input
   now uses a first-pass pointer/staff/clef pitch resolver and updates the
   visible current pitch before insertion. The resolver is diatonic only;
   accidentals, key signatures, ledger-line range policy, and keyboard pitch
   input are not implemented yet. Caret-only positioning is not implemented yet.
8. Expand add-mode writes beyond explicit rests only after pitched input and
   caret-only positioning are modeled.
9. Delete `getVisualInsertPlacement` and beat-only `snapMeasureXToGridTick`
   fallback from add mode after equivalent caret/grid/layout-map tests and
   interactions pass. Done; `visual-insert-placement.ts` was removed and
   `measure-timeline.ts` now only keeps duration/time-signature helpers still
   used by production code.

### Phase 5: Replace Inspector and command model

1. Replace the generic `ScoreEntity Inspector` with selection-specific adapters.
2. Make pitched-event editing operate on `PitchedEvent.notes`.
3. Make adding a pitch append a `NoteAtom`; do not convert `note` to `chord`.
4. Make removing the final pitch either invalid or an explicit delete command; do not silently convert it to rest. Done for the transitional Inspector pitch-delete action.
5. Make explicit rest insertion an explicit command. Done for add-mode explicit
   rest insertion through `applyAddModeDomainInsert(...)`.
6. Make gap selection offer actions such as insert note, insert explicit rest, move caret, or adjust next event position if that product behavior is approved.

Current transitional boundary:

- `InspectorWritableEntity` remains as an Inspector-update DTO for
  `updateExistingEntity(...)`.
- Add-mode explicit rest no longer uses `InspectorWritableEntity`; it uses
  `AddModeInsertCommand` and editor-domain command/export instead.
- Matched Inspector explicit-rest duration/dotted edits no longer use
  `InspectorWritableEntity`; they use `useEditorDomainEdit` with an
  explicit-rest domain draft and MusicXML export.
7. Delete transitional writable-entity projection helpers and any pitch-count-as-entity-kind conversion once the new inspector path owns the behavior.

Current Inspector migration checkpoint:

| Inspector area | Current source | Status | Next safe action |
| --- | --- | --- | --- |
| Header event type / pitch / icon / duration | Domain Inspector projection when available, legacy parsed-event projection only when no domain projection exists | Domain-first read-side migrated | Keep legacy conversion only at unported mutation boundaries. |
| Header measure / voice metadata | Domain Inspector projection when available, legacy meta as display fallback | Read-side migrated | Add explicit staff display only if product UI needs it; otherwise keep diagnostic staff data only. |
| Pitch, accidental, fingering, duration, dotted, stem controls | Domain Inspector projection when available; legacy parsed-event projection only when no domain projection exists; migrated controls save through `useEditorDomainEdit` | Mixed: read-side migrated; core pitched/rest write slices migrated | Remove the remaining legacy write boundary after connection and beam commands are domain-backed. |
| Rhythm / dotted / stem write | `event-inspector.tsx` uses `useEditorDomainEdit` for matched pitched rhythm/dotted/stem edits and matched explicit-rest rhythm/dotted edits | Pitched and explicit-rest rhythm save paths migrated and component-tested | Keep these paths rhythm-only on the domain event draft until staff/voice/position edit semantics are explicitly modeled. |
| Beam controls | Beam direction uses domain event-notation controls and domain MusicXML export; beam relationships exist in the domain model and Inspector join/break buttons call domain relationship commands through import/export. Domain export writes explicit `beamRelationships` but no longer synthesizes automatic beam groups via legacy MusicXML helpers. | Direction and structural join/break migrated | Keep automatic beam repair outside `editor-domain`; if product wants auto-beaming for newly inserted notes, model it as an explicit domain command/projection policy instead of a hidden exporter side effect. |
| Tie / slur lists and placement controls | Tie existence now has a domain relationship schema plus MusicXML import/export; Inspector tie delete and tie placement/direction use domain relationship / `tieNotation` commands by source ids. Slur now has a domain relationship schema plus MusicXML import/export; Inspector slur delete and placement/direction use domain relationship / `slurNotation` commands by source ids. Add Tie / Add Slur and bulk Delete Tie / Delete Slur now create/delete domain relationships by MusicXML source ids and export MusicXML. Add Tie same-staff, same-pitch, and adjacent-note validation now reads domain note atoms/events instead of parsed `ScoreData` meta ticks. Connection add/delete hook inputs store source-id targets rather than parsed events or parsed event locations. `lib/editor/connection-target.ts` owns preview click selection to connection source-id target adaptation, resolving source ids from domain note-atom anchors first. Inspector connection detail lists, preview hidden-track connection pairs, and preview Delete Tie/Delete Slur availability/counts now read domain relationships. Legacy direct tie/slur XML creation, deletion, direction readers/setters, Inspector `ScoreData.connections` fallback builders, preview hidden-connection fallback, and connection hook `scoreData` dependency have been removed. | Tie/slur write paths, Add Tie validation, source-id connection add/delete hook inputs, Inspector connection details, preview visibility, preview tool read-side checks, and Inspector endpoint anchors migrated | Review whether parser/validator `ScoreData.connections` maps should remain as diagnostics or be replaced by domain validation. |
| Connection endpoint navigation | Inspector connection endpoint clicks resolve the endpoint MusicXML source id to a domain note-atom anchor and open that anchor, while attaching parsed entity context when available for transitional display compatibility. | Domain anchor navigation migrated | Remove parsed entity fallback after the whole Inspector can render/edit from domain-only anchors for every remaining control. |
| Save/delete/add entity | Legacy XML mutation helpers for parsed-location update/delete have been removed from `entity-editor`. Preview delete requires a domain anchor and uses `deleteEvent`. Inspector save either matches a supported domain draft/command or fails explicitly; it no longer falls back to `InspectorWritableEntity` / `updateExistingEntity(...)`. `useEditorDomainEdit` is consumed for matched pitched rhythm/dotted/stem edits, matched explicit-rest rhythm/dotted edits, matched fingering-only note-atom edits, matched accidental-only note-atom edits, matched pitch-only note-atom edits, matched append/remove-note-atom edits, beam-run direction edits, beam join/break edits, single tie/slur delete/placement edits, Add Tie / Add Slur creation, and bulk Delete Tie / Delete Slur. Domain delete/remove-note also cleans tie/slur relationships. | Explicit rest add, delete event, fingering, accidental, pitch name/octave, existing-pitched-event add/remove-pitch, beam direction/join/break, pitched rhythm/stem UI save slices, and tie/slur write paths migrated; legacy parsed-location XML mutation removed | Continue by removing transitional parsed selection/read DTO usage where domain view models can now stand alone. |

### Remaining pitch and chord mutation semantics

This section is the migration contract for the remaining high-risk Inspector
save paths. Do not migrate these controls only by matching the current legacy UI
shape; preserve the domain meaning below.

Current code facts:

- `event-inspector-editable-event.ts` still presents notes and chords through a
  transitional `EditableEvent` DTO with parallel `pitches`, `fingerings`, and
  `accidentals` arrays.
- `addPitch` appends a default pitch plus aligned fingering/accidental slots to
  that DTO. In the legacy XML mutation path this may turn a single-note DTO into
  a chord-shaped writable entity, but that is a UI projection detail.
- `removePitch` removes one aligned pitch/fingering/accidental slot, but returns
  the original event when only one pitch remains. The UI also disables the
  remove button for the final pitch.
- `inspector-writable-entity-validation.ts` allows partial musical fingering/accidental
  display, but requires any non-empty chord metadata arrays to be index-aligned
  with `pitches` so a shorter array cannot ambiguously target a chord member.
- The editor-domain command layer already has the desired primitives:
  `updateNoteAtom`, `addNoteAtom`, and `removeNoteAtom`. `removeNoteAtom`
  rejects removal of the final note atom with an explicit error; it does not
  silently create a rest.

Target semantics:

| User action | Domain operation | Identity rule | Notes |
| --- | --- | --- | --- |
| Change pitch name or octave of an existing note/chord member | Migrated: `updateNoteAtom` with a `pitch` patch, preserving the same `eventId` and `noteAtomId` | Retarget by the edited MusicXML source id until UI selection is domain-native | This is a pitch patch on an existing note atom, not a note-to-chord or chord-to-note conversion. |
| Change accidental of an existing note/chord member | Already migrated: `updateNoteAtom` with combined `pitch + accidental` patch | Retarget by the edited MusicXML source id | The UI accidental button intentionally updates both pitch alter and displayed accidental. |
| Change fingering of an existing note/chord member | Already migrated: `updateNoteAtom` with a `fingering` patch | Retarget by the edited MusicXML source id | `none` maps to an omitted domain fingering. |
| Add a pitch to an explicit rest | Do not treat as a rest mutation. Use an explicit replace/create decision after product semantics are chosen | New event/note identity must be generated deliberately | This is not yet safe to migrate because it crosses explicit-rest vs pitched-event identity. |
| Add a pitch to an existing pitched event | `addNoteAtom` on the existing `PitchedEvent` | Preserve the event id; generate a new stable note-atom id and MusicXML source id | This is append-note-atom semantics. The UI may display the result as a chord, but the domain event kind remains pitched. |
| Remove a pitch from a multi-note pitched event | `removeNoteAtom` on the selected note atom | Preserve the event id and all remaining note-atom ids/source ids | This is remove-note-atom semantics. The UI may display the result as a single note, but the domain event kind remains pitched. |
| Remove the final pitch from a pitched event | Invalid from the pitch-row control; offer explicit delete-event or replace-with-explicit-rest commands separately if product wants them | No implicit identity rewrite | The final-pitch remove button must stay disabled unless the UX changes to an explicit named command. |
| Convert pitched event to explicit rest | Explicit replace/delete-and-insert command, not an accidental side effect of pitch count | Product decision required for event id/source id continuity | Do not restore the old “zero pitches means rest” behavior. |

Recommended migration order for these controls:

1. Migrate pitch name/octave for one existing note atom using the same
   source-id retargeting bridge as accidental and fingering. Done.
2. Add component interaction coverage for single-note and chord-member pitch
   patches, proving source-id reselection and stable remaining chord members.
   Done.
3. Add a small id-generation policy for new note atoms before migrating
   add-pitch. Done: an appended member receives one legal, document-unique id
   derived from the chord root (`<root>-chord-<member-number>`, then `-2`,
   `-3`, … on collision). That value is both the domain `NoteAtomId` and the
   exported MusicXML source id, so export/re-import restores the same note atom
   and render anchor without an alias map.
4. Migrate add-pitch for existing pitched events through `addNoteAtom`. Done:
   the Inspector's Add pitch control now issues an `appendNoteAtom` domain
   command, which allocates its identity inside the imported domain document
   and preserves the current source-id selection.
5. Migrate remove-pitch for multi-note pitched events through `removeNoteAtom`.
   Done: the Inspector resolves the note atom from its matched domain view model
   and issues `removeNoteAtom`; it does not derive a replacement rest.
6. Keep final-pitch removal disabled. If product wants this behavior later, add
   a separate delete-event or replace-with-explicit-rest action with explicit UI
   copy and command coverage.
7. Only after the above is stable, delete the transitional pitch-count-based
   `InspectorWritableEntity` projection path for these controls.

Non-goals for this migration:

- Do not reintroduce `Blank` or `<forward>` as an editable score entity.
- Do not let zero pitches imply a rest.
- Do not use shorter chord fingering/accidental arrays to imply positional
  targeting.
- Do not preserve legacy note/chord DTO names as compatibility aliases once the
  domain Inspector path owns the behavior.

### Phase 6: Remove legacy parsed event variants and UI DTO leakage

1. Remove `Blank` and `ScoreEntityType = 'blank'`. Done.
2. Merge `Note` and `Chord` into `PitchedEvent`.
3. Rename `Voice.notes` to `Voice.events`. Done for the transitional
   `ScoreData` model.
4. Remove parser/core grouping rules that expose `forward` as a UI entity. Done
   for default grouping; timing adapters can explicitly include forward groups.
5. Remove tests that assert `blank` is editable; replace them with gap/caret selection tests. Done for legacy blank edit expectations.
6. Remove old XML mutation helpers that directly insert or update `ScoreEntity`.

### Phase 7: Rewire downstream projections

1. Update measure duration/status utilities to read `Voice.events` and derived gaps.
2. Update tie, slur, beam, and fingering logic to anchor to event/note ids.
   Notation controls should use the notation layer instead of direct MusicXML
   mutation once the command/exporter path owns current behavior.
3. Update playback and practice projections to consume the domain model or a projection from it, rather than reparsing editor-specific MusicXML entities.
4. Update save/export flow so `ScoreRevision` clearly distinguishes canonical editor content from imported/exported MusicXML artifacts if the product chooses to make NoteVerse JSON canonical.

## Acceptance criteria

- No production source type named `Blank` remains in Customer Web editor code.
- No `ScoreEntityType` union contains `'blank'`.
- No parser code creates a persisted editor event from MusicXML `<forward>`.
- MusicXML import/export tests prove `<forward>` and `<backup>` are adapter cursor operations.
- UI can still insert music into empty rhythmic positions.
- Empty voice insertion can target legal rhythmic positions without relying on
  an existing rendered note, rest, or Verovio space DOM element.
- `InputDuration` and `RhythmicGridResolution` are independent and tested.
- At least quarter, eighth, and sixteenth grid insertion positions are covered
  before replacing the current empty-space insertion UI path.
- Moving event position is represented as a domain position change, and the
  MusicXML exporter recalculates required `<forward>` / `<backup>` instructions.
- User-facing editor UI does not expose source `divisions`, `<forward>`,
  `<backup>`, or XML cursor state.
- UI can still represent implicit rests or empty voice spans, but they are derived selections/projections rather than stored events.
- Note and chord editing share one `PitchedEvent` command path.
- Removing the last pitch does not silently become rest.
- Explicit rest creation is a named command.
- Verovio hit mapping resolves render elements to domain anchors.
- Customer Web lint, typecheck, unit tests, and relevant editor integration tests pass.

## Recommended next implementation task

Continue by building the missing domain-native selection/input concepts:

1. Decide how active insertion anchors become persistent selections outside
   add-mode hover/preview, especially whether timeline-gap selection should
   open a gap Inspector or stay command-only until materialization UI exists.
2. Add pitched add-mode commands on top of the current rhythmic insert
   placement path.
3. Replace remaining `verovio-geometry` consumers with render-anchor/domain
   anchor projections where that improves semantics without hiding simple DOM
   geometry behind over-abstracted layers.
7. Move the remaining legacy XML mutation helpers behind the editor-domain
   command/exporter pipeline when that pipeline can preserve current behavior.
8. Delete temporary bridge helpers once the React Inspector and XML mutation
   path use the editor-domain command/exporter pipeline directly.
