# Editor Workbench Migration Plan

## Goal

Replace the current card-based editor with a focused workbench:

```text
Toolbar
+ Left rail: Tools + Voice Layer
+ Center: Verovio Score Area
+ Right: Event Inspector
+ Bottom: Player
```

The user should explicitly manage voices, but should not manage MusicXML implementation details such as `forward`, `backup`, or beam rebuilding. The UI edits musical events; MusicXML remains the persistence format.

Clarified final target:

- The final editor center should be one primary Verovio score area, not a permanent split between a card/timeline editor and a preview tab.
- Users should click notes/chords/rests in the Verovio SVG score and edit the selected event in the right `EventInspector`.
- The current timeline/card-like editor is a migration bridge until SVG entity selection and insertion are reliable.
- Keep the left toolbar `Add Tie` and `Add Slur` tools. Their interaction remains tool-first: activate the tool, then click the start and end events. The Inspector can show/delete connection state, but it should not replace that creation flow unless explicitly redesigned later.

## Non-Goals

- Do not rewrite the MusicXML parser from scratch.
- Do not change the backend contract in this migration.
- Do not expose `forward` / `backup` as user-facing concepts.
- Do not let the Inspector change an event's voice.
- Do not keep manual beam add/delete tools. Beam is automatic.

## Original State

- The editor page renders `CardBasedEditor`, `EditorSidebar`, `ScoreInfoCard`, and edit modals from `frontend/src/app/[locale]/editor/[id]/page.tsx`.
- `CardBasedEditor` renders `Measure -> Staff -> Voice -> Entity Card`.
- `EditorStateContext` still contains card/modal-oriented state such as `editingEntity`, `currentAddLocation`, `pendingInsert`, and `isAddEntityModalOpen`.
- Insert currently uses `entityIndex + before/after` via `insertEntity`.
- Existing `ScoreEntity.meta.startTick` already gives us the key primitive needed for a timeline-based insert model.
- Automatic beam rebuilding exists in `frontend/src/lib/musicxml/automatic-beams.ts` and should stay part of every MusicXML mutation.

## Target Model

### EditorTrack

UI-level representation of a staff voice:

```ts
{
  id: "staff-1-voice-2",
  staffIndex: 0,
  xmlVoice: 2,
  label: "Voice 2",
  color: "#16a34a",
  visible: true
}
```

This is a view model only. Internally, MusicXML remains `Measure -> Staff -> Voice -> Event`.

### EditableEvent

Unified event representation:

```ts
{
  duration: "durationQuarter",
  dotted: false,
  pitches: [],
  stemDirection: "none",
  fingerings: []
}
```

Rules:

```text
pitches.length === 0  => Rest
pitches.length === 1  => Note
pitches.length >= 2   => Chord
```

The Inspector should only add/delete pitches. There should be no `Convert to Rest`, `Convert to Note`, or `Convert to Chord` actions.

### MeasureTimeline

The insertion layer uses measure-level anchors:

```ts
{
  measureIndex: 0,
  staveIndex: 0,
  anchors: [
    { tick: 0 },
    { tick: 4 },
    { tick: 8 }
  ]
}
```

Desktop add mode shows exactly one insertion line near the closest anchor. Mobile uses tap once to position, then a bottom action sheet to confirm.

## Migration Phases

### Phase 1: Foundation

- Add pure view-model utilities:
  - `frontend/src/lib/editor/tracks.ts`
  - `frontend/src/lib/editor/editable-event.ts`
  - `frontend/src/lib/editor/measure-timeline.ts`
- Keep the old card editor running.
- Add tests for view-model behavior.

Status: done. `tracks`, `editable-event`, and `measure-timeline` now exist under `frontend/src/lib/editor`, with unit coverage. The temporary `insert-location` bridge was removed after tick handling moved into `insertEntity`.

### Phase 2: Editor State

Editor state should keep only state that is actively consumed by the current workbench:

- `activeTrackId`
- `visibleTrackIds`
- `inspectorOpen`

Status: done for the current workbench boundary. Add modal state and unused migration placeholders (`editorView`, `workbenchTool`, `selectedEntityLocation`, `insertAnchor`) have been removed. Active track, visible tracks, selected editing entity, pending insert, and inspector state remain because they are consumed by the active workbench flow.

### Phase 3: Workbench Shell

Introduce new components:

