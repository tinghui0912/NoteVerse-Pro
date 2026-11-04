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

Linear scores visit each written measure once. Simple repeats require a forward
repeat on a left barline and a backward repeat on a right barline. A backward
repeat outside an ending uses `times` as total plays: performance projection applies
two when the attribute is absent; `times="3"` means three.
The first unmatched backward repeat can use measure zero as its implicit start.
After a closed repeat, an unmatched backward repeat is ambiguous and rejected.
Sequential explicit repeat pairs are supported. Nested, overlapping, duplicate,
unclosed or middle/nonstandard-boundary repeats fail closed.

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
`WrittenPoint` identity. One sound event retains its named segno/coda destinations,
D.S./To Coda references, D.C./forward-repeat flags, Fine source token and optional
strictly ascending `time_only` pass predicate together. Named tokens collapse XML
whitespace and remain case-sensitive. Duplicate labels and unresolved references
are preserved; this projection does not select or resolve a destination.

Visual `WrittenNavigationMarker` facts have independent exact presentation points.
Direction offsets always move those glyphs, while playback uses sound-owned offset,
then direction offset only with `sound="yes"`, then zero. A visual segno/coda alone
is not a playback destination authority, and a playback destination needs no glyph.
Barline glyphs retain left/start, right/shared-end or middle/cursor positioning.

These facts and repeat `after-jump` attributes are admissible canonical notation,
but any playback navigation event or visual navigation marker causes
`PerformanceNavigationError("unsupported_performance_navigation")`. D.C., D.S.,
To Coda, Fine, forward-repeat, time-only gating, reference resolution and explicit
after-jump behavior are not executed. Linear, simple repeat and supported volta
traversal remain separate from that unsupported capability.

## Consumer ownership

Metadata obtains occurrences and positioned tempo events from this projection.
It owns its public DTO and exact duration integration, mapping navigation errors
to `MetadataExtractionError`. Tempo state starts at the generated score tempo
policy, 80 quarter notes per minute, once at performance origin. It persists
across every transition, including backward jumps, until an encountered explicit
tempo changes it. An explicit marking is encountered again on each corresponding
visit. Duration stays rational until the final millisecond rounding.

Practice uses written notes, events and moments and does not unfold repeats. Its
Verovio instance uses `expandNever: true`. Score Preview uses renderer performance
coordinates. Real Verovio tests witness conformance for the supported simple-repeat
subset; renderer traversal is not the canonical domain authority.

Canonical document admission validates written semantics without calling this
projector. Unknown ending numbers, unsupported complex ending layouts and valid
jump scores can be stored even when performance projection is unsupported.
See [written semantics](score-semantics.md) and
[tempo semantics](score-tempo.md).
