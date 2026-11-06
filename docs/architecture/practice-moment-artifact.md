# Canonical Practice Moment Artifact

## Contract and admission

[artifact.schema.json](../../contracts/practice/score/artifact.schema.json) is the single
language-neutral authority for serialized structure: exact fields, required values,
primitive types, bounds, enums, cardinality and artifactId format. The deterministic
[generator](../../scripts/generate_practice_score_contract.py) produces strict Python
transport models and TypeScript types/structural decoder. Generated projections are
derived artifacts, not independent authorities; `--check` verifies agreement offline.

The browser decoder validates untrusted JSON structure without coercion, repair,
mutation or graph reconstruction. Bundle admission freezes the admitted representation.
Backend `score/artifact_validation.py` reconstructs the timeline and delegates musical
semantics to `assert_practice_timeline()`, then verifies artifact tempo chronology.
`score/artifact.py` owns canonical bytes and artifact identity production.

The exact root fields are `schemaVersion`, `artifactId`,
`ticksPerQuarter`, `notes`, `events`, `moments`, `meterSegments`,
`scoreTempoSegments`, and `scoreEndTick`. All score positions/durations are
nonnegative JSON-safe integer ticks on one artifact-local grid. `ticksPerQuarter` is
positive and JSON-safe. Meter segments contain `startTick`, `numerator`, and
`denominator`; tempo segments contain `startTick` and finite positive `bpm`.

The meter timeline begins at tick zero. Measure duration is
`numerator * 4 * ticksPerQuarter / denominator`; a denominator pulse is
`4 * ticksPerQuarter / denominator`. Both must be exact positive integer ticks.
Count-In and metronome execution policy is described by
[session planning](practice-session-planning.md).

`scoreEndTick` is the full written score extent, including trailing silence, and
bounds every event and moment. `canonicalEndTick` is the exact sounding endpoint
of a moment's attacks through the tie graph. Scope/runtime consumers use these
values directly. The first event is `events[0]`; the first Practice target is
`moments[0]`, which can occur later than a continuation-only event.

Practice readiness applies to the entire pinned revision. Every retained playable
note, including continuation notes and notes outside a selected section, has an
integer PracticePianoKey21..108. Validation precedes mode, input, scope and device
preparation. The [piano-key contract](practice-piano-key-contract.md) defines that
explicit product domain independently of recognition models.

## Canonical ownership

| Owner | Facts |
| --- | --- |
| notes | noteId, eventId reference, pianoKey, renderNoteId, measureNumber, staffId, voiceId, tieTypes |
| events | eventId, onsetTick, durationTicks |
| moments | groupId, onsetTick, canonicalEndTick, attacks, continuationNoteIds |
| physical attack | attackId, pianoKey, nonempty canonical noteIds at the same onset/key |

A revision has one canonical notation graph and one chronological Practice moment
sequence. STEP and Continuous project the same physical attacks. Each note owns one
event reference and one revision-wide unique render identity. Each event has notes.
Every non-continuation note belongs to exactly one attack; same-onset/key unison
notes across voices or staves share that attack while retaining their notation IDs.

Moments cover attack onsets in order. Same-onset tie-stop notes are continuation
references disjoint from attacks. Pure tie-only onsets remain in the note/event
graph. canonicalEndTick follows sounding attack-note ends through contiguous or
overlapping same-key/staff/voice tie fragments using exact integer coordinates. Pickup notation begins on the nonnegative written axis.

Backend semantic validation checks identities, references, complete membership,
physical-key consistency, ordering and endpoints. Duplicate IDs/render identities,
dangling or multiply owned references and malformed chronology fail closed. Browser structural decoding preserves input objects and primitive values without repair or coercion.

## Mode, scope and rendering projections

Scope identity is moment.groupId. STEP exposes it through StepTarget.stepId and
projects attacks to attackKeys. continuationKeys resolve canonical continuation
notes and are excluded from attack equality. Set plus numeric sort gives exact,
duplicate/order-insensitive key-set comparison. MATCH advances once after rearm;
MISMATCH stays on its target; Skip is a separate action.

Continuous projects attackId to strikeId, maps moment.onsetTick through the selected
tempo timeline relative to scope, and resolves attack noteIds to render IDs. A
multi-voice unison creates one strike with every relevant notation render ID. A
C4/E4 chord creates two strikes. Continuations create no additional strike.

Score-view moment views are frozen read-only projections. Cursor, range and feedback
resolve canonical note references. Continuation notation is available to rendering
through those references. Serialized target ownership remains in moments/attacks.

## Construction and persistence

The [Practice score compiler](practice-score-compiler.md) supplies canonical note
placement and timing. Timeline projection constructs deterministic notes/events/moments
from those compiled facts. Generated Pydantic transport models validate structure; backend semantic validation owns the graph invariant.
The customer OpenAPI schema and generated browser DTOs describe schemaVersion 1.
The deterministic producer fixture check verifies payload stability independently of schema authority.

[Practice Bundle](practice-bundle.md) supplies the artifact and optional prepared
MusicXML with an explicit revision binding in one `/bundle` envelope. Artifact content
determines artifactId. PracticeBundleRecord owns content identity and representation
checksums/physical facts. ScoreRevisionPracticeBinding owns the revision association.
Take and Reservation own detached provenance snapshots without retaining Bundle.
Bundle admission and saved score export authorize the exact revision binding; the Bundle
contract defines authorization, durable verification and retention.

StepPracticeSession owns its snapshot; its target, attempt and evidence
snapshots carry numeric keys. Natural Continuous Result references its completed
session, exact executed Plan and completed evaluation. These contracts are described by the
[product contract](practice-product-contract.md).

## Integrity and evidence

Source analysis is score/target/verdict-blind. Acoustic publication independently
validates pitch/midiPitch pair identity; Practice adapters consume validated
midiPitch as physical keys. Source/event coordinates, availability and session clocks
have distinct owners. See the [acoustic identity boundary](practice-acoustic-identity-boundary.md).

Tests exercise deterministic producer/transport agreement, unison/chord/tie
projections, graph corruption, revision-wide rejection, scope, persistence, STEP
lifecycle and Continuous assignment. Deterministic tests establish contract behavior;
recognition, learner/device timing and workload qualification require their own
measurement evidence.
