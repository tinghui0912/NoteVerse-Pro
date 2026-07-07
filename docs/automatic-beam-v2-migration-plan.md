# Automatic Beam v2 Migration Plan

## Goal

Replace the current single-level, duration-only beam rebuild with a deterministic
notation-aware engine that remains invisible to ordinary users.

The product must not ask users to choose preserve/automatic modes or manually
recalculate measures. Rhythm edits automatically repair only the affected
measure and voice. Existing OCR beams remain untouched until the surrounding
rhythmic structure is edited.

## Product Rules

- Beam management is automatic by default and has no primary toolbar controls.
- Opening, previewing, saving, undoing, or redoing a document does not rewrite beams.
- Untouched OCR content is preserved.
- A rhythm-structure edit transfers the affected measure/voice to automatic ownership.
- Pitch, fingering, lyric, articulation, and stem-only edits do not rebuild beams.
- Insert, delete, rest/note conversion, duration, dot, tuplet, position, staff,
  voice, and time-signature edits rebuild the affected rhythmic scope.
- Structurally invalid beams may produce validation warnings. Non-default but
  structurally valid beaming is not an error.
- Expert boundary commands such as "join with next" and "break here" are a
  future enhancement, not part of the MVP toolbar.

## Domain Model

### Notated Duration

Introduce a notation-aware representation:

```ts
type NotatedDuration = {
  type: NoteType | null;
  beamLevel: number;
  soundingTicks: number;
  dots: number;
  tupletRatio: { actual: number; normal: number } | null;
  isGrace: boolean;
};
```

- `type` and dots describe appearance.
- `soundingTicks` advances the voice timeline.
- `time-modification` describes tuplet timing.
- `<duration>` is only a fallback for missing `<type>`.

### Internal Ownership

`preserved` and `automatic` are internal behavior, not user-selectable modes:

- untouched imported beam group: preserved;
- rhythmically edited measure/voice: automatic;
- future explicit expert boundary override: locked.

No proprietary state is written into standard MusicXML during the first phase.

### Beat Groups

Resolve beat groups in this order:

1. Explicit additive MusicXML numerator such as `3+2`.
2. Multiple `<beats>/<beat-type>` pairs for composite meters.
3. Conventional compound grouping for `6/8`, `9/8`, and `12/8`.
4. Product defaults for ambiguous meters, isolated behind one policy function.
5. Simple-meter beat groups.

The parser must retain additive grouping instead of reducing `3+2` with
`parseInt`.

## Beam Generation

### Primary Groups

- Partition by part, measure, voice, and compatible staff ownership.
- Rests, forwards, non-beamable notes, and group boundaries flush a group.
- Chords advance time once.
- A note crossing a beat-group boundary is not automatically joined across it.

### Multiple Levels

- eighth: level 1;
- 16th: levels 1-2;
- 32nd: levels 1-3;
- continue through MusicXML-supported levels where practical.

Each level is generated independently and may require `forward hook` or
`backward hook` for partial secondary beams.

### Protected Cases

Until explicitly supported, preserve rather than rewrite:

- cross-staff beam groups;
- grace-note beam groups;
- nested or irregular tuplets;
- beams spanning barlines;
- ambiguous manual/fanned beams;
- cue-note beam groups.

## Trigger Matrix

| Change | Rebuild |
| --- | --- |
| Insert/delete/move event | affected measure + voice |
| Duration/dot/rest/chord shape | affected measure + voice |
| Voice/staff/time signature | affected measures/voices |
| Pitch/fingering/stem only | no |
| Metadata/key/tempo | no |
| Undo/redo snapshot restore | no |
| Initial OCR load | preserve |

## Validation

Add structured issue codes for objectively malformed data:

- `beam.unpaired_begin`
- `beam.unpaired_end`
- `beam.invalid_level`
- `beam.level_gap`
- `beam.cross_voice`

Do not warn merely because a valid beam differs from the automatic default.

## Delivery Phases

### Phase 1: Foundation

- [x] Add `NotatedDuration` parser.
- [x] Parse additive beat groups.
- [x] Generate independent beam levels and hooks.
- [x] Add deterministic MusicXML fixture tests.

### Phase 2: Edit Triggers

- [x] Compare original and updated rhythmic structure.
- [x] Skip beam rebuild for pitch/fingering/stem-only updates.
- [x] Rebuild only the affected voice where possible.
- [x] Keep insert/delete/voice/time-signature behavior deterministic.

### Phase 3: Tuplets and Protected Content

- [x] Support regular tuplets and `time-modification`.
- [x] Preserve unsupported nested tuplets, grace, cue, cross-staff, and fanned beams.
- [x] Add pickup-aware beat offsets.

### Phase 4: Validation and Optional Expert Repair

- [x] Add structural beam validation issues.
- [x] Project issues onto Review/Editor measure overlays and Review navigation.
- [x] Add click-to-measure navigation from the Editor save-validation dialog.
- [ ] Evaluate expert-only "join with next" / "break here" commands after QA.

## Test Matrix

- 2/4, 3/4, 4/4 simple meters.
- 3/8, 6/8, 9/8, 12/8.
- 5/8 as `2+3` and `3+2`.
- 7/8 common additive variants.
- mixed eighth/16th/32nd notes and secondary hooks.
- rests and forwards splitting groups.
- chords without duplicate timeline advancement.
- underfilled and pickup measures.
- regular tuplets and unsupported nested tuplets.
- pitch-only edit preserving existing beam XML.
- rhythm edit replacing stale OCR beam XML only in the affected scope.
- undo/redo restoring exact beam snapshots.

## Completion Criteria

- Ordinary users never need to understand or trigger beam recalculation.
- Supported rhythms produce structurally valid multi-level MusicXML beams.
- Unsupported or intentional imported notation is preserved.
- Beam changes occur only after rhythm-structure edits.
- Verovio fixture screenshots remain stable across supported cases.
