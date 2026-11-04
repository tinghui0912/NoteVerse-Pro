# Score Tempo Semantics

All BPM values represent **quarter notes per minute**. The pure backend owner
`app/score_semantics/musicxml_tempo.py` interprets explicit MusicXML tempo notation,
independently of Practice execution, metadata projection and product defaults.

## Explicit notation

The owner reads namespace-independent `sound@tempo` and direction metronome notation.
Decimal lexical values are parsed as exact rational numbers. A metronome rate is
multiplied by its beat-unit duration in quarters and the augmentation-dot multiplier.
Half = 60 therefore means 120 quarter BPM; dotted quarter = 60 means 90 quarter BPM;
eighth = 120 means 60 quarter BPM.

`sound@tempo` supplies a playback fact with its owning sound's `time-only`
applicability. Numeric metronome notation is independently ungated, including when
an unrelated sound or a matching redundant sound tempo is pass-gated. A metronome
in the same direction must describe that same rate. Conflicting rates, multiple
ambiguous directives, unsupported metronome forms and nonpositive, malformed or
nonfinite explicit numbers fail closed.
Sound playback positioning belongs to `app/score_semantics/musicxml_sound_position.py`.
`resolve_sound_offset_quarters` returns an exact `Fraction` in quarters, without
interpreting tempo or navigation and without computing a score cursor. A direction
offset always positions the direction's written/presentation marking. It additionally
affects sound only with `sound="yes"`; absent `sound` means `"no"` and is
visual-only. A sound-owned child offset overrides the direction offset for playback, including
for standalone sound. Only effective playback offsets require positive divisions;
their exact division-unit value is divided by current divisions.

The tempo owner consumes this effective playback offset. The canonical written
parser adds it to its current part/measure cursor and retains source measure identity.
A tempo at one measure's right endpoint and another at the next measure's start
are distinct slots even when their absolute quarters match. Truly matching written
slots require BPM agreement across parts wherever pass applicability overlaps.
`put_written_tempo_fact` preserves disjoint gated rates at one resolved written
point, while ungated applicability overlaps every pass. The performed-coordinate
`put_tempo_fact` validates rate agreement at an already performed instant.
Cross-measure interior offsets resolve to
their unique playback owner; unresolved cross-measure boundary sides remain
unsupported for performance projection. Positions before score origin are invalid.