- `EditorWorkbench`
- `EditorToolbar`
- `EditorLeftRail`
- `VoiceLayer`
- `EditorPreviewPanel` as the primary score editing surface
- `EventInspector`
- `EditorBottomPlayer`

The page should render the new shell behind a clear boundary while old card-based components are still available for rollback during migration.

Status: done for the current migration boundary. `EditorWorkbench` now owns the desktop left rail, center `EditorWorkbenchCenter`, and right `EventInspector`, so the route page is no longer responsible for assembling the three-column editor surface. `VoiceLayer`, the Verovio score editing surface, and `EventInspector` are mounted in that shell. The mobile left rail lives in `EditorMobileToolSheet`, save/undo/redo/original-score actions live in `EditorToolbar`, and editor playback controls live behind `EditorBottomPlayer`.

Manual beam tools, legacy note/chord/add modals, the old card editor surface, and the temporary timeline editor surface have been removed.

### Phase 4: Voice Layer

Voice Layer owns:

- current voice
- add voice
- delete voice
- voice visibility
- voice color

Inspector does not change voice. New events always insert into the active voice.

Status: in progress. Voice Layer derives tracks, supports active/visible voices, and visible voices filter the current editor UI without changing XML. Add Voice now creates an empty UI track for the active staff, and Delete Voice removes either the empty UI track or the matching staff/voice content across the current XML. Deletion is disabled for the last remaining voice in a staff.

### Phase 5: Timeline Insert

Replace index-based insertion with tick-based insertion:

```ts
insertEntityAtTick({
  measureIndex,
  staveIndex,
  xmlVoice,
  tick,
  event
})
```

Rules:

- Empty Voice 1 in an empty measure uses `tick = 0`.
- Empty Voice 2 can use Voice 1 anchors for positioning, but writes to Voice 2.
- Visibility never changes MusicXML.
- Every mutation recalculates backups and automatic beams.

Status: Verovio tool layer started. Add mode is exposed as `add` in editor state, while the XML layer performs insertion by `tick`. Insert locations carry `tick`; `insertEntity` computes the insertion index from `scoreData + tick`, and empty-voice insertion writes `backup` / `forward` so the new event lands at the requested tick. Saving or canceling a pending insert clears the pending ref and returns the tool to select mode. The old index-based `LegacyInsertLocation` compatibility path has been removed; `AddLocation` is now tick-only. The temporary timeline UI that previously hosted insertion anchors has been removed. The Verovio surface now has an Add Mode MVP: hover over a rendered event shows one blue insertion caret, and click inserts at that event's start/end tick depending on the pointer side. Hovering/clicking measure whitespace snaps to the nearest beat-grid tick derived from the time signature and divisions, so empty measures and sparse measures have measure-level insertion targets beyond only `tick = 0`. Insert target voice comes from the active Voice Layer track.

Mobile Add Mode now uses a first-pass tap-to-position flow: the first tap sets the blue insertion caret and stores the target `AddLocation`; tapping the same target again or pressing the bottom `Insert here` confirmation opens the Inspector for an empty-pitch rest event. The bottom confirmation also provides an explicit cancel action.

The insertion caret now uses the active Voice Layer track to choose its vertical staff anchor inside the rendered Verovio measure. In multi-staff systems, the x position still comes from the event boundary or snapped measure grid, while the caret height/top come from the active staff instead of the whole measure.

Remaining: support finer-than-beat grid options when needed, and decide whether mobile should offer explicit `Rest / Note / Chord` shortcuts or stay aligned with the unified event model by inserting an empty-pitch rest and letting the Inspector add pitches.

`insertEntity` has been split into element creation and insertion helpers. The temporary `insert-location` bridge has been removed.

`AddLocation` is now `TimelineInsertLocation`: `measureIndex`, `staveIndex`, `xmlVoice`, `tick`.

### Phase 6: Event Inspector

Replace Note/Chord/Rest modals with one Event Inspector:

```text
Pitches
  C4  delete
  E4  delete
+ Add Pitch

Duration
Stem
Fingering
Tie
Slur
```

The XML writer infers rest/note/chord from pitch count.

Status: in progress. Existing event selection and new insert flow now open `EventInspector`. New inserts start as empty-pitch rest events and become notes/chords by adding pitches. New dotted rests now write `<dot>`, and events converted back to rests remove note-only XML such as stem/fingering notation. The Inspector now shows tie/slur connection counts and can delete existing tie/slur connections for the selected event. When no event is selected, the same right panel becomes a score-level inspector for main title, subtitle, composer, lyricist, copyright, time signature, key signature, and tempo. The legacy add, note, and chord editor modals have been removed.

