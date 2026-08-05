# Editor Workbench Migration Plan

## Current Goal

The editor has moved from a card-based editing surface to a focused Verovio score workbench:

```text
Toolbar
+ Left rail: Tools + Voice Layer
+ Center: Verovio Score Area
+ Right: Score/Event Inspector
+ Bottom: Player
```

The user edits musical events directly from the rendered score. MusicXML remains the persistence format, but implementation details such as `forward`, `backup`, stable XML ids, and automatic beam rebuilding stay internal.

## Product Rules

- The center work area is a single Verovio score surface.
- Clicking score notes/chords/rests opens the right Event Inspector.
- Clicking score title/composer/copyright text opens the score-level inspector.
- The Inspector edits the selected event immediately; it does not require local Cancel/Save buttons.
- Page-level Save still submits the whole edited MusicXML revision.
- Voice selection lives in the left Voice Layer, not in the Inspector.
- New events insert into the active Voice Layer track.
- Confirming an insertion writes an empty-pitch rest immediately, then opens the Inspector.
- Tie and slur creation stays tool-first: activate the left tool, then click start and end events.
- Beam is automatic; users do not manually add/delete beam.
- The "Simplify Voices" tool normalizes all voices within each staff to `voice=1` while preserving `staff`.

## Implemented State

### Workbench Shell

Status: done.

- `EditorWorkbench` owns the desktop left rail, center work area, and right Inspector.
- `EditorWorkbenchCenter` renders `EditorPreviewPanel` directly; there are no editor/preview tabs.
- `EditorMobileToolSheet` provides the mobile left rail.
- `EditorToolbar` owns page-level save/undo/redo/original-score controls.
- `EditorBottomPlayer` is embedded in the score panel.
- Old card editor surfaces, timeline presentation components, note/chord/add modals, manual beam tools, and card insertion affordances have been removed.

### Voice Layer

Status: implemented, needs focused QA.

- Voice Layer derives visible staff voices from parsed score data.
- It owns active voice, visible voices, voice color, add voice, delete voice, and simplify voices.
- Hidden voices are hidden in the editor UI without mutating MusicXML.
- Delete Voice mutates MusicXML when deleting a real voice and removes only UI state for empty temporary voices.
- Delete Voice is disabled for the last remaining voice in a staff.

### Verovio Score Editing

Status: implemented, needs focused QA around insertion edge cases.

- Stable MusicXML ids are normalized before parsing/rendering.
- Verovio SVG ids map back to `ScoreEntity` and `EntityLocation`.
- Clicking a rendered event opens `EventInspector`.
- Chords preserve member XML ids in `EntityMeta.sourceIds`.
- Selected events are reflected back onto SVG with `score-editor-selected`.
- The Verovio click layer dispatches select, delete, add, add tie, add slur, delete tie, and delete slur tools.
- Escape cancels active tool modes without interrupting text inputs.

### Insert Flow

Status: implemented, with one optional enhancement remaining.

- Add Mode uses one blue insertion caret.
- Desktop hover/click computes insertion from rendered event boundaries or beat-grid measure whitespace.
- Mobile uses tap-to-position, then `Insert here` confirmation.
- Confirmed insertion immediately writes a rest event; adding pitches in the Inspector turns it into a note/chord.
- `AddLocation` is tick-based: `measureIndex`, `staveIndex`, `xmlVoice`, `tick`.
- `insertEntity` writes by tick and handles empty voices with internal `backup` / `forward`.
- Every insert/update/delete recalculates backups and rebuilds automatic beams.

Remaining optional enhancement:

- Add finer-than-beat grid choices if real editing sessions show that beat-grid insertion is too coarse.

### Event Inspector

Status: implemented.

- The Inspector uses one `EditableEvent` model.
- `pitches.length === 0` is rest.
- `pitches.length === 1` is note.
- `pitches.length >= 2` is chord.
- Users add/delete pitches instead of converting between rest/note/chord types.
- Pitch, duration, dotted, fingering, and stem direction update immediately.
- Tie and slur details live in collapsible panels.
- Tie/slur direction updates immediately.
- Connection endpoints are clickable and switch the Inspector to the target event.
- Chord-member-level tie/slur targeting is supported for XML writes and connection parsing.
- Score-level metadata lives in the same right panel when no event is selected.

### Preview and Player

Status: implemented.

- The Verovio surface is both the preview and the editor target.
- Playback controls use the current XML.
- The cursor is hidden by default and appears during playback.

Potential future UX decision:

- Decide whether the player should become a global bottom dock that remains visible while scrolling.

### Simplify Voices

Status: implemented.

- UI label: `Simplify Voices` / `简化声部`.
- Code operation: `normalizeVoices`.
- MusicXML transform: `normalizeMeasureVoices`.
- Rule:

```text
staff 1 voices -> voice 1
staff 2 voices -> voice 1
```

`staff` remains the source of treble/bass staff separation.

## Removed Legacy Code

- Card editor components.
- Timeline presentation components.
- Add entity modal.
- Note editor modal.
- Chord editor modal.
- Manual beam add/delete handlers and messages.
- Bottom sheet card editing interactions.
- Card hover context.
- Legacy timeline anchor view-model helpers.
- Card-oriented `cardType*` translation keys.

## Remaining Work

### Required

- Run the QA checklist below on representative MusicXML files.
- Fix any insertion, voice visibility, connection, playback, undo/redo, autosave, or validation bugs found during QA.

### Optional

- Add finer insertion grid controls.
- Promote the embedded player to a global bottom dock.
- Rename `apps/customer-web/src/lib/musicxml/flatten.ts` to a more accurate filename such as `normalize-voices.ts`.
- Consider whether endpoint switching should eventually focus a specific chord member inside the Inspector instead of only opening the parent chord event.

## QA Checklist

- Insert into an empty Voice 1.
- Insert into an empty Voice 2.
- Insert into treble staff and bass staff in the same measure.
- Insert in measure whitespace at the start, middle, and end of a measure.
- Add pitch to rest -> note.
- Add second pitch to note -> chord.
- Delete last pitch -> rest.
- Change pitch, duration, dotted, fingering, and stem direction and confirm immediate Verovio refresh.
- Active voice controls insert target.
- Hidden voice is hidden only in UI.
- Hidden voice hides noteheads, stems, dots, ledger lines, ties, and slurs.
- Delete voice modifies XML when expected.
- Add/delete tie works.
- Add/delete slur works.
- Chord-member-level tie/slur works.
- Tie/slur direction changes work.
- Beam rebuilds automatically after insert/update/delete.
- Undo/redo restores XML and parsed score.
- Autosave still writes drafts.
- Page-level Save still runs validation before navigation.
- Playback cursor starts hidden, appears during playback, and hides after stop.
