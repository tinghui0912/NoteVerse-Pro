# ADR 0007: Editor Domain and Adapter Boundaries

Status: Accepted

## Context

Musical identity, notation intent, source preservation and renderer geometry are
separate concerns. The Customer Web Editor edits a semantic document and derives
MusicXML for interchange and rendering.

## Decision

`apps/customer-web/src/lib/editor-domain` owns the single editing semantic model,
`ScoreDocument`: document metadata, parts, staves, explicitly numbered voices,
measure attribute changes, rational musical positions, events, note atoms and
notation intent. Effective meter, key and staff clef inherit within each part.
Unknown context remains unknown; context-dependent input is disabled or rejected
when the required facts are unavailable. Domain modules depend only on domain-local
modules.

A pitched event contains one or more note atoms; a chord is one rhythmic event.
Explicit rests are musical events. Gaps are derived from events and effective
meter. Tie, slur and beam relationships are distinct from stem and relationship
placement overrides. Meter commands recompute automatic beam intent within the
changed meter's inheritance scope. Renderer geometry is never persisted as music.

`EditorSession`, exposed through `EditorSessionProvider`, atomically owns the
current document, opaque `MusicXmlSourceSnapshot`, derived timeline gaps and
serialized MusicXML projection. It accepts explicit load, domain command, external
replacement, undo/redo and clear operations. Commands run against the current
semantic snapshot. Failed commands and serialization leave the accepted session
and history unchanged. Published documents are immutable.

`apps/customer-web/src/lib/editor-musicxml` owns import, source preservation and
serialization. The opaque snapshot holds source XML and source addresses. It does
not contain a second note, voice or score model and does not answer domain queries.
The serializer applies document intent to a fresh source clone, preserving unrelated
metadata, lyrics, directions, attributes and layout. Metadata credits and MusicXML
child ordering are adapter responsibilities. Unsupported or unsafe interpretation
and serialization fail explicitly, without guessed musical defaults.

## Current boundaries

Import occurs at document load, draft restore and trusted full-document replacement.
Ordinary reads, edits, undo and redo do not re-import MusicXML. History stores
semantic document/source snapshots and action labels. Restoring history regenerates
the XML projection from the restored snapshot.

Serialized XML is used for Verovio rendering, validation, revision save, draft
persistence, download and external full-document services such as fingering. A
returned full document is validated/imported and enters history atomically with
its own source snapshot. IndexedDB drafts persist MusicXML and baseline revision
identity; draft recovery imports that interchange data into the session.

Tracks, metadata placeholders, connection details, selection and rhythmic placement
read the domain document. Render/source anchors join semantic identity to SVG hits.
SVG geometry and visibility are UI projections, not score models. Verovio spaces
are excluded from ordinary editable event hits.

An empty Voice Layer entry is a session input target. It becomes a musical voice
when the first event is inserted. It does not create an empty-voice declaration or
require a parser restoration mechanism. Deleting a musical voice removes its
events and touching relationships through a domain command.

Selection, active voice, caret, grid, input duration and insertion preview remain
separate UI concepts. Removing the last pitch does not silently create an explicit
rest. Event deletion and explicit-rest creation are separate commands.

## Invariants

There is one semantic document authority, one opaque source-preservation authority,
one MusicXML adapter and one session owner. Domain, adapter, session and component
behavior tests enforce those boundaries. UI read projections cannot authorize
independent MusicXML writes.

See [Editor Workbench](../architecture/editor/editor-workbench.md) and
[Automatic Beaming](../architecture/editor/automatic-beaming.md).
