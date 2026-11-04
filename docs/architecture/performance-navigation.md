# Performance Navigation

`app/score_semantics/performance_navigation.py` owns the domain-neutral
`project_performance_occurrences(model)` projection. Its input is the immutable
canonical written model. Its output is a frozen `PerformanceProjection` containing
an ordered tuple of `PerformanceOccurrence` values, the complete canonical
`written_spans` table and an exact performance `end`.

## Occurrence coordinates

Each occurrence records zero-based `ordinal` and `measure_index`, one-based `visit`,
and `written_start`, `written_end`, `performance_start`, `performance_end`.
Every position is a `Fraction` measured in quarters. Occurrence identity is domain
identity; renderer occurrence suffixes carry no domain meaning.
An occurrence is one contiguous performed interval inside one written measure,
not necessarily the whole measure. `visit` counts entries into that measure,
including an entry at a mid-measure destination. Jump sources, targets and Fine
may cut intervals at exact rational points. A zero-duration occurrence is emitted
only when an entry/exit point requires an encounter without a nonzero interval;
it is not paired with a duplicate interval at the same entry.
Written spans remain available independently of which branch occurrences are
visited. Fact ownership always resolves against that complete table.

An absolute quarter alone is not a complete fact identity at a measure boundary.
`WrittenPoint(measure_index, position)` retains source measure/edge ownership;
the same quarter can be one measure's endpoint and another measure's start.
`WrittenPerformanceFact[T]` pairs that point with an uninterpreted value.
`PerformanceProjection.project_position` accepts a written point, and
`project_facts` returns ordered `ProjectedPerformanceFact[T]` values retaining
their source fact, occurrence ordinal and exact performance position. Stable
source order and duplicate same-value facts are preserved. No BPM/value sorting
or set-based coalescing defines encounter order.
Only facts inside the occurrence's inclusive owned interval are replayed. Facts
before a mid-measure destination or after a jump/Fine cutoff are excluded from
that visit. Complete canonical `written_spans` remain independent of partial visits.

`written_point.resolve_written_point` keeps an in-source-measure point owned by
that measure, including both endpoints. A sound offset crossing into another
measure's strict interior has that unique playback owner; score origin and final
endpoint also have unique owners. An offset outside its source measure that lands
on a shared boundary lacks a unique side and fails performance projection with
`ambiguous_cross_measure_boundary`. Canonical admission can retain that notation.

Source-measure endpoint facts execute at the end of every source occurrence,
before its jump. Destination-start facts execute only on entry to that destination.
At one performance quarter an endpoint fact therefore precedes a destination-start
fact, even when the destination changes the same state again. Consumers do not
recompute measure ownership or occurrence offset arithmetic.

## Supported traversal

Linear scores visit each written measure once. Repeat starts may come from a
visible left-barline forward repeat or an invisible `sound@forward-repeat="yes"`.
Both normalize to the same exact `WrittenPoint` at the owning measure start.
An invisible start at an interior point or previous-measure endpoint is unsupported;
an equal absolute quarter never remaps endpoint ownership to the next start.
A forward-repeat sound with any `time-only` is unsupported, including `(1,)`.
Destination metadata may share that sound, but a repeat start combined with an
executable jump/Fine/To Coda command has no supported same-event ordering.

Each annotated part independently pairs its starts with right-barline backward
repeats. Normalized region identity contains start/end WrittenPoints, optional
source `times` and `after_jump`; visible versus invisible provenance does not
participate in agreement. Duplicate invisible starts and a visible/invisible pair
at the same point collapse only in performance normalization; distinct starts
before one close are nested and unsupported. A start-only part and backward-only
part are never stitched together. A backward
repeat outside an ending uses `times` as total plays: performance projection applies
two when the attribute is absent; `times="3"` means three.
The first unmatched backward repeat can use measure zero as its implicit start.
After a closed repeat, an unmatched backward repeat is ambiguous and rejected.
Sequential repeat pairs are supported. Nested, overlapping, ambiguous duplicate,
unclosed or middle/nonstandard-boundary repeats fail closed. Simple standalone
volta contexts also accept either start representation through this normalization.

