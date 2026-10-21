# Local Practice Domain

This directory owns pure product semantics. Browser resources, React, input
acquisition, model execution and network access belong to application adapters.
The backend supplies the canonical revision-bound `PracticeScoreArtifact`, including
score groups, physical attack targets, meter, tempo and render mapping.

## STEP

`StepPracticeRuntime` owns one target, one bounded attempt and one verdict.
READY -> CAPTURING -> ANALYZING -> POST_VERDICT permits one active attempt.
Finalization records MATCH / MISMATCH / RETRY; explicit rearm commits MATCH
progression and returns other verdicts to the same target. Skip is a separate
READY-only action. STEP waits for input and has no Pause/Resume lifecycle.

The domain compares physical attack pitches, excluding continuation pitches.
MIDI uses exact-set evaluation. Microphone uses conservative tri-state evaluation:
an exact set matches, a superset retries as UNCERTAIN, and other sets mismatch.
Explicit retry evidence retains its reason.

Identity binds session, step, target generation, input source and capture start.
Attempt start must be strictly later than `inputEligibleAfter`. Rearm accepts an
explicit finite, same-session, monotonic watermark. The application supplies
physical input retirement, including capture while busy. Busy evidence is discarded
and cannot satisfy another target. Unfinished attempts are cancelled on input loss
or Finish; finalized POST_VERDICT records retain their pending transition.

Domain status is ACTIVE / ENDED, with completion reason distinguishing scope
completion from user Stop. Application preparation and disposal belong to the
controller. Attempt/Skip history has a 100,000-record ceiling and fails explicitly
before accepting another record. See [STEP application](../step/README.md) for
input, lifecycle and resource ownership.

## Continuous

`PerformanceClockRuntime` owns fixed-tempo transport, count-in, pause/resume and
captured-time mapping. Segment arithmetic adds local deltas to exact anchors.
MIDI/acoustic evidence affects evaluation only; clock, playhead, BPM and scope
remain clock-owned.

`ContinuousEvaluationSession` constructs expected strikes.
`ContinuousEvidenceStore` validates immutable publications and monotonic coverage.
`assignContinuousEvidence` performs deterministic max-cardinality/min-error
one-to-one assignment. `ContinuousFinalizer` owns direct-claimant reservations and
immutable finalized results. Completion and Review project that same ledger.

The assignment window is +/-250ms. Non-recursive strike/group/EXTRA coverage
frontiers are bounded by +750/+1250/+1500ms; these are not wall-clock latency
guarantees. Each observation is MATCHED, WRONG or EXTRA at most once. Canonical
chord strikes share one expected group time. MIDI and microphone use one evaluator.

## Domain Inputs

The domain accepts canonical score artifacts, resolved scope/tempo, session-bound
capture times, generic bounded STEP evidence and immutable Continuous publications.
Capture event time is distinct from inference completion or publication availability.
`PracticeTimebase` maps source/session coordinates; the Continuous clock maps
performance coordinates. Score-blind acoustic inference and physical resource
ownership remain outside this directory.
