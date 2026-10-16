# Practice Product Contract v2

Status: Authoritative product/domain contract for future Practice architecture. Historical research reports remain preserved as evidence for the questions they actually tested, but they do not override this contract.

## Global Product Boundaries

Practice has two product modes: `STEP_BY_STEP` and `CONTINUOUS_PLAY`.

They may share low-level infrastructure such as `PracticeScoreArtifact`, score scope, resolved tempo, timebase primitives, MIDI primitives, microphone capture primitives, metronome primitives, and user recording primitives. They do not need to share one neural model, one acoustic event stream, one inference scheduler, or one high-level acoustic controller.

Recording and input source are orthogonal. User-selected audio or video recording is a media artifact for review. Analysis capture is PCM used by an acoustic analyzer. A future session may record media without performing acoustic analysis, or analyze PCM without producing user recording media. MediaRecorder output is not the canonical analysis PCM source.

Production microphone Practice remains disabled until a later model gate and integration phase explicitly validates and enables the relevant mode.

## Offline-First Practice Execution Boundary

The active Practice execution boundary is browser-local:

```text
Backend while data is available
-> PracticeScoreArtifact + practice-ready score content
-> Customer Web local runtime
-> Practice execution
```

The backend owns canonical score/source/artifact delivery. It is not the live
Practice execution authority. After the required score assets are loaded, an
active Practice session must not require a Practice WebSocket, backend Practice
session runtime, backend clock synchronization, Matchmaker, score-following, or
continuous network availability.

`PerformanceClockRuntime` is browser-local. Losing network connectivity after
the required score assets are loaded must not stop an already active Practice
session. This is a session execution guarantee, not a cold-start guarantee:
cold-start fully offline availability would require separately validated
persisted score assets and application caching.

Generic application realtime/SSE notifications are orthogonal to Practice. They
may invalidate score metadata, derived assets, notifications, or import-job
state, but they are not a Practice transport and are not allowed to drive the
Practice clock, playhead, scope, or verdicts.

Future microphone acoustic analysis must preserve this offline/local execution
boundary unless a future explicit product decision changes it. A model is not
production-eligible for Offline-First Practice merely because a Docker/GPU
benchmark is strong. Production eligibility requires a validated local/browser
execution path, or another explicitly approved architecture that preserves this
boundary. Server-only Robust CUDA, Online-AMT, RTT, or Transkun runtimes may
remain scientific or research candidates, but they are not automatically
production-eligible.

## STEP_BY_STEP v2

STEP is correctness-driven. STEP has no performance clock.

The future microphone product contract is a bounded attempt lifecycle:

```text
Target
-> READY
-> CAPTURING one bounded attempt
-> ANALYZING
-> MATCH / MISMATCH / RETRY_TOO_QUIET / RETRY_UNCERTAIN
-> RESET
-> READY
```

Only audio that belongs to an accepted attempt has Practice semantics. Audio played while the UI is in `ANALYZING` is not silently reassigned to another STEP target.

Future microphone STEP architecture must not require a continuous generic physical-onset stream. Same-note identity across different STEP targets does not need to be solved by a global realtime onset stream because attempt boundaries are the product boundary.

MIDI STEP may remain immediate and may provide better timing fidelity than microphone STEP. The future microphone attempt analyzer is intentionally out of scope for Phase 9A.

## CONTINUOUS_PLAY v2

Continuous is tempo-clock practice. It is not score-following.

The authoritative Continuous position is deterministic:

```text
PracticeScoreArtifact
+ resolved tempo/BPM
+ resolved scope
+ Start
+ pause/resume clock semantics
-> performanceTime / musicalBeat / playhead
```

User acoustic or MIDI correctness evidence must never move the playhead, change BPM, seek the score, estimate score position, or change the performance clock. If the user plays early, late, slowly, or misses notes, that becomes timing and correctness evidence. The clock does not follow the player.

