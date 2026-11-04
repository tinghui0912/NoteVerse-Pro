# Performance Navigation

`app/score_semantics/performance_navigation.py` owns the domain-neutral
`project_performance_occurrences(model)` projection. Its input is the immutable
canonical written model. Its output is a frozen `PerformanceProjection` containing
an ordered tuple of `PerformanceOccurrence` values and an exact `end`.

## Occurrence coordinates

Each occurrence records zero-based `ordinal` and `measure_index`, one-based `visit`,
and `written_start`, `written_end`, `performance_start`, `performance_end`.
Every position is a `Fraction` measured in quarters. Occurrence identity is domain
identity; renderer occurrence suffixes carry no domain meaning.

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
repeat's `times` is total plays: absent means two; `times="3"` means three.
The first unmatched backward repeat can use measure zero as its implicit start.
After a closed repeat, an unmatched backward repeat is ambiguous and rejected.
Sequential explicit repeat pairs are supported. Nested, overlapping, duplicate,
unclosed or middle/nonstandard-boundary repeats fail closed.

All annotated parts must describe the same normalized repeat program. An entirely
unannotated part has no additional opinion. A later part can provide the program;
the first part has no privileged authority. Partial programs in different parts
are never combined. Conflicting annotated programs raise
`PerformanceNavigationError("conflicting_part_navigation")`.

The written model preserves endings, sound navigation attributes, standalone
Segno/Coda markers and repeat `after-jump` attributes. These facts are admissible
canonical notation, but this projector does not execute them. Ending, D.C., D.S.,
Segno, Coda, Fine, time-only restrictions and explicit after-jump behavior raise
`PerformanceNavigationError` instead of producing a partial traversal.

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
projector. A valid ending or jump score can be stored even when its performance
projection is unsupported. See [written semantics](score-semantics.md) and
[tempo semantics](score-tempo.md).