## Whole-measure volta

The written model stores ending markers with their raw number and normalized set
of positive pass numbers. Blank numbers have unknown passes. Lexically malformed
numbers such as `0`, `01`, `1-2` or `1,,2` are invalid written facts; unknown or
unsupported branch layouts remain valid canonical notation.

The performance owner pairs a left-barline start with one right-barline stop or
discontinue having the same pass set. `EndingSpan` records start/end measure
indices, passes and close type. Stop and discontinue have identical performance
close semantics; their engraving distinction remains preserved in the fact.
Unclosed, nested, overlapping, duplicate or disagreeing spans fail closed.

A supported repeat context has common measures, one repeat-back ending terminating
at its backward repeat, and one immediately following final exit ending. For total
plays N, the final exit must name exactly one pass `{N}`, with N at least two, and
repeat-back passes must be exactly `{1, ..., N-1}`. Total plays derive from this
ending coverage, including `{1}/{2}` and `{1,2}/{3}`, without `repeat@times`.
A closing repeat carrying `times` is preserved in written notation but rejected
by performance projection as `repeat_times_with_ending`, even when it agrees with N.
Each non-final pass visits
common measures and the repeat-back span; the final pass visits common measures
and the final exit span, then continues after the group. Occurrence visit counts
follow actual visits. Explicit and first-context implicit-origin repeats and
sequential non-overlapping volta groups are supported.

Unknown passes, missing/overlapping/out-of-count coverage, unassociated endings,
non-whole-measure boundaries and complex multi-branch layouts fail closed. Ending
markers define navigation structure; they are not replayed as ordinary positioned
facts. Generic tempo facts replay only when their owning measure is visited,
including source endpoints before a repeat jump and final-ending starts on entry.

All annotated parts must describe the same normalized repeat-and-ending program. An entirely
unannotated part has no additional opinion. A later part can provide the program;
the first part has no privileged authority. Partial programs in different parts
are never combined. Conflicting annotated programs raise
`PerformanceNavigationError("conflicting_part_navigation")`.

## Playback navigation facts

The written model preserves typed `WrittenPlaybackNavigation` events with exact
`WrittenPoint` identity and explicit sound/barline provenance. One sound event
retains its named segno/coda destinations,
D.S./To Coda references, D.C./forward-repeat flags, Fine source token and optional
strictly ascending `time_only` pass predicate together. Named tokens collapse XML
whitespace and remain case-sensitive. Duplicate labels and unresolved references
are preserved. Barline
segno/coda attributes also create playback destinations, with left/start,
right/shared-end or middle/cursor ownership, independently of visual children.

Visual `WrittenNavigationMarker` facts have independent exact presentation points.
Direction offsets always move those glyphs, while playback uses sound-owned offset,
then direction offset only with `sound="yes"`, then zero. A visual segno/coda alone
is not a playback destination authority, and a playback destination needs no glyph.
Barline glyphs retain left/start, right/shared-end or middle/cursor positioning.
Visual-only markers do not alter linear, simple repeat or supported volta traversal.

Playback segno/coda destinations alone are inert, including in linear, repeat and
supported volta scores. Visual glyphs never participate in destination resolution.

## Exact D.C./D.S. and Fine

A jump program supports one primary D.C. or backward D.S. command with either
optional Fine termination or one named To Coda forward transfer. D.C. targets the
movement origin. D.S. resolves its case-sensitive
normalized label against playback segno destinations from sound or barline facts.
Same-label duplicates at the same resolved `WrittenPoint` are one destination;
different points, including opposite sides of a numerically equal boundary, are
ambiguous. Missing labels and equal/forward D.S. targets fail closed. D.C. at origin
is non-progressing and rejected.

Unannotated parts have no additional opinion. For a jump-enabled score, annotated
parts must provide the same complete semantic role/point/label program; source
XML representation is irrelevant. Sound and barline destinations may agree at the
same point. Partial or differing part programs are rejected, never stitched.
Equivalent default and explicit supported predicates normalize consistently.
Destination metadata may accompany one unambiguous command; compound execution
roles, such as D.C. plus Fine on one sound, are unsupported.

