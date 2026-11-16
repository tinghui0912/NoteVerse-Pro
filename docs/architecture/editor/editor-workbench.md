# Editor Workbench

The Customer Web editor combines the workbench toolbar, Voice Layer, score
preview, Event Inspector and player. `components/editor/editor-workbench.tsx`
composes the surface; responsive tool sheets expose the same editor state on
small screens.

## Selection and input

Editor selection uses domain anchors for events, note atoms, notation and
musical positions. Render/source IDs are adapter lookup keys. They do not own
musical identity. Inspector drafts are derived from the current domain document.

Voice Layer owns active-voice selection, visibility and color, with guarded
voice add/delete operations. Active voice, caret position, grid resolution,
input duration and insertion preview are separate state. Preview hover does not
replace Inspector selection. Add mode resolves a domain insertion anchor from
measure/staff geometry, not from a rendered space element.

Pitched and explicit-rest entry share rational rhythmic placement. Pitched
preview uses staff/clef mapping, open or filled ghost noteheads and ledger lines.
The preview is cleared when the tool changes, the pointer leaves, escape is
pressed or insertion commits. Advanced spelling and preview capabilities must
follow their supported source/test contracts; a ghost is not a complete engraving.

## Editing and persistence

Event Inspector edits pitched events and explicit rests through domain drafts
and commands, including note atoms and supported stem, beam, tie and slur
notation controls. A pitched event has one or more note atoms; removing its
last pitch does not silently create an explicit rest. Deleting an event creates
empty musical time. Explicit-rest creation is a separate operation.

Editor hooks import MusicXML with its source snapshot, apply domain commands,
and serialize the edited document against that snapshot before refreshing
read/render projections. Save submits `expected_head_revision_id` for optimistic head conflict detection.
The loaded snapshot fixes the document baseline; a refreshed Score query cannot replace
that concurrency expectation. Local drafts use `baselineRevisionId` to identify this
baseline. History owns undo/redo snapshots, and original-document navigation is separate from unsaved
editing state. The player consumes the workbench playback state rather than
owning score writes.

## Adapter boundary

`ParsedScoreEvent` and `ScoreData` provide parser/render lookup projections used
by preview geometry and source-ID reselection. `editor-domain` owns pure editing
semantics and source-anchor abstractions, independent of XML, UI and React.
`editor-musicxml` owns parsing, import, source preservation and serialization.
Its opaque source snapshot preserves unmodeled MusicXML, including document
metadata, key/clef attributes, directions, lyrics, repeats and print layout; it
is not a second semantic model. Supported edits change modeled intent in a
fresh source clone. Unsafe input or edits fail explicitly, without guessed
meter, divisions, duration or pitch. Inherited MusicXML attributes are resolved
from source context, and omitted optional meter stays absent. Verovio `space` elements are
excluded from ordinary editable hits. See [Editor Domain Model](../../adr/0007-editor-domain-model.md)
and [Automatic Beaming](automatic-beaming.md).

UI, domain-command, rhythmic-placement and MusicXML round-trip tests jointly
define the current behavior; component names alone are not a contract.
