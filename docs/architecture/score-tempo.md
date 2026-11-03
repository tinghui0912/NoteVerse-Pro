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

`sound@tempo` supplies the playback fact. A metronome in the same direction must
describe that same rate. Conflicting rates, multiple ambiguous directives, unsupported
metronome forms and nonpositive, malformed or nonfinite explicit numbers fail closed.
A direction offset is divided by the divisions active at that direction and added to
the consumer's current score cursor. Conflicting facts at one score position and
positions before the score origin are invalid.

Score ingestion validates these facts and materializes an equivalent `sound@tempo`
when a metronome has no playback attribute. It preserves beat-unit/dot presentation
and inserts no tempo when notation is absent. Canonical MusicXML therefore carries
the explicit quarter-BPM playback fact used by renderer consumers. Editor tempo
controls edit literal notation fields; they do not interpret them as playback BPM.

## Missing-tempo policy

[`contracts/score/tempo-policy.json`](../../contracts/score/tempo-policy.json) is the
cross-runtime product authority: `defaultScoreTempoBpm = 120`, with unit
`QUARTER_NOTES_PER_MINUTE`. `scripts/generate_score_tempo_policy.py` deterministically
generates the Python and TypeScript runtime projections; `--check` verifies agreement.
Backend quality and customer-web typecheck enforce that check.

The policy applies only before the first explicit tempo. An explicit marking at beat
2 leaves beats 0–2 at 120 PRODUCT_DEFAULT, then takes effect at beat 2 as MUSICXML.
Invalid explicit notation or custom BPM never becomes a default tempo.

## Consumers

- Practice compilation consumes explicit rational directives and places them on its
  score chronology. Practice planning applies the missing-tempo policy; the artifact
  contains only explicit tempo segments.
- Metadata consumes the same directive meanings and offsets. Its own repeat expansion
  and duration projection integrate the resulting tempo changes, starting at the
  product default where no explicit tempo is active.
- Score Preview consumes the Verovio MIDI tempo chronology directly. Its controller
  begins at the timeline's natural rate and does not replace it with a separate XML
  tempo read. A MIDI timeline without an initial tempo uses the product default
  before later tempo events.
- CUSTOM_FIXED_BPM is validated against the finite Practice product range before
  rounding. UI editing clamping is separate from domain admission and rejects
  nonfinite values.
