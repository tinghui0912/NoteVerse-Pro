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

The attempt identity binds session, target, activation, source and attack time.
CAPTURING -> ANALYZING -> RESET -> READY permits at most one active attempt.
MISMATCH and RETRY preserve the target, recording complete immutable history.
MATCH advances once. Skip is a separate user action. Pause/Skip/Finish/Dispose
cancel timers and identities; Resume uses a new activation generation. Restart
disposes the old controller and constructs a new session and input owner.

The v2 schema has no old snapshot restore, WAIT attempt, compatibility export,
fallback evaluator, or rolling StepEvidenceSession. Full attempt/skip history is
limited to 100,000 total records: over 138 hours at one attempt per five seconds.
At the ceiling the session ends with an explicit error before acquiring another
attempt; history is not evicted. The gesture retains at most the MIDI pitch set
(128 physical keys), one timer and one identity; ignored-input diagnostics saturate.

MIDI disconnect invalidates capture, pauses the target and reports NO_CONNECTED_INPUT.
Resume requires an explicit command after reconnection. Cleanup detaches/disposes
input and destroys the metronome once before reporting completion.

Microphone start remains STEP_ANALYSIS_UNAVAILABLE; capability is
ATTEMPT_ANALYZER_NOT_VALIDATED. No model/FIR/Worker/Worklet/microphone permission is
reachable from STEP MIDI. Future score-blind fresh-strike evidence may open one
attempt while READY and share the sole Robust perception session; that detector,
attempt analyzer, and TOO_QUIET classifier are not implemented here.
