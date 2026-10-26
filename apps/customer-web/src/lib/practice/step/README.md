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
  knowledge. Silence opens no attempt and produces no outcome or timeout.
- Both MIDI and microphone use the same target comparison: normalized observed
  attack pitch set equals the expected attack pitch set -> MATCH; every other
  nonempty set -> MISMATCH. Continuation pitches are excluded from the target.
- Confidence is retained evidence metadata, never a verdict threshold. MIDI
  confidence is 1; microphone retains the assembler's confidence.
- Every immutable attempt record retains observed pitches, confidence and capture
  end. Invalid or empty evidence and invalid chronology fail closed.

STEP is a paced learning/recognition mode, not a performance-report mode. It has
only MATCH and MISMATCH outcomes. READY -> CAPTURING -> ANALYZING -> POST_VERDICT
permits one active attempt. POST_VERDICT retains the answered target and current
pending result. Explicit rearm clears that result and commits MATCH progression
once, including final scope completion; MISMATCH stays on the target. Skip is a
separate READY-only progression action. Snapshots contain current interaction
state, without attempt/skip history, statistics or learner reports. Completion
offers Try Again and Section Practice / Adjust Section, without a Review action.
The runtime contract is schema 8 (`step-exact-pitch-learning-v8`).

Microphone instructions ask the learner to play the highlighted target and wait
for the result before playing again. CAPTURING/ANALYZING asks them to wait while
checking the answer; MIDI uses shorter input instructions. MISMATCH means only
“Not matched yet. Try again.” It makes no claim of a wrong physical key press.
The UI reflects published state and does not claim immediate physical-attack detection.

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

Retirement prevents already captured or delayed evidence from crossing attempt
boundaries. It is not a claim that future acoustic observations after the retirement
watermark must represent a fresh physical key attack. Sustain/resonance qualification
is a separate evidence question; there is no arbitrary cooldown or silence gate.


Application states are IDLE / PREPARING / ACTIVE / ENDED / DISPOSED. Domain status
is ACTIVE / ENDED, with an explicit completion reason. Readiness is derived from
the controller/domain snapshot. MIDI loss cancels unfinished attempts, retains
MIDIAccess and establishes a fresh input boundary on reconnection. A finalized
POST_VERDICT transition survives MIDI loss and commits once after reconnection.
Temporary microphone root mute cancels unfinished input and marks it unavailable,
preserving the current target and progress without a synthetic verdict or completion.
On same-root unmute, the controller commits a fresh physical capture watermark then
arms the assembler; only evidence strictly after that boundary is eligible. It returns
to waiting automatically without a Continue action. Hard root loss ends the old
session; explicit page Device Lease reconnect creates a fresh auto-armed session.
Context/capture or analysis loss remains an Attempt failure. None of these device or
Attempt errors generically invalidates Environment qualification or navigates to Setup.

## Resources and Capability

The page Device Lease owns the root stream. The controller borrows it and owns its
fresh attempt AudioContext, metronome and runtime.
Microphone input borrows the stream/context and owns its analysis clone, capture
bridge, assembler and exclusive inference lease from the prepared workspace engine.
Initial input readiness requires an accepted physical
boundary and armed input. MIDI execution constructs no microphone resources.
Abandon/dispose await release; restart and mode/input changes wait for cleanup before
constructing a fresh owner. Owned resources are released once.

Both product modes support microphone analysis when the browser acoustic runtime
is available. Workspace Setup validates actual capture and warm recognition before
attempt binding; MIDI preparation is independent of acoustic requirements. The page
Device Lease acquires device roots. Each attempt borrows them and creates a fresh
context/capture/inference lease without model access, loading or Worker creation.
Physical-device recognition quality, permission UX and end-to-end latency require
separate qualification.

## Natural completion and End

Only SCOPE_COMPLETED opens the learning completion dialog, after cleanup and a
single onNaturalCompletion notification. MATCH and permitted Skip progression can
reach the scope terminal. STEP never creates a report or result.

End calls abandon(): it cancels the current gesture, retires the runtime, releases
input resources and discards the owner. It does not notify natural completion.
The hook resets to the pre-start ready state, without a pending verdict or elapsed
session. Continue practice creates a fresh identity on the same Device Lease. Input arriving after disposal
cannot revive the retired owner. A formally latched natural completion wins a later
End; End before that latch abandons the session.

STEP auto-arms on first page entry. End discards the attempt and leaves the Device Lease
open, waiting for Continue practice. Try Again starts directly. Scope/tempo edits while
READY or POST_VERDICT rebind a fresh attempt on the same devices; CAPTURING/ANALYZING
blocks edits. STEP has no initial Start or elapsed/recording timer. Leaving Practice
stops root devices; leaving the Practice layout also releases the warm environment.