Audio-only neural inference and decoding produce immutable physical acoustic observations.
Expected score is available only to the downstream deterministic product evaluator.
MIDI and acoustic sources publish into the same model-agnostic evidence contract;
there is exactly one Continuous evaluator, with no policy selector or fallback.

## Analyzer Strategy Geometry

Acoustic windowing and product finalization have separate ownership:

```text
input region:
  audio supplied to the acoustic model, including overlapping context

acoustic owned region:
  a half-open interval authorizing physical acoustic observation publication
  (not expected-score verdict finalization)
```

The deterministic evaluator consumes immutable observations after inference. Acoustic
window width is not semantic commit width, and inference never receives score targets.

## Analysis PCM Timeline

Analysis PCM capture is a source timeline, not a performance clock. Captured PCM carries source sample identity, including the native source sample rate and source sample indexes. One PCM capture timeline owns one monotonic source-sample identity domain. Source sample ranges are half-open: `[sourceStartSampleIndex, sourceEndSampleIndex)`.

Performance time is derived only for samples that belong to a `RUNNING` segment by anchoring that segment to deterministic performance time. Running segments must not overlap in performance time. A gap between running segments represents missing or unretained analysis PCM, not implicit silence.

Pause and resume create separate acoustic source segments. Paused wall-clock audio is not Continuous performance evidence time, and future acoustic analyzers must not silently bridge a pause as one uninterrupted model stream. A chunked analyzer may request PCM from one running segment with retained context, and a streaming analyzer may reset its model state at segment boundaries; both still publish into the same evaluation/finalization contract after producing evidence.

Context-only PCM may be retained after the canonical performance-owned samples of a segment for future model input. Context-only samples consume source sample identity but do not extend performance duration, do not create performance-time ownership, do not move the playhead, and do not advance evaluation coverage by themselves.

## One Evaluation Truth

A Continuous performance has exactly one accumulated evaluation truth.

```text
performance starts
-> evidence is analyzed incrementally
-> eligible results become FINALIZED
-> finalized results power delayed live feedback
-> the same finalized results accumulate
-> Stop / natural completion
-> drain only unfinished tail work
-> CompletedContinuousEvaluation
-> Review displays the same accumulated finalized truth
```

Live delayed feedback consists of finalized portions of that one truth. Finalized results are immutable product truth: a result shown to the user as finalized during performance must not later change simply because Review was opened.

The product-domain evaluator owns the finalized ledger and the analysis coverage watermark. Evidence publications may be delayed by analyzer latency, but coverage only means the evidence source has completed analysis through an inclusive performance-time frontier. Once coverage has been declared through time `T`, genuinely new evidence at or before `T` is late and must fail closed; only exact idempotent replays of already-known evidence are allowed. The frontier is not the playhead, and it does not move the performance clock.

At Stop or natural completion, each evidence source drains only its unfinished tail work. MIDI has no asynchronous acoustic inference pass, so after MIDI input is safely closed for the performance it may close coverage through the completion performance time. Microphone analyzers must instead wait for their own source-specific unfinished analysis work to publish coverage.

### Bounded Assignment and Finalization

The assignment window is fixed at inclusive +/-250ms. Same-pitch matching maximizes
cardinality, then minimizes total absolute timing error, with stable identity ties.
Observation array order does not select a different semantic owner.

For a strike at time t, its literal same-pitch direct cohort contains strikes u with
|u-t| <=500ms. Its fixed commit frontier H(t)=max(u+250ms) is at most t+750ms.
Only the eligible anchor is committed; future cohort members participate as reversible
reservation competitors, not prematurely finalized owners.

A group shares one canonical time projected from expectedPracticeGroup.onsetBeat.
It does not use a chord-spread tolerance. Missing-group WRONG evidence waits for each
literal correct claimant's own fixed strike frontier, never that claimant's group
completion. Group frontier is at most group time+1250ms. EXTRA waits for its literal
correct and local WRONG claims only, at most observation time+1500ms.

