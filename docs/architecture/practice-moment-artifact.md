# Canonical Practice Moment Artifact

## Contract and admission

PracticeScoreArtifact uses schemaVersion 1. The transport accepts its exact fields
and primitive types. The browser score package validates untrusted transport into its own
domain model; generated API DTOs describe the transport boundary.

The exact root fields are `schemaVersion`, `scoreId`, `revisionId`, `artifactId`,
`ticksPerQuarter`, `notes`, `events`, `moments`, `meterSegments`,
`scoreTempoSegments`, and `scoreEndTick`. All score positions/durations are
nonnegative JSON-safe integer ticks on one source-local grid. `ticksPerQuarter` is
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

Strict validation checks exact fields, identities, references, complete membership,
physical-key consistency, ordering and endpoints. Duplicate IDs/render identities,
dangling or multiply owned references and malformed chronology fail closed. Parsing
preserves input objects and primitive values without repair or coercion.

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
from those compiled facts. Pydantic transport models reuse the canonical graph invariant.
The customer OpenAPI schema and generated browser DTOs describe schemaVersion 1.
Committed backend/browser fixture tests verify deterministic payload agreement.

[Practice Source](practice-source.md) supplies the domain artifact and optional
prepared-MusicXML notation in one `/source` envelope with one source_id. Artifact content determines artifactId. PracticeSourceRecord
persists the verified READY durable source with exact score/revision/artifact IDs and
representation checksums. Live and saved consumers read that same source; its ownership
and retention are defined by the Source contract.

StepPracticeSession owns its snapshot; its target, attempt and evidence
snapshots carry numeric keys. Result schema8 binds canonical scope group identities
and source-specific evidence provenance. These contracts are described by the
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
