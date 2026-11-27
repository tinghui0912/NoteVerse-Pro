# Editor Workbench

The Customer Web workbench composes the toolbar, Voice Layer, score preview,
Event Inspector, score metadata inspector and player. Responsive tool sheets
expose the same session and input state.

## Session and editing

`EditorSessionProvider` owns an atomic document/source pair and a derived
`serializedXml` projection. `ScoreDocument` is the only editing semantic authority.
`editor-domain` owns commands, metadata, measure context, rhythm, relationships and
notation intent. `editor-musicxml` owns source import, opaque preservation and
serialization. Unmodeled source content is preserved data, not another score model.

Metadata inputs commit typed commands for notation title, subtitle, composer,
lyricist, copyright, key, meter and tempo notation. The adapter writes structural
metadata and typed credits with their layout. A notation title is independent of
the Score resource's display title. Tempo suggestions in the UI do not establish
a tempo fact until the user commits a command.

Effective meter, key and staff clef derive from each part's measure attribute
changes. Rhythmic insertion requires a known measure duration. Pointer pitch input
requires a supported effective clef. Missing context disables that operation; it
does not establish a default meter, key or clef. Meter changes recompute beam intent
from domain events, positions and voices in the affected inheritance scope.

Pitched events and explicit rests are distinct. A chord is one event with multiple
note atoms. Removing the last pitch does not create a rest; deleting an event makes
empty musical time. Tie, slur, beam and stem edits use domain commands. Serialization
preserves unrelated MusicXML and fails explicitly when an edit cannot be expressed
safely in its source context.

## Voice Layer and preview

Tracks derive from domain voices and events. Voice identity and its numeric
property are separate facts. Adding an empty track creates a session input target;
first insertion materializes its musical voice. Deleting a musical voice also
removes its events and touching relationships.

Selection uses domain event/note/notation anchors. SVG/source IDs connect render
hits to those identities. Track visibility, hidden staff state, connection details,
metadata placeholders and rhythmic placement all derive from the document. Verovio
SVG interaction provides geometry and presentation only. Rendered spaces are not
ordinary editable events.

Active voice, caret, rhythmic grid, input duration and hover preview are separate
input state. Supported clef context determines pitched preview and ledger lines.
Preview clears on tool change, pointer exit, escape or successful insertion.

## History and interchange

History stores immutable semantic document/source snapshots and action labels.
Undo/redo restores a semantic snapshot and regenerates the MusicXML projection;
it does not parse XML to recover editing state.

Initial load and draft recovery import MusicXML into a coherent session. Trusted
full-document services use an explicit replacement operation that imports the
returned XML and atomically appends its document/source pair to history. Invalid
replacements do not change the accepted session.

Serialized MusicXML serves Verovio, validation, save requests, downloads, IndexedDB
drafts and full-document services. It does not supply metadata, voice, selection or
timing state. Drafts retain `baselineRevisionId`; save submits the loaded
`expected_head_revision_id`. A refreshed Score query does not change that baseline.
The player consumes the XML rendering/playback projection and does not own edits.

See [Editor Domain Model](../../adr/0007-editor-domain-model.md) and
[Automatic Beaming](automatic-beaming.md).