The single primary jump executes on its first encounter, with default applicability
or explicit `time-only="1"`. Later encounters do not jump. Fine must be `"yes"`,
with absent applicability or `time-only="2"`. It is ignored before the primary
jump and armed after transfer; its next encounter stops exactly at its owned point.
A Fine before the D.S. target is not encountered on the second leg. In the form
without To Coda, absent Fine means the second leg continues to score end. An orphan
Fine is unsupported.

The al-Fine form is finite by construction: one origin-to-source leg and one
target-to-Fine/end leg. No step cap or timeout controls correctness. Ordinary facts
at the source execute before transfer; destination facts execute on entry. Facts
at Fine execute before termination. Tempo state carries across transfer until an
actually encountered marking changes it. A tempo before an exact D.S. target is
not replayed. Metadata consumes the same generic fact projection without jump rules.

## Ordinary repeats across primary jumps

Ordinary repeat regions may coexist with D.C./D.S. A normalized context
records its whole-measure start/end, total plays and optional backward-repeat
`after_jump` policy. Sequential non-overlapping contexts retain independent policies.
All annotated parts must provide the same complete jump-and-repeat program; a
jump-only part and a repeat-only part cannot be combined into one program.
Destination source representation remains irrelevant to semantic agreement.

One state-aware leg traversal emits the intervals for linear, repeat, volta and
jump programs. Before the primary jump, ordinary repeats always use their normal
total play count, regardless of `after-jump`. This also means a no-jump score
plays a backward repeat normally with either `after-jump="yes"` or `"no"`.
After the primary D.C./D.S. transfer, an encountered repeat uses its own policy:

- `after-jump="yes"` executes the normal total plays (`times`, or two if absent).
- `after-jump="no"` traverses the section once, without skipping it.
- Missing `after-jump` fails with `ambiguous_repeat_after_jump`.

A backward repeat never encountered after the primary jump needs no policy.
The post-primary state persists through a subsequent To Coda transfer, including
repeat regions after the Coda destination. This is explicit control state, not
an interpretation of occurrence visit count. Generic fact replay encounters
tempo markings on every actual visit; tempo carries across repeat jumps until
an encountered marking changes it.

Control points (primary source/target, Fine and To Coda source/target) cannot cut
through a repeat region. A point strictly inside its owned start/end range fails
with `unsupported_partial_repeat_jump_interaction`. Entry at the exact forward
start is supported. A control point owned by the backward-repeat endpoint fails
with `ambiguous_jump_repeat_boundary`; a next-measure start at the same absolute
quarter follows the completed repeat and retains its distinct ownership.
An `after-jump` attribute on a forward barline repeat is unsupported. Jump programs
with any ending remain unsupported; an ending-closing repeat with `after-jump`
also remains outside the standalone volta subset.

## Exact To Coda

A Coda program contains one primary D.C./D.S., one To Coda command and no Fine.
It has exactly three finite legs: origin to primary source, primary target to
To Coda source, and Coda target to score end. The primary executes only on the
first leg. To Coda is inactive before primary transfer and executes once on the
second leg, with absent applicability or explicit `time-only="2"`. Primary
applicability remains absent/`(1,)`. These are supported control states, not a
general pass evaluator or an interpretation of occurrence `visit`.

To Coda resolves a case-sensitive named reference only against playback
`sound@coda` or `barline@coda` facts. Visual coda glyphs do not resolve references.
Same-point duplicate destinations may collapse; different resolved WrittenPoints
are ambiguous and a missing destination is unresolved. Source XML representation
does not affect complete multi-part semantic program agreement.

The To Coda source must be reachable at or after the primary target in written
point order. The Coda target must lie forward of To Coda. Equal absolute quarters
are non-progressing even when source-end and next-start ownership differ. Backward
targets and unreachable second-leg commands fail closed. Sources and targets may
be mid-measure or in the same measure; only required entry/exit points generate
zero-duration visits. The full canonical written span table is unchanged.

