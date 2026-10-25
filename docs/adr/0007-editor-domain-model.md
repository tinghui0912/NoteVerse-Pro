# ADR 0007: Editor Domain and Adapter Boundaries

Status: Accepted

## Context

Musical identity, notation intent and renderer geometry are different concerns.
The Customer Web editor must edit musical objects while preserving MusicXML
interchange and Verovio rendering fidelity.

## Decision

`apps/customer-web/src/lib/editor-domain` owns branded document/part/staff/voice,
event and note-atom identities, rational musical positions and rhythmic values.
A pitched event contains one or more note atoms; a chord is one rhythmic event.
An explicit rest is persisted. Gaps and derived rests are computed from voice
events and meter rather than stored as ordinary voice events.

Tie, slur and beam relationships are distinct from explicit notation overrides.
Stem direction and relationship placement are notation intent. Renderer-computed
beam slopes, notehead offsets and curves are engraving output and are not written
back as canonical musical facts.

MusicXML importer/exporter owns document-order cursor movement, divisions,
forward/backup instructions and chord serialization. Voice identity is not the
XML serialization cursor. Verovio IDs map through render/source anchors to
domain anchors; rendered spaces are excluded from ordinary editable event hits.

## Current write and read boundaries

Domain commands and Inspector drafts operate on the domain document. Editor
hooks export MusicXML, update history and refresh projections. A behavior has
one authoritative write path; adapters must not perform competing writes and
merge them afterward.

`ParsedScoreEvent` and `ScoreData` are adapter/read models used by parser output,
preview geometry and source-ID lookup/reselection. They coexist with the domain
document for those current responsibilities; they do not define command identity.
Connection navigation resolves domain note-atom anchors through source IDs.

Selection, active voice, caret, rhythmic grid, input duration and insertion
preview are distinct concepts. Empty time is addressed by caret/gap anchors,
not by MusicXML cursor instructions. Removing the last pitch does not create
an explicit rest; deleting an event and creating a rest are separate commands.

## Invariants and consequences

Domain types do not import UI or MusicXML adapter models. Invariant, command,
selection, source-anchor, notation and MusicXML round-trip tests define these
boundaries. Unsupported notation must be preserved or rejected explicitly rather
than silently reinterpreted. UI projections do not authorize a second write model.

See [Editor Workbench](../architecture/editor/editor-workbench.md) and
[Automatic Beaming](../architecture/editor/automatic-beaming.md).
