# STEP Application

`StepPracticeController` composes the pure domain and owns the application lifecycle,
selected MIDI/microphone input, metronome, cancellation and cleanup. React subscribes and
sends commands; its animation frame reads elapsed presentation time. STEP waits
for input and has no Pause/Resume lifecycle.

## Domain and input contract

The [canonical Practice contract](../../../../../../docs/architecture/practice-piano-key-contract.md)
owns revision-wide schemaVersion 1 validity and integer PracticePianoKey21..108. Scope selects
progression only. Canonical moments own targets; STEP projects attack keys and
continuation keys from their note references. There is no serialized STEP sequence. Runtime asserts the artifact, resolves scope and initializes;
revision-wide key validity applies to every selected target.

StepPracticeSession receives StepPianoKeyEvidence:
nonempty dense own-indexed numeric observedAttackKeys, raw length<=128, finite
confidence and capture-end Session Time. The score predicate owns key validity.
Raw129 rejects before indexed reads; sparse/malformed evidence remains ANALYZING
and retryable. Raw128 is an unqualified work policy, not derived from88.

normalizePianoKeySet is Set+numeric ascending sort. pianoKeySetsEqual compares
normalized cardinality and every member structurally. Both MIDI and microphone
share exact attack-key semantics; continuationKeys do not enter equality.
MATCH advances exactly once on rearm; MISMATCH stays; Skip is separate.

MIDI uses numeric noteNumber, filters out-of-Practice wire keys score-blindly and
retains a fixed first-NOTE_ON H35 gesture. Acoustic uses validated midiPitch within
H50, independent physical coverage and retirement. Neither input knows the target,
filters off-target evidence or accumulates partial gestures across attempts.
Silence produces no fabricated evidence. Confidence remains retained metadata.

READY → CAPTURING → ANALYZING → POST_VERDICT owns one attempt. Exclusive retirement
boundaries fence stale timers/publications. Explicit rearm commits finality; input
loss does not erase an already finalized verdict. Source/availability clocks remain
separate. Microphone borrowed root tracks remain device-owned; attempt clones,
capture/context and inference leases release deterministically. Natural completion
wins over late failures; cleanup failure remains visible. The controller and page own the current attempt activation lifecycle.
