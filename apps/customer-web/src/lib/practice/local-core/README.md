# Offline-First Local Practice Core

Pure product domain only: no React, browser MIDI, AudioContext, AudioWorklet,
Worker, WebGPU, ONNX, model assets, network or microphone infrastructure.

`PracticeScoreArtifact` comes from the canonical backend score producer. It is
the shared revision-bound score/group/physical-attack/meter/tempo/render contract;
the browser does not parse MusicXML independently for active Practice authority.

## STEP

One target / one bounded attempt / one verdict. `step-attempt.ts` defines the
immutable target generation, attempt identity, generic finalized evidence, retry
reason, finalized record and separate user Skip action. `StepPracticeRuntime`
alone compares exact physical attack pitch sets, excluding continuation pitches.

READY -> CAPTURING -> ANALYZING -> MATCH / MISMATCH / RETRY -> RESET -> READY.
Only MATCH advances; MISMATCH and RETRY record/stay. No WAIT verdict, rolling
pending acoustic store, cross-target scan or partial-pitch accumulation exists.
One active attempt maximum. STEP waits and has no Pause/Resume. Input loss,
Skip and Finish invalidate unfinished attempts without verdicts. Restart is a fresh session. Late
results cannot cross session, target, generation or attempt identity.
The input boundary is exclusive (`attemptStart > inputEligibleAfter`). All
verdicts set the initial reset boundary to the finalized capture end. Explicit
`rearm(acceptAfterSessionTime)` advances it monotonically from ACTIVE/RESET only;
the caller supplies finite same-session input coverage, never implicit now.
MIDI uses capture end. Future microphone callers must supply authoritative
physical capture/session time through which input has occurred while busy,
not an analysis frontier or publication time. No busy audio is replayed after
reset. Equality is rejected, including readiness/reconnect/Skip boundaries.
MIDI gesture ownership is [start,end); its 35ms is not acoustic grouping policy.

The clean-break v3 STEP schema is `step-waiting-attempt-v3`; no older STEP snapshot
parser remains. Full attempt/Skip history stops explicitly at 100,000 records,
never silently evicts. See `../step/README.md` for application resource policy.

`StepPracticeController` owns application lifecycle and the fixed 35ms MIDI gesture
assembler. Generic Browser MIDI knows no target. React only commands/subscribes.
Microphone analysis/fresh-strike detection is not implemented. Its future generic
attempt facts must use this same pure domain, not a second progression runtime.

## Continuous

Continuous is fixed-tempo clock practice, not score following. The independent
`PerformanceClockRuntime` owns transport, count-in, pause/resume and captured-time
mapping. Segment arithmetic is anchor + local delta, preserving exact resume
identity. Acoustic/MIDI evidence cannot move clock/playhead/BPM/scope.

`ContinuousEvaluationSession` constructs canonical expected strikes.
`ContinuousEvidenceStore` validates immutable publications and monotonic coverage.
`assignContinuousEvidence` performs deterministic max-cardinality/min-error
one-to-one assignment. `ContinuousFinalizer` owns fixed direct-claimant reservation
and immutable truth. `completedContinuousTruth` projects that same accumulated
truth into completion and Review, never re-evaluating a whole performance.

The assignment window is +/-250ms; non-recursive strike/group/EXTRA analysis
frontiers are bounded by +750/+1250/+1500ms. Transitive connected-component waiting
is prohibited. Reservation is reversible eligibility, not ownership; an observation
is MATCHED, WRONG or EXTRA at most once. Canonical chord strikes share one expected
group time. These analysis-frontier bounds are not a wall-clock latency SLO.

Completion contains canonical groups/nested strikes/WRONG evidence/extras/ownership,
not a parallel legacy result. MIDI and microphone use the sole evaluator.

## Evidence and Browser Boundary

Capture event time is never inference completion time. `PracticeTimebase` maps
source/session domains; Continuous performance mapping is clock-owned. Domain
records are local application/completion contracts, not server execution protocols.

The one shared score-blind acoustic foundation is `../acoustic/{model,source,runtime}`.
Only `../acoustic/continuous` projects source observations into performance evidence.
No browser acoustic module is imported here. Both microphone capabilities remain
disabled; STEP MIDI loads no acoustic assets. Backend serves immutable assets only.