Ordinary facts at To Coda execute before transfer, then destination facts execute
on entry at the same performance quarter. Tempo state carries until an encountered
marking changes it. Facts before a mid-measure Coda target are excluded from that
visit. If leg two passes the primary source, that command remains inactive. Leg
three cannot encounter the earlier To Coda source, so no cycle counter is needed.

The exact D.C. path `0..14 → 0..6 → 17..20` contains 23 quarters, or 17250 ms at
80 BPM. The D.S. path `0..15 → 5..9 → 17..20` contains 22 quarters, or 16500 ms.
Destinations alone remain inert in linear, repeat, volta and al-Fine programs.

Unsupported programs fail before traversal: multiple primary commands/Fines or
To Coda commands, orphan To Coda, any Fine plus To Coda, numeric Fine duration,
primary predicates other than absent/`(1,)`, Fine or To Coda predicates other than
absent/`(2,)`, gated destinations in executable programs,
pass-gated invisible repeat starts, same-event repeat-start/execution commands,
and any jump combined with ending notation.
Repeat/jump programs must meet the complete-context and explicit post-jump policy
rules above. Canonical source admission
does not impose these performance capability limits.

`time-only` is generic sound applicability, parsed by the shared canonical datatype
owner. It alone creates no navigation command. Sound tempo facts retain their
predicate; any gated tempo causes
`PerformanceNavigationError("unsupported_time_only_playback")`. Pass-aware
tempo applicability is not executed, and occurrence visit count is not used as a
repeat pass counter. The restricted primary/Fine/To Coda predicates above do not form a
general MusicXML pass-state model. Metadata maps errors without adding gating or jump logic.

## Consumer ownership

`score_semantics.performance_plan.build_performance_plan(model)` produces the
immutable `CanonicalPerformancePlan`, the shared performance-axis contract derived
from canonical written semantics. It contains the navigation `projection`, exact
Fraction `initial_tempo_bpm` from the generated tempo policy, and ordered
`PerformanceTempoEvent(occurrence_ordinal, performance_position, bpm)` encounters. Only real
encountered source facts enter `tempo_events`; a score without explicit tempo has
initial state 80 and no tempo events. Same-quarter source and destination encounters
remain separate, in traversal order. Applying them in order makes the last
encounter the active conductor state after that instant.

Metadata consumes this plan.
It owns its public DTO and exact duration integration, mapping navigation errors
to `MetadataExtractionError`. Tempo state starts at the generated score tempo
policy, 80 quarter notes per minute, once at performance origin. It persists
across every transition, including backward jumps, until an encountered explicit
tempo changes it. An explicit marking is encountered again on each corresponding
visit. Duration stays rational until the final millisecond rounding.

Backend playback admits one document and builds this plan. Verovio runs with
`expandNever=true` solely to realize written-axis MIDI events. The SMF decoder
retains exact input tick fractions, track/channel identity and stable source order.
The MIDI projector replays those events through canonical occurrence intervals;
Verovio expansion, MEI navigation and timemap repeat order are not consumed.
The final MIDI notes and conductor share the same canonical performance axis,
and every track ends at the plan's performance end before FluidSynth synthesis.

`processing/engines/playback/standard_midi.py` owns SMF parsing and serialization.
`performance_midi.py` owns written-event projection, without parsing MusicXML.
`midi_event_semantics.py` classifies written metadata and validates its supported
placement independently of traversal.
`VerovioMidiCompiler` orchestrates admission, written semantics, plan construction,
written realization, projection and serialization. Domain score semantics has no
binary MIDI, renderer or processing dependency.

Onsets replay only inside the performed interval `[start, end)`; an onset before
an exact destination is never invented on entry. Matching releases at endpoints
execute before transfer. Notes can continue across contiguous written measures;
at a discontinuity or termination, notes whose natural release lies beyond the cut
receive explicit note-offs exactly at that cut. No controller event is synthesized.
Natural releases retain their release envelope. Sustain, program, controller and
pitch state carries until an actually encountered event changes it; a note-off
under a held pedal may continue sounding according to that state and the synth.
Equal-position source events,
cut termination and destination-entry events retain that encounter order.

Metadata classification is explicit:

