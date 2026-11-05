# Written Score Semantics

`app/score_semantics/musicxml_score.py` owns MusicXML written chronology. Its public
`parse_score_semantics()` entry point returns a frozen `CanonicalScoreSemanticModel`.
It depends only on the standard library and the explicit
[tempo semantic owner](score-tempo.md), independently of Practice and processing services.

```text
MusicXML score-partwise
  -> parse_score_semantics
  -> immutable written facts (Fraction quarters)
       -> Practice support validation -> compiled score -> written artifact
       -> metadata written events
       -> performance navigation -> CanonicalPerformancePlan
            -> metadata playback duration
            -> backend performance MIDI / exact HTTP transport
```

## Exact written facts

Every position and duration uses `fractions.Fraction`: one quarter is `Fraction(1)`.
Divisions of three yield exact onsets `0`, `1/3`, `2/3`, then `1`. There is no fixed
tick denominator or float identity in this model. `WrittenPart` preserves part and
measure labels. `WrittenMeasure` records shared start/end, individual part extents
and whether nominal meter duration supplies an empty measure's extent.

Divisions persist independently in each part. Ordinary notes/rests advance the
measure cursor. Forward advances it and contributes to extent. Backup subtracts
from it and must not precede the measure origin. A chord member shares the preceding
note anchor's onset in the same voice, without advancing the cursor; rests, backup
and forward end that anchor relationship. Note endpoints, including longer chord
members, contribute to the part extent. All parts at one written measure ordinal
share the maximum extent and the next measure start.

Pickup and partial measures advance by actual extent, independently of meter scope.
For a measure with no timed extent, the parser resolves the active meter for each
relevant part/staff. Staff availability follows declared staves and numbered facts.
A part-wide meter applies to all staves; a simultaneous staff-specific fact takes
precedence for that staff, while a newer part-wide change applies to all staves.
Every relevant scope must have a determinate nominal duration, and those durations
must agree before they supply one shared empty-measure extent. Missing coverage or
unmetered notation raises `empty_measure_requires_meter`; disagreeing durations raise
`ambiguous_empty_measure_duration`. No first-part, maximum-meter or 4/4 choice is made.

`WrittenNote` supplies exact onset/duration, part/measure identity, voice, staff,
source/render note ID, pitch/rest distinction, grace/chord observations and tie
facts. Its sequence is the note/forward ordinal within that part measure. Physical
piano-key admission, supported tie patterns and render-ID requirements belong to
the Practice projection.

## Positioned notation

`WrittenMeter`, `WrittenKey` and `WrittenTempo` carry part/measure identity and
absolute written Fraction position. Meter and key retain `staff_number`: `None`
means part-wide, while a positive number identifies one staff. Meter conflict
identity is `(part_index, staff_number, position)`. Contradictory facts in that same
slot are invalid; different parts or staff scopes can carry different meter facts.
Meter groups retain additive beats and beat-type pairs; explicitly unmetered
notation has no nominal measure duration. Timed polymetric measures retain their
actual shared extent. Ambiguous nominal inference for an empty measure is a
chronology failure, not a prohibition on scoped meter facts.

`WrittenKey` distinguishes traditional `fifths` from nontraditional alterations.
Each `WrittenKeyAlteration` preserves its step, exact Fraction alter and optional
accidental. Optional mode remains `None` when absent. Canonical facts do not infer
major mode, and they preserve staff-scoped and nontraditional keys.

Canonical validity, Practice support and metadata DTO support are separate boundaries.
Practice requires one compatible score-wide simple meter timeline: an explicit initial
meter, supported measure-origin placement, no staff-scoped meters and no divergent
active part signatures. Identical part facts collapse into its one timeline. Practice
uses explicit note pitches, not key signatures, so scoped/nontraditional keys remain
Practice-compatible when the other score facts are supported.

Metadata's current event DTO can retain part identity but has no staff scope or
nontraditional key representation. Its projection rejects staff-scoped meter/key
facts and nontraditional keys rather than dropping their meaning. Unscoped different
part meters remain separate time events. For traditional unscoped keys only, metadata
projects an absent mode as `major`; that is metadata presentation policy, not a
canonical source fact. These projections do not reinterpret XML chronology.

`musicxml_sound_position.py` resolves exact sound playback offsets: sound-owned
offsets override direction offsets, and direction offsets affect sound only with
`sound="yes"`. The owner supports standalone sound and requires positive divisions
only for an effective playback offset. It computes no cursor or tempo meaning.
`musicxml_tempo.py` interprets explicit tempo directives, including beat units and
dots, and consumes that playback offset. The written parser positions those facts
once, using its current cursor and shared measure start, and validates positional
conflicts. Missing tempo produces no fact. Consumers needing effective timing apply
`contracts/score/tempo-policy.json`: 80 quarter notes per minute until an explicit
fact takes effect. Metadata integrates exact Fraction durations to final milliseconds.