Remaining: tie/slur creation intentionally stays in the left toolbar selection tools. Keep the canvas-tool creation flow while the Inspector owns event details, score metadata, and existing connection deletion.

### Phase 7: Preview and Player

- Use one Verovio score surface in the center work area.
- The same surface is both preview and editor target.
- Bottom player uses the current XML and should not require opening a modal.

Status: in progress. `EditorWorkbenchCenter` now renders `EditorPreviewPanel` directly as the primary center surface; there are no `Editor | Preview` tabs and no separate preview action. `EditorPreviewPanel` composes the Verovio viewport with `EditorBottomPlayer` against the current XML. Playback controls are embedded at the bottom of the score panel; a global bottom dock can still be extracted later if playback must remain visible while editing.

### Phase 7.5: Verovio Score Editing

- Replace the migration timeline/card-like editor surface with a single Verovio score editing surface.
- Preserve stable MusicXML note ids so Verovio SVG elements can map back to `ScoreEntity`.
- Clicking a Verovio SVG note/chord/rest should select the matching event and open `EventInspector`.
- Add mode should eventually project insertion anchors on top of the Verovio score rather than the timeline row.

Status: foundation in progress. `MusicXMLParser` now preserves namespace-aware `xml:id` / `id` as `ScoreEntity.meta.id` before falling back to generated ids. `stable-ids` ensures editable `note` / `forward` elements have legal unique `xml:id` values, preserving source ids when possible and writing app-owned `nv-...` ids for missing, invalid, or duplicate anchors. Initial document load, draft recovery, merge/flatten, generic XML updates, inserts, and event updates now normalize ids before parsing/saving. `verovio-entity-map` provides pure helpers to extract a Verovio SVG element id from a DOM target and map that id back to a `ScoreEntity` + `EntityLocation`.

Verovio SVG click handling is now wired in the editor preview panel: `ScorePreviewViewport` exposes an optional `onScoreClick`, `EditorPreviewPanel` maps the clicked Verovio `data-id` / `id` back to `ScoreEntity`, and opens `EventInspector`. Chord member note ids are preserved in `EntityMeta.sourceIds`, so clicking any rendered chord tone can select the parent chord event.

The Verovio surface has been promoted from a preview tab into the primary editor area. The temporary timeline editor components, timeline event cards, insertion caret, score info card, center tab state, and live-preview toolbar action have been removed.

The Verovio score click layer now dispatches editor tools: select opens `EventInspector`, delete removes the event, Add Mode opens a pending insert at the clicked event boundary, and add/delete tie/slur reuse the existing connection operations. Tie/slur creation tools therefore target the same Verovio click layer as selection. Verovio requires ordinary MusicXML `id` attributes to emit matching SVG `data-id` values, so `stable-ids` writes both `xml:id` and `id`, and the Verovio adapter normalizes ids before rendering.

The selected event is reflected back onto the Verovio SVG through a `score-editor-selected` class. Chord selection highlights every rendered note whose XML id appears in the event's `sourceIds`. Escape cancels active Verovio tool modes (`add`, `delete`, tie/slur add/delete) without interrupting text inputs in the Inspector.

Remaining: strengthen the Verovio insertion overlay with finer grid options.

### Phase 8: Remove Card Editor

After the workbench owns selection, insert, update, delete, undo/redo, autosave, validation, and playback:

- Stop importing `CardBasedEditor`.
- Remove note/chord/rest card editing components.
- Remove add entity modal.
- Remove note/chord edit modals.
- Remove old card insertion affordances.
- Remove manual beam handlers and messages.

Status: code cleanup done. Add entity modal, note editor modal, chord editor modal, manual beam handlers, manual beam messages, card editor components, timeline presentation helpers, and unused articulation icon wrappers have been removed.

## QA Checklist

- Insert into empty Voice 1.
- Insert into empty Voice 2 using Voice 1 anchors.
- Add pitch to rest -> note.
- Add second pitch to note -> chord.
- Delete last pitch -> rest.
- Active voice controls insert target.
- Hidden voice is hidden only in UI.
- Delete voice modifies XML.
- Tie/slur still work.
- Beam rebuilds automatically after insert/update/delete.
- Undo/redo restores XML and parsed score.
- Autosave still writes drafts.
- Save validation still runs before navigation.
