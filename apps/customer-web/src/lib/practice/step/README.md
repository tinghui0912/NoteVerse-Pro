# STEP Application

STEP is one target / one bounded attempt / one verdict. It has no Continuous
performance clock, streaming evidence store, or transitive finalizer.

- `StepPracticeController` is the sole application owner. It composes the pure
  domain, generic browser MIDI input, gesture assembler and STEP metronome.
- `StepMidiAttemptInput` opens at the first NOTE_ON while READY and closes the
  complete fixed 35ms gesture. It knows no target pitches. No early acceptance,
  timer extension, cross-attempt pitch bag, or busy-input queue is allowed.
- `StepPracticeRuntime` alone compares exact physical attack pitch sets and
  produces MATCH / MISMATCH / RETRY. Continuation pitches are not attack targets.
- React constructs/subscribes/commands the controller; its animation frame only
  reads elapsed presentation time.

STEP waits for user input; it has no Pause/Resume lifecycle or commands.
ANALYZING is backpressure, not transport pause. Input unavailability is not Pause.
The attempt identity binds session, targetGeneration, source and attack time.
Input eligibility is exclusive: attempt start must be strictly later than
inputEligibleAfter at readiness/reconnect/skip or the prior gesture end. An event at
the exact gesture end is ignored regardless of whether it precedes or follows
the close callback; there is no timestamp adjustment, deferral or queued retry.
Controller application/resource lifecycle (`StepControllerState`) is
IDLE / PREPARING / ACTIVE / ENDED / DISPOSED. It is not a domain session status.
Runtime domain status is only ACTIVE / ENDED (`StepRuntimeStatus`), constructed
ACTIVE even while its controller is PREPARING. Runtime snapshots serialize
`runtimeStatus` plus completionReason, not application lifecycleState.
`localSessionId` remains a local practice-instance identity, not a backend,
WebSocket/matchmaker session, server authority or transport identity.
The hook exposes applicationState and runtimeStatus distinctly. Its generic UI
`lifecycle` property is application presentation only, not runtime status.
READY -> CAPTURING -> ANALYZING -> POST_VERDICT permits at most one active attempt.
POST_VERDICT retains the answered target and a finalized pending transition.
Only re-arm consumes it: MATCH advances target atomically with READY; a final
MATCH completes the scope there. Snapshot readiness is derived, never hook-owned.
Re-arm requires an explicit same-session monotonic accepted-input watermark.
The controller requests it from `StepRetirementPolicy`. MIDI uses current session
time at the READY transition, with zero minimum technical delay and no extra timer.
Future microphone input must use authoritative physical capture/session time
through which input has already occurred, not the analysis frontier, Worker
completion or publication availability. No busy evidence may open a later attempt.
The fixed MIDI policy is STEP_MIDI_CHORD_COHERENCE_MS=35. Native MIDI event
timestamps, not callback arrival time, define capture/session time. The 35ms
constant is MIDI-only, not an acoustic assembler or decoder timing tolerance.
MISMATCH and RETRY preserve the target, recording complete immutable history.
MATCH advances once at re-arm. Skip is a READY-only separate user action.
Input loss/Finish/Dispose cancel unfinished timers and identities without fabricated verdicts.
Input loss preserves finalized POST_VERDICT ownership; reconnect first establishes
a fresh watermark, then the controller commits the preserved transition once. Restart
disposes the old controller and constructs a new session and input owner.

The v5 snapshot schema removes lifecycleState in favor of runtimeStatus, with no
compatibility alias or old snapshot restore. V12 v4 historical evidence stays
unchanged; its paced attempt semantics are unchanged here. There is no WAIT attempt, compatibility export,
fallback evaluator, or rolling StepEvidenceSession. Full attempt/skip history is
limited to 100,000 total records: over 138 hours at one attempt per five seconds.
At the ceiling the session ends with an explicit error before acquiring another
attempt; history is not evicted. The gesture retains at most the MIDI pitch set
(128 physical keys), one timer and one identity; ignored-input diagnostics saturate.

MIDI disconnect invalidates capture and reports NO_CONNECTED_INPUT, retaining the
same target/session and MIDIAccess owner. Reconnection automatically establishes
a fresh capture-time eligibility boundary without a Resume command. Cleanup detaches/disposes
input and destroys the metronome once before reporting completion.

Microphone start remains STEP_ANALYSIS_UNAVAILABLE; capability is
ATTEMPT_ANALYZER_NOT_VALIDATED. No model/FIR/Worker/Worklet/microphone permission is
reachable from STEP MIDI. Future acoustic input must share this semantic runtime,
continue capture without Pause/Resume, and supply physical capturedThrough after
its retirement condition. MICROPHONE_POST_VERDICT_MINIMUM_NOT_YET_ENGINEERING_QUALIFIED:
no microphone duration is selected. H50 is only within-gesture grouping, not a cooldown.
No RMS, flux or second strike detector is added. TOO_QUIET classification is not implemented.