[Canonical document admission](score-semantics.md#document-admission) requires partwise
MusicXML, validates these facts and materializes equivalent ungated `sound@tempo`
for numeric metronome notation. When a direction's existing sound is gated, its
non-tempo event is preserved as an adjacent standalone sound, with its applicability
and equivalent sound-owned playback offset. The metronome direction receives a
separate ungated tempo sound at the same effective position. Existing non-tempo
attributes/children, visual notation and namespace are preserved; raw and admitted
canonical tempo facts agree, and repeated admission is byte-idempotent.
Admission validates written semantics on the final
admitted bytes before they enter trusted storage or document consumers. It preserves beat-unit/dot presentation
and inserts no tempo when notation is absent. Canonical MusicXML therefore carries
the explicit quarter-BPM playback fact used by renderer consumers. Editor tempo
controls edit literal notation fields; they do not interpret them as playback BPM.

## Missing-tempo policy

[`contracts/score/tempo-policy.json`](../../contracts/score/tempo-policy.json) is the
cross-runtime product authority: `defaultScoreTempoBpm = 80`, with unit
`QUARTER_NOTES_PER_MINUTE`. `scripts/generate_score_tempo_policy.py` deterministically
generates the Python and TypeScript runtime projections; `--check` verifies agreement.
Backend quality and customer-web typecheck enforce that check.

The policy applies only before the first explicit tempo. An explicit marking at beat
2 leaves beats 0–2 at 80 PRODUCT_DEFAULT, then takes effect at beat 2 as MUSICXML.
Invalid explicit notation or custom BPM never becomes a default tempo.

## Consumers

- The [canonical written model](score-semantics.md) positions explicit directives on
  its exact Fraction quarter axis. Practice compilation projects those positioned
  facts; Practice planning applies the missing-tempo policy. The artifact contains
  only explicit ungated tempo segments. Practice rejects pass-gated tempo because
  the artifact cannot represent its applicability.
- Metadata consumes the [canonical performance plan](performance-navigation.md)
  with exact occurrences, initial tempo state and ordered encountered tempo facts.
  Pass-gated tempo currently fails closed as `unsupported_time_only_playback`;
  no occurrence visit count is interpreted as a performance pass predicate.
  Source endpoints execute before jumps; destination-start markings execute on
  actual entry. It integrates exact duration with one tempo
  state initialized at performance origin. A repeat jump retains the active tempo;
  an explicit marking changes it again whenever encountered on a repeated visit.
- Backend playback admits one canonical document and builds `CanonicalPerformancePlan`.
  Verovio with `expandNever=true` provides written-axis MIDI realization only.
  NoteVerse projects notes, channel state and timeline metadata through canonical occurrences,
  while origin structural descriptors remain once per original track. Channel
  state and note lifecycles are global across tracks; an ordered stream per channel
  preserves source/cut/destination encounters in final SMF serialization. Cuts
  synthesize only necessary note-offs; controllers and pedal state follow actual
  source events, so sounding release under sustain remains the synth's responsibility.
  The conductor follows plan initial state and ordered tempo encounters.
  Explicit origin tempo overrides initial state. Same-quarter source/destination
  tempo encounters remain ordered in the plan and coalesce to the last state only
  at MIDI serialization. MIDI end equals canonical performance end on every track.
  Exact LCM PPQ selection represents input ticks and canonical rational boundaries
  without rounding; an unrepresentable grid fails closed. FluidSynth consumes this
  final performance MIDI. Stored MusicXML and revision hashes contain no default
  tempo fact. Renderer expansion is not a backend chronology input.
- Score Preview owns a performance projection in
  `lib/score/verovio/tempo-projection.ts`. It consumes renderer MEI quarter-BPM facts,
  one-based tempo timestamps, staff meter units, Timemap measure quarter-positions
  and Expansionmap occurrence identities. Explicit facts occur on the renderer's
  unfolded performance axis. The effective chronology supplies the product default
  at origin only when an explicit fact is absent there. It replaces the MIDI tempo
  track before ToneJS derives note times and durations. Cursor time is integrated
  from Timemap qstamp through that same chronology; renderer millisecond timestamps
  are diagnostic data. Expansionmap maps each cursor occurrence to its written SVG
  identity while preserving the unfolded performance time. The browser interprets
  no raw MusicXML tempo notation and
  resolves no repeat/ending/jump structure itself. One toolkit consumes a renderer
  document with separate presentation and playback facts. Original directions retain
  their notation, words, placement and direction offset. Original sound elements retain
  their location, sound-owned offset and all non-tempo semantics, including navigation,
  tuning, dynamics and time-only. Only the literal `tempo` attribute transfers into a
  sibling playback-only direction containing `sound@tempo` and the effective offset
  in Verovio's direction-offset slot (`sound="yes"`). A sound-owned offset wins;
  otherwise only a direction offset with `sound="yes"` affects the playback aid.
  The aid carries no notation or other sound semantics. Browser integration copies
  this literal structure without parsing BPM, divisions or score chronology.
  MEI `tempo` with `mm` but no `midi.bpm` is presentation-only and contributes no
  playback rate. Positioned `midi.bpm` facts alone own browser playback chronology. Canonical
  source bytes remain unchanged. Backend tempo placement comes directly from the canonical performance plan.
  Positioned MEI tempo facts define browser chronology; an unpositioned scoreDef MIDI rate
  does not establish an origin tempo. Stored source is unchanged.
- Practice uses its notation-order artifact quarter axis. Its own Verovio adapter
  sets `expandNever: true` on that toolkit instance, so the visual cursor remains on
  the written beat axis shared with the artifact. Score Preview keeps renderer
  performance expansion enabled. These consumer coordinate contracts are distinct.
- CUSTOM_FIXED_BPM is validated against the finite Practice product range before
  rounding. UI editing clamping is separate from domain admission and rejects
  nonfinite values.