- Structural: Sequence Number `0x00`, Copyright `0x02`, Track Name `0x03`,
  Instrument Name `0x04`, Program Name `0x08`, Device Name `0x09`, Channel Prefix
  `0x20` and Port `0x21`. The written-realization contract permits one descriptor
  of each kind per source track, at origin. Each remains once on its original
  track, independently of repeat or jump visits. Non-origin or ambiguous duplicate
  descriptors fail closed rather than being relocated or selected.
- Timeline: Text `0x01`, Lyric `0x05`, Marker `0x06`, Cue `0x07`, Time Signature
  `0x58` and Key Signature `0x59` replay through actual canonical occurrences.
- Tempo `0x51` is owned by the plan; EOT `0x2F` is generated at final performance end.

Real Verovio 6.3.0 two-part fixtures produce three tracks: track 0 contains tempo
and EOT, and tracks 1/2 contain one origin Track Name and timeline Time Signature.
Those fixtures emit origin program changes 0/40 and simultaneous C4/E4 notes,
with no controller messages. With unspecified MusicXML channels, both parts use
MIDI channel 0; explicit MusicXML 3/7 uses channels 2/6, and explicit 3/3 shares
channel 2. Source assignment is preserved without rewriting MusicXML.

MIDI channels are global across SMF tracks. The written-realization adapter merges
equal-quarter input encounters by source track index, then source event index,
preserving each track's local order. Note lifecycles validate globally by
`(channel, pitch)`; a release may be in another source track. Each output channel
stream is serialized in its lowest-index participating source track, including all
its notes, program/controller/bend messages and cut releases. This preserves the
complete encounter order at one performance position, even when source and
destination messages originate in opposite track-index order. Original tracks
retain their structural descriptors and timeline metadata organization.

Channel voice events (note-on/off, program, controllers, bend and pressure) are
supported. SMF format 0/1 requires positive PPQ division and balanced,
positive-duration written note lifecycles. SysEx, SMPTE timing/offset, opaque
sequencer metadata, nonzero ports, unsupported channel modes and overlapping
same-channel/same-key note lifecycles fail closed. Shared channels alone are supported.
For non-note events at a shared measure boundary, SMF lacks source-side ownership;
projection accepts only identical encounter mappings for the candidate sides,
otherwise it reports `ambiguous_midi_boundary_state`. No event/layout fallback
uses renderer expansion.

Canonical tempo encounters alone supply conductor state. The serializer applies
same-position tempos in encounter order and emits the last state at that tick.
Quarter coordinates remain Fraction throughout projection. Output PPQ is the LCM
of input PPQ and required canonical/event denominators, bounded by SMF's 32767
limit; positions are never rounded to ticks. Unrepresentable grids fail closed.
Only the MIDI microseconds-per-quarter encoding rounds the rational tempo rate
at final serialization.

`POST /api/v1/playback/performance-plan` accepts `{musicxml: string}` without score
identity, authentication or database/storage access. It admits the supplied
document, parses written semantics, builds the plan and returns the exact admitted
UTF-8 MusicXML with `performance_end`, `initial_tempo_bpm`, `occurrences` and `tempo_events`.
Tempo events name their coordinate `performance_position`. All rational values use integer `{numerator, denominator}` pairs with positive
denominators; no rounding or transient version field enters transport. OpenAPI
owns this DTO and generates the customer-web types. Source-invalid input uses
the existing 422 `revision_content_invalid` policy; unsupported performance uses
422 `score_playback_failed`, with the domain reason retained in the application
exception. No renderer fallback, persistence or plan cache is involved.

Practice uses written notes, events and moments and does not unfold repeats. Its
Verovio instance uses `expandNever: true`. Score Preview retains its browser
renderer integration. Backend realization tests verify written MIDI note positions
and timemap identity with expansion disabled for repeat, jump and invisible-start
notation. Final backend MIDI tests verify the performed pitch sequence and exact
end against the canonical plan, including partial source and destination intervals.

Canonical document admission validates written semantics without calling this
projector. Unknown ending numbers, unsupported complex ending layouts and valid
jump scores can be stored even when performance projection is unsupported.
See [written semantics](score-semantics.md) and
[tempo semantics](score-tempo.md).