## Written and performance axes

`WrittenRepeat` records part, written measure index, barline location, direction,
optional source `times` and `after_jump` attributes. Absent backward `times` remains
`None`; forward facts have `times=None`. Effective play counts belong to performance
projection. Missing barline location means right.
`WrittenEnding` retains part, measure, barline location, type, `raw_number` and
normalized `passes`. Passes are a sorted tuple of positive integers; `1,2` and
`1, 2` represent the same set. A blank number has `passes=None`, preserving unknown
pass semantics as a valid written fact. Malformed numeric lists are invalid facts.
A written measure and its notes occur exactly once in this model.

### Playback navigation facts

`WrittenPlaybackNavigation` is one immutable event per navigation-bearing source.
It inherits part, measure number/index, exact Fraction position and `WrittenPoint`.
Typed fields are `dacapo`, `dalsegno`, `segno`, `coda`, `tocoda`, `fine`,
`forward_repeat`, `time_only`, `source` and `barline_location`.
Sound events have `source="sound"` and no barline location. Attributes on one sound
retain their common position and applicability. Its effective playback offset uses
`musicxml_sound_position.resolve_sound_offset_quarters`, shared with tempo.

Playback destinations come from `sound@segno` / `sound@coda` or
`barline@segno` / `barline@coda`; `dalsegno` and `tocoda` preserve named references.
Barline events have `source="barline"` and the written barline location: left uses
measure start, right waits for the shared measure end, and middle uses the exact
source cursor. Playback and visual barline facts are separate even when their
points agree. A destination attribute does not require a visual child.
XML whitespace collapses within tokens, empty tokens are rejected
and label identity is case-sensitive. Multiple destinations, duplicate labels,
unresolved references and separate part facts are preserved without resolution.
Absent `dacapo` / `forward-repeat` are false; only literal `yes` is accepted when
present. `fine` retains a normalized, nonempty source token without interpreting
termination or note duration.

`forward_repeat` preserves the source's implied, undisplayed repeat-start sign.
Performance normalization treats it and a visible forward barline as the same
semantic start when their exact owned measure-start points agree. Source facts
and provenance remain separate and unchanged in the written model.

### Sound applicability

`musicxml_time_only.parse_time_only` is the canonical sound applicability datatype
owner. It returns `None` when absent or a strictly ascending tuple of positive
integers. After XML token whitespace collapse, the lexical pattern is
`[1-9][0-9]*(, ?[1-9][0-9]*)*`. Space before a comma, zero, leading zeros,
duplicate/out-of-order values and malformed lists are rejected rather than repaired.

`time-only` is not a navigation command. A sound containing only unmodeled playback
fields such as dynamics and a valid applicability predicate creates no navigation
fact. A navigation-bearing sound keeps the predicate on its combined event.
`TempoDirective` and `WrittenTempo` retain sound-tempo `time_only` independently of
navigation. A numeric metronome is itself an ungated explicit tempo source; it does
not inherit an unrelated or redundant sound's predicate. A matching gated
`sound@tempo` does not make the metronome conditional; differing rates still conflict.

Materialization keeps ungated metronome tempo separate from an existing gated sound.
The original non-tempo sound event is preserved as an adjacent standalone sound,
including its attributes, children and applicability. Inherited direction playback
offset becomes a sound-owned offset in MusicXML's legal final sound-child position
when needed. The direction retains its notation
and an ungated tempo sound with the equivalent playback position. Namespace,
canonical tempo facts and navigation positions are preserved, and admission is
idempotent.

`musicxml_tempo.put_written_tempo_fact` checks differing BPMs for overlapping
applicability at the resolved `WrittenPoint`, across all parts. An ungated fact
overlaps every pass; disjoint predicates may carry different rates. Identical rates
and original source facts remain preserved. Measure-end and next-start slots remain
distinct even when their absolute quarters agree.

Gated tempo remains admitted written notation. Practice explicitly rejects
pass-gated tempo because its written artifact has no pass-applicability
representation. Current performance/metadata projection also rejects gated tempo,
rather than inferring pass state from measure visit counts.

### Visual navigation markers

`WrittenNavigationMarker` independently inherits the exact `WrittenPoint`, part
and measure identity. It records kind (`segno` / `coda`), source (`direction` /
`barline`) and optional barline location. A visual glyph is not a named playback
destination; playback-only destinations do not require a visual glyph.

`musicxml_direction_position.resolve_direction_offset_quarters` owns presentation
offsets as exact Fraction quarters. A direction offset always moves the visual
marker; it moves associated sound only with `sound="yes"`. A sound-owned offset
overrides direction playback placement without changing the visual point.
Left barline markers use measure start; right markers use the shared measure end
after all part extents or empty-measure duration are known. Middle barline markers
use the exact written cursor at that source element. Source measure identity is
retained even when endpoint and next-start quarters are numerically equal.