Reservations do not recursively expand. Transitive connected-component waiting is
prohibited. These analysis-frontier bounds are not wall-clock latency guarantees or
a product UX SLO. Publication/compute delay can delay availability independently.

### Immutable Evidence and Product Truth

A publication has publicationId, sessionDomainId, analyzedThroughPerformanceMs,
availabilityTimeMs and observations. Each observation has an immutable observationId,
pitch, performanceTimeMs, confidence and MIDI/ACOUSTIC source, with optional typed
source-sample provenance. Availability is never interpreted as attack time.
An exact duplicate publication is idempotent; mutated publication IDs, duplicate
observation IDs, non-monotonic coverage and genuinely late new evidence fail closed.

Strike states are PENDING, MATCHED, MISSING, NOT_REACHED. MATCHED retains the complete
observation and timing offset. Group verdicts are PENDING, CORRECT, MISSING, WRONG,
INCOMPLETE_CHORD, NOT_REACHED. CORRECT means all required strikes matched; WRONG
requires missing strikes and legally assigned incompatible evidence. Without WRONG
evidence, no matches means MISSING, and a partial multi-strike group means
INCOMPLETE_CHORD. Manual-stop targets outside complete legal coverage are NOT_REACHED.

Each observation has at most one semantic owner: MATCHED(strike), WRONG(group), or
EXTRA(observation). Reservation is not ownership. Complete chords are not changed to
WRONG by unrelated extras. Finalized groups and extras are immutable, including on
completion and Review. Natural terminal clamps carry explicit finality witnesses;
manual stop preserves NOT_REACHED. No reservation remains at terminal closure.

CompletedContinuousEvaluation stores finalized groups with nested strike/match
metadata, WRONG observations, extras, ownership, and completion semantics. It has no
parallel flat-strike truth. Review projects this accumulated result without matching
again. Pause wall time is excluded by PerformanceClockRuntime before publication;
the evaluator neither owns pause segments nor changes the clock.

There is no second whole-performance inference pass for the same Continuous performance evaluation. The canonical evaluation for a performance is the accumulated immutable finalized result produced incrementally during that performance.

Stop or natural completion drains unfinished tail work only. Previously finalized regions are never re-inferred as part of completing the performance or opening Review. Review displays the same accumulated finalized truth.

A future, separately designed user-requested reanalysis of an old recording is out of scope and is not part of this performance lifecycle.

## Explicit Non-Goals

Phase 9A does not implement microphone analysis, model-specific contracts, chunk inference, score following, OLTW, score-position estimation, or production microphone enablement.

Old acoustic scheduling must not be restored as a fallback product path. The disabled
Continuous acoustic implementation has one explicit 600ms half-open ownership planner;
its cadence is not score following or semantic verdict commit width.

## Disabled Continuous Acoustic Boundary

The sole acoustic path is `acoustic-inference/continuous`. It accepts PCM and external
source/performance segment boundaries, never expected score. It delivers only immutable
`ContinuousEvidencePublication` through `ContinuousPracticeSession.publishAnalysis`.
The existing finalizer, completion and Review truth are unchanged.

Pause closes a half-open performance segment. Paused source PCM may provide real
context but owns no performance time, observation or coverage. Resume resets semantic
window ownership at the external performance coordinate. Source samples remain
chronological across segments. At pause T, coverage remains below T; only actual
Stop/natural terminal, after real tail and inference drain, publishes empty exact-T
coverage for the completed [0,T) domain. This does not manufacture an event at T.

Acoustic failure invalidates analysis only. It cannot pause/stop/seek the clock or
change tempo; it cannot stop a recording track owned elsewhere. Model download may
need network at cold start, but loaded active execution is browser-local. Only the
qualified 44.1k/48k source adapters are accepted. There is no automatic provider/model
fallback, unbounded PCM retention, unlimited inference queue or full-event diagnostic
ring. Continuous microphone remains MODEL_NOT_VALIDATED; STEP remains
ATTEMPT_ANALYZER_NOT_VALIDATED. This boundary does not enable either product input.
