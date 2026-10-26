# STEP Application

`StepPracticeController` composes the pure domain and owns the application lifecycle,
selected MIDI/microphone input, metronome, cancellation and cleanup. React subscribes and
sends commands; its animation frame reads elapsed presentation time. STEP waits
for input and has no Pause/Resume lifecycle.

## Attempts and Verdicts

`domain/attempt.ts` owns attempt identity, immutable evidence/records, verdict
types and domain errors. `domain/target.ts` projects canonical artifact groups,
attack pitches and continuation pitches for STEP. `domain/runtime.ts` owns progression;
`domain/session.ts` owns STEP status/snapshots. These modules depend only on the
shared `kernel/` contracts and each other. Browser inputs, microphone resources
and the application controller remain outside `domain/`.

- `StepMidiAttemptInput` opens on the first NOTE_ON while READY and closes the
  complete half-open 35ms gesture. Native event timestamps define capture time.
  Velocity-zero NOTE_ON is NOTE_OFF. The input has no target knowledge or early
  acceptance, and busy notes are discarded.
- `StepMicrophoneInput` consumes the shared score-blind acoustic foundation through
  `StepAcousticAttemptAssembler`. H50 groups observations within one 50ms gesture
  and seals it using processed source coverage. Physical capture chronology
  supplies retirement boundaries independently of analysis progress.
- Input owners publish `StepPitchEvidence`: a nonempty bounded observed pitch set,
  finite confidence in `[0,1]`, and capture-end session time. They have no target
  knowledge. Silence opens no attempt and produces no outcome. There is no
  acquisition retry channel or silence timeout.
- `StepPracticeRuntime` compares that evidence with the attack target, excluding
  continuation pitches. Input source fixes the versioned policy:
  `MIDI_EXACT_SET_V1` or `MICROPHONE_EXACT_SET_WITH_SUPERSET_ABSTENTION_V1`.
  Callers cannot select a policy.
- MIDI: exact sets MATCH; every other nonempty set MISMATCHes, including subsets
  and supersets. MIDI confidence is 1.
- Microphone: exact sets MATCH. A proper superset covering every target pitch
  yields RETRY with `{ origin: 'TARGET_POLICY', reason: 'TARGET_COVERED_WITH_EXTRA' }`.
  Every other non-exact set, including subsets, MISMATCHes. RETRY is target-policy
  abstention, not an acquisition-quality classification: additional acoustic
  detections do not establish extra physical key presses.
- All records retain the observed pitches, numeric confidence and capture end.
  Confidence is evidence metadata and does not choose the verdict; no secondary
  confidence threshold is applied. MATCH/MISMATCH have `retry: null`; RETRY
  requires the structured provenance. Evidence and nested metadata are immutable.
  Empty pitch evidence, invalid confidence or invalid capture chronology fail closed.

READY -> CAPTURING -> ANALYZING -> POST_VERDICT permits one active attempt.
POST_VERDICT retains the answered target and finalized pending transition. Rearm
commits MATCH progression once, including final scope completion; MISMATCH/RETRY
stay on the target. Skip is a separate READY-only action. Attempt/Skip history
fails explicitly at 100,000 records without eviction.

## Retirement and Lifecycle

Attempt identity binds session, step, target generation, input source and capture
start. Eligibility is exclusive: `attemptStart > inputEligibleAfter`. Rearm uses
a finite, same-session, monotonic watermark. MIDI uses current session time at the
READY transition without added delay. Microphone uses authoritative physical
capture time, including capture during analysis. Busy evidence cannot open another
target's attempt, regardless of publication arrival time.

After each microphone verdict, domain rearm and input arm run synchronously at the
same physical boundary. Skip blocks the idle assembler, changes the target and
rearms at that boundary. An active gesture cannot be skipped. H50 is within-gesture
grouping; retirement adds no cooldown.

Application states are IDLE / PREPARING / ACTIVE / ENDED / DISPOSED. Domain status
is ACTIVE / ENDED, with an explicit completion reason. Readiness is derived from
the controller/domain snapshot. MIDI loss cancels unfinished attempts, retains
MIDIAccess and establishes a fresh input boundary on reconnection. A finalized
POST_VERDICT transition survives MIDI loss and commits once after reconnection.
Microphone infrastructure or analysis loss is terminal.

## Resources and Capability

The controller owns the root stream, session AudioContext, metronome and runtime.
Microphone input borrows the stream/context and owns its analysis clone, capture
bridge, assembler and Worker graph. Initial readiness requires an accepted physical
boundary and armed input. MIDI execution constructs no microphone resources.
Finish/dispose await release; restart and mode/input changes wait for cleanup before
constructing a fresh owner. Owned resources are released once.

Both product modes support microphone analysis when the browser acoustic runtime
is available. Capability detection is side-effect-free and independent of MIDI.
Physical-device recognition quality, permission UX and end-to-end latency require
separate qualification.
