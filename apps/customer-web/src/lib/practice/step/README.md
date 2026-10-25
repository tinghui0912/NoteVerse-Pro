# STEP Application

`StepPracticeController` composes the pure domain and owns the application lifecycle,
selected MIDI/microphone input, metronome, cancellation and cleanup. React subscribes and
sends commands; its animation frame reads elapsed presentation time. STEP waits
for input and has no Pause/Resume lifecycle.

## Attempts and Verdicts

`domain/attempt.ts` owns attempt identity, immutable evidence/records, verdict
types and domain errors. `domain/runtime.ts` owns progression;
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
- `StepPracticeRuntime` alone compares physical attack pitch sets. Exact sets
  MATCH; other MIDI sets MISMATCH. A microphone superset produces RETRY/UNCERTAIN;
  other non-exact sets MISMATCH. Explicit retry evidence retains its reason.
  Continuation pitches are excluded. TOO_QUIET classification is not implemented.

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