Visual-only markers do not alter linear, repeat or supported volta traversal.
Playback navigation facts feed the performance navigation owner's supported
exact D.C./D.S. with optional Fine or one named To Coda transfer; the written model
never executes them.

### Consumer projections

Practice projects exact written Fractions onto a source-local integer tick grid.
Its artifact, scope, tempo positions and metronome use `ScoreTick` with
`ticksPerQuarter`; only runtime/UI time conversion uses floating-point values.
Its Verovio toolkit uses `expandNever: true`, and cursor timing uses artifact ticks
and written render identities. The [performance navigation owner](performance-navigation.md)
projects linear playback, simple non-nested barline repeats, supported whole-measure
volta groups and one exact D.C./D.S. with optional Fine or one named To Coda transfer
into visited measure intervals.
Intervals may be partial; their full written measure identity remains intact.
Ending pass sets select actual visits;
the written model itself never unfolds them.
`CanonicalPerformancePlan` combines those occurrences, initial tempo policy and
ordered tempo encounters. Metadata consumes the plan for duration;
tempo state persists across jumps until an encountered marking changes it. Ending
layouts and jump programs outside that subset remain valid written notation but fail
the performance capability boundary. Browser Score Preview and backend playback both consume this plan. Verovio
provides written-axis realization with `expandNever`: backend projects MIDI
events for FluidSynth, and Browser projects written notes and Timemap IDs for
audio scheduling and cursor time. The plan alone owns performance chronology.
Canonical written admission is broader than the explicit
[playback source profile](performance-navigation.md#written-realization-capability).
Playback consumers validate that profile before renderer realization; unknown
playback-bearing source fields fail closed. This does not restrict pure written
facts, metadata, or canonical plan construction.

## Boundaries

`MusicXMLSemanticError` is domain-neutral. Practice maps it to
`PracticeScoreInvalidError`; metadata maps it to `MetadataExtractionError`.
Neither consumer performs an independent XML cursor or measure-start traversal.
Canonical parsing does not modify source bytes or materialize a product default.
The written parser and trusted canonical document representation are `score-partwise`.
`score-timewise` is not an admitted canonical source representation; no timewise
normalization is performed.

## Document admission

`app/processing/musicxml/admission.py` owns `admit_musicxml_document(content)`:

1. Parse XML and require the partwise representation.
2. Delegate explicit tempo validation/playback materialization to `musicxml_tempo`.
3. Serialize only if materialization changed the document.
4. Run `parse_score_semantics` on the exact final bytes.
5. Return those admitted bytes to hashing, storage or the trusted document consumer.

Valid input with no materialization change is returned byte-for-byte. Re-admitting
materialized content is idempotent. Missing tempo is legal and inserts no 80 BPM fact.
XML, tempo and written-semantic errors become the existing public
`REVISION_CONTENT_INVALID` validation error, with internal causes retained for diagnosis.
This is canonical semantic admission, not full MusicXML XSD conformance validation.

Revision create/restore, Review confirm and user MusicXML update, and the synchronous
confirmed-score creation entry point all admit content before storage reservation or
durable put. Revision content hashes and source checksums describe exactly the admitted
bytes. Fingering admits editor input before execution and generated output before
returning its unsaved suggestion; invalid generated output is `SCORE_FINGERING_FAILED`.
Backend playback also uses the same document boundary before its ephemeral renderer
adaptation. There is no persisted serialized semantic-model cache: downstream consumers
parse trusted bytes when they need written facts.

Canonical admission calls neither Practice nor metadata projection. A valid timed
polymetric/scoped-meter score, nontraditional/scoped key, fractional alteration or
absent traditional key mode remains admissible when its written semantics are valid.
Practice still applies its support restrictions. Metadata can mark its projection
FAILED for an unsupported DTO shape or a storage problem; new source writes cannot
store malformed written chronology and defer its discovery to metadata.

Raw OMR output, pipeline intermediates and job-scoped `REVIEW_MUSICXML` candidates
recorded by the import pipeline remain temporary upstream artifacts. Their storage
is not a claim of canonical semantic admission. Explicit Review update/confirm and
confirmed-score creation enforce the trusted boundary. Pipeline recording and review
thumbnail generation do not turn raw intermediates into canonical revision sources.

The cross-projection fixture `backend/tests/fixtures/musicxml/written-semantics.musicxml`
combines multiple parts, divisions changes, voices/backup, forward, an empty measure,
meter/key changes, late offset tempo and a simple repeat. Its shared starts are
`0, 4, 8, 11`; Practice has four written measures, while metadata's playback order
is `0, 1, 0, 1, 2, 3` and its duration is 15000 ms.
