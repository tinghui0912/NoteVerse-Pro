# Automatic Beaming

Automatic beaming is notation policy applied to rhythmic edits. Ordinary score
entry does not require a beam-management mode. The implementation is
`apps/customer-web/src/lib/musicxml/automatic-beams.ts`; domain beam relationships
and explicit join/break commands live in `lib/editor-domain`.

## Duration and grouping

Notated type, dots and tuplet ratio determine beam levels and sounding duration.
MusicXML duration supplies a fallback when notation type is absent. Eighth notes
support one beam, sixteenth notes two, and shorter supported values additional
levels. Partial secondary groups use forward/backward hooks.

Meter supplies beat groups, including additive beats, multiple beats/beat-type
pairs and compound meters. Ambiguous meters use the implementation's explicit
default grouping policy. Processing is partitioned by part, measure, voice and
staff. A chord advances musical time once. Rests, forward cursor movement,
non-beamable events and group boundaries terminate an ordinary group; an event
crossing a beat-group boundary is not joined across that boundary.

## Rebuild ownership

| Operation | Beam behavior |
| --- | --- |
| Load, save, undo, redo | Preserve stored notation |
| Pitch, fingering, lyric, articulation or stem-only edit | Preserve rhythmic grouping |
| Insert/delete, rest conversion, duration/dot/tuplet/position change | Rebuild affected rhythmic scope |
| Voice, staff or meter change | Rebuild affected measure/voice scope |
| Explicit beam join/break | Apply the domain relationship command |

Imported beam notation remains unchanged outside the edited scope. Cross-staff,
grace/cue, irregular or nested tuplets, cross-bar and specialized manual/fanned
notation are protected where the automatic policy cannot safely represent them.
Unsupported cases must not be flattened into ordinary groups.

## Validation

Beam diagnostics distinguish unpaired begin/end, invalid levels, level gaps and
cross-voice relationships. `automatic-beams.test.ts`, editor-domain command and
round-trip tests define meter, chord, hook and protected-case expectations.
Tests must verify unchanged notation outside the edited scope as well as the
validity of newly produced groups.
