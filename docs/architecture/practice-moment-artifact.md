# Canonical Practice Moment Artifact

## Contract and admission

PracticeScoreArtifact uses schemaVersion 1. The transport accepts its exact fields
and primitive types. The browser kernel validates untrusted transport into its own
domain model; generated API DTOs describe the transport boundary.

The exact root fields are `schemaVersion`, `scoreId`, `revisionId`, `artifactId`,
`notes`, `events`, `moments`, `meterSegments`, `scoreTempoSegments`, and `scoreEndBeat`.
Every meter segment contains exactly `startBeat`, `numerator`, and `denominator`.
Meter numerator and denominator are positive JSON-safe integers (`1..9007199254740991`),
so canonical JSON and browser Number represent each value exactly. These facts
establish a nonempty timeline beginning at beat
zero, with finite, nonnegative, strictly increasing segment positions. Derived
measure duration must be finite and positive.

Measure duration is `numerator * 4 / denominator`, normalized to canonical six-decimal
score beats. Backend meter domain and the browser's pure `measureDurationBeats`
helper own this derivation. Count-In pulse count and metronome pulse behavior are
execution policy, described by [session planning](practice-session-planning.md).
They are not serialized score facts.

`scoreEndBeat` is a validated denormalized summary equal to the canonical event
chronology's maximum endpoint. `canonicalEndBeat` is the validated sounding endpoint
of a moment's attacks through the tie graph. Scope/runtime consumers use these
summaries directly. The first canonical event is `events[0]`; the first Practice
target is `moments[0]`, which can occur later than a continuation-only event.

Practice readiness applies to the entire pinned revision. Every retained playable
note, including continuation notes and notes outside a selected section, has an
integer PracticePianoKey21..108. Validation precedes mode, input, scope and device
preparation. The [piano-key contract](practice-piano-key-contract.md) defines that
explicit product domain independently of recognition models.

## Canonical ownership

| Owner | Facts |
| --- | --- |
| notes | noteId, eventId reference, pianoKey, renderNoteId, measureNumber, staffId, voiceId, tieTypes |
| events | eventId, onsetBeat, durationBeats |
| moments | groupId, onsetBeat, canonicalEndBeat, attacks, continuationNoteIds |
| physical attack | attackId, pianoKey, nonempty canonical noteIds at the same onset/key |

A revision has one canonical notation graph and one chronological Practice moment
sequence. STEP and Continuous project the same physical attacks. Each note owns one
event reference and one revision-wide unique render identity. Each event has notes.
Every non-continuation note belongs to exactly one attack; same-onset/key unison
notes across voices or staves share that attack while retaining their notation IDs.

Moments cover attack onsets in order. Same-onset tie-stop notes are continuation
references disjoint from attacks. Pure tie-only onsets remain in the note/event
graph. canonicalEndBeat follows sounding attack-note ends through contiguous or
overlapping same-key/staff/voice tie fragments with the established beat rounding.
Finite negative pickup onsets are valid chronology.

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

Continuous projects attackId to strikeId, maps moment.onsetBeat through the selected
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

STEP uses schema9/runtime step-piano-key-learning-v12; its target, attempt and evidence
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
