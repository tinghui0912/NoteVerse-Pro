# Practice Score Compiler

`app/modules/practice/score/` owns canonical score facts, MusicXML compilation,
timeline projection and artifact serialization. The compiler is the sole owner of
note/event beat placement and XML measure chronology in Practice.

```text
canonical MusicXML
  -> stable Practice notation ID preparation
  -> compile_practice_score(prepared MusicXML)
  -> immutable CompiledPracticeScore
       notes + measures + meter segments + tempo segments
  -> timeline projection -> schemaVersion 1 artifact
```

## Beat axis and measure chronology

One score beat is one quarter note. The compiler parses decimal timing quantities
exactly and accumulates rational divisions, cursor positions and measure boundaries.
`domain.canonical_beat` rounds exported beat values to six decimal places using nearest rounding with ties
to even on the floating-point value. Distinct
score positions must remain distinct at that precision. Note durations are the
canonical difference between exported onset and endpoint and must remain positive.

Parts align by measure ordinal and have equal measure counts. Within each part,
divisions persist until explicitly changed. An ordinary note or rest advances the
cursor by duration/divisions; a chord member uses its preceding note's onset without
advancing the cursor. Chord membership requires the same voice. Backup moves the
cursor backward within the measure; forward advances it. The maximum occupied
extent across voices and parts establishes the next measure's start.

A pickup or partial measure advances by its actual extent. When a measure has no
elapsed note/rest/forward extent in any part, it advances by the established meter's
nominal duration. This is the explicit empty-measure timing rule. Measure numbers
remain notation labels; they do not determine elapsed beats.

Meter changes occur at the measure origin. Sound tempo and direction tempo use the
same cursor; a direction offset is measured in the active divisions and may move
the marking backward only to a nonnegative score position. The shared
[Score tempo semantic owner](score-tempo.md) interprets metronome beat units, dots
and sound playback attributes as quarter-note BPM. Conflicting meter or tempo values at one position fail
admission. Meter, tempo and note/event positions are projections of these compiled
facts, with no downstream XML timing traversal.

## Admission

The initial meter is explicit and starts at beat zero. Its numerator and denominator
are positive JSON-safe integers, exactly representable by canonical JSON and browser
Number (`1..9007199254740991`). Its domain-derived measure duration is finite and positive. Later measures inherit the active meter or declare a supported meter
change. Missing/malformed meter and senza-misura notation are invalid for Practice.

Divisions and note/backup/forward durations are explicit positive finite numbers.
Invalid numbers, missing timing quantities, backup before the measure origin,
orphan chord members, ambiguous timing fields and malformed direction offsets fail
closed. Grace timing, transposing notation and composite meter groupings are not
supported by this compiler. Physical pitch is computed from explicit pitch facts
and admitted through the Practice piano-key domain. Key signatures are not required.

Tempo markings are optional. An empty tempo projection represents the absence of
explicit score tempo; execution's SCORE selection uses the product 80 BPM policy
before any explicit tempo. The compiler does not insert a tempo segment for that
policy. Count-in and metronome consumers use admitted meter timing directly.

`PracticeScoreInvalidError` crosses the Source service boundary as HTTP 422
`practice_score_invalid`. Transport schema and browser parser validate the artifact
contract without repairing timing.

## Ownership and identity

`compiler/stable_ids.py` owns render identity preparation. Source construction calls
it once, then compiles the exact prepared bytes also delivered as notation.
Compiled notes bind render IDs to pitch, beat placement, measure labels, staff,
voice and tie facts. Multi-part staff identities include their part ordinal so tie
ownership remains local to its notation part. Timeline projection groups these facts into canonical
events/moments and physical attacks. It performs no MusicXML parsing.

Domain values are frozen and contain no parsing or persistence dependencies.
The compiler depends on Practice score domain values, pure Score tempo semantics
and the standard library. It supplies
canonical note chronology to the timeline projection. Source consumes its public
compilation boundary; HTTP, persistence and
PerformanceTake remain outside score compilation.

The schemaVersion 1 artifact serializer owns canonical JSON and artifact content identity.
The canonical MusicXML data fixture in `backend/tests/fixtures/musicxml/` supplies
both artifact behavior tests and the repository contract checker. The committed
browser fixture verifies the compiled notation/event/moment projection against that
transport contract. Canonical source identity and durable verification
are described by [Practice Source](practice-source.md).

## Renderer coordinate contract

The artifact uses notation-order quarter positions. The Practice Verovio adapter
sets `expandNever: true` for its toolkit instance; its qstamp-based visual timeline
therefore shares the artifact's written beat axis, including scores with repeat
barlines. Score Preview uses a separate unfolded performance projection and its
renderer expansion does not define Practice artifact positions.
