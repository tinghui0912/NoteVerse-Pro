# Practice Score Compiler

`app/modules/practice/score/` owns Practice support validation, timeline projection
and artifact serialization. Written MusicXML chronology belongs to the domain-neutral
[canonical written model](score-semantics.md).

```text
canonical MusicXML
  -> stable Practice notation ID preparation
  -> parse_score_semantics (exact Fraction written facts)
  -> project_practice_score -> immutable CompiledPracticeScore
       notes + measures + meter segments + explicit tempo segments
  -> timeline projection -> schemaVersion 1 artifact
```

`compile_practice_score(prepared_musicxml)` is the Source-facing boundary. It parses
written semantics once and delegates to the Practice projection. Source construction
uses the exact prepared bytes also delivered as notation.

## Projection boundary

One Practice beat is one quarter note. `domain.canonical_beat` rounds exported
positions to six decimal places using nearest rounding with ties to even on the
floating-point value. Distinct exact source positions must remain distinct at that
precision. Note durations are the canonical difference between exported onset and
endpoint and must remain positive. All XML divisions, note/rest/chord onsets,
backup/forward movement, shared measure starts and positioned meter/tempo facts
are supplied by canonical semantics, not recalculated by this projection.

Parts must have aligned written measure sequences. Practice requires an explicit
initial simple meter at beat zero, with changes at measure origins. Numerators and
denominators are positive JSON-safe integers (`1..9007199254740991`), and the
projected nominal duration must be finite and positive. Unmetered notation, composite
meter groupings, grace timing and transposing notation are unsupported for Practice.
These are product support restrictions on canonical facts.

Physical pitch is computed from explicit pitch facts and admitted through the
Practice piano-key domain. Prepared pitched-note IDs must be unique. Staff identity
includes part ordinal in multi-part scores so tie ownership stays local. Supported
tie facts feed the unchanged event/moment projection. Measure numbers remain
notation labels, while semantic locators use written part/measure/note sequence.

Tempo markings are optional. The artifact contains only explicit tempo segments.
SCORE planning applies the product 80 BPM policy before the first explicit tempo;
compilation does not insert that policy as notation. Meter, tempo, note and measure
positions share the same canonical written axis.

## Source and errors

The canonical parser raises `MusicXMLSemanticError`. This boundary maps semantic
errors and Practice support failures to `PracticeScoreInvalidError`; the Source
service projects them as HTTP 422 `practice_score_invalid`. Transport schema and
browser parsing validate the artifact without repairing timing.

`compiler/stable_ids.py` prepares render identity once per source build. Compiled
notes bind those identities to projected written facts. Timeline projection groups
them into events, moments and physical attacks without parsing MusicXML. The frozen
Practice domain values have no parsing or persistence dependencies. Compilation
depends on the pure written model and Practice domain values; HTTP, persistence and
PerformanceTake are outside this boundary.

The schemaVersion 1 artifact serializer owns canonical JSON and artifact content
identity. The canonical MusicXML data fixture in `backend/tests/fixtures/musicxml/`
supplies artifact tests and the repository contract checker. The browser fixture
verifies the notation/event/moment projection against that transport contract.
[Practice Source](practice-source.md) defines source identity and durable verification.

## Renderer coordinate contract

The artifact uses notation-order quarter positions without repeated occurrences.
The Practice Verovio adapter sets `expandNever: true` on its toolkit instance, so its
visual timeline shares the artifact's written axis. Score Preview separately uses
renderer-expanded performance coordinates. Metadata's supported repeat-duration
projection does not alter Practice chronology.
