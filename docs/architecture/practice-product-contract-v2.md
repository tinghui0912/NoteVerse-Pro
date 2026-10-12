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

Future microphone analysis must publish into one model-agnostic Continuous evaluation/finalization contract. The product contract is strategy-neutral; future model selection will decide the execution strategy empirically.

Two future candidate strategies are:

```text
chunked score-aware analyzer:
  continuous microphone PCM
  -> overlapping model input chunks
  -> one inference can evaluate multiple expected score groups
  -> commit/finalization region
  -> evaluation
```

```text
stateful streaming analyzer:
  continuous microphone PCM
  -> stateful streaming acoustic inference
  -> chronological acoustic evidence
  -> evaluation/finalization frontier
  -> evaluation
```

There must not be separate product evaluators for chunked and streaming implementations. Correctness and product-level evaluation accuracy are the primary selection criteria. After correctness is acceptable, secondary criteria include feedback age, throughput, CPU/GPU/memory cost, browser compatibility, and implementation complexity.

Do not assume streaming is better because it is lower latency. Do not assume chunked analysis is better because it uses more context. Accuracy has priority over immediate feedback, and the product does not require sub-200 ms instant feedback.

## Analyzer Strategy Geometry

The chunked candidate has two separate regions:

```text
input region:
  audio supplied to the acoustic model, including overlapping context

commit region:
  the non-overlapping performance-time interval whose ExpectedStrike verdicts
  this chunk is authorized to finalize
```

For the chunked candidate, commit ownership applies to `ExpectedStrike` verdicts. It is not a requirement that a chunk generically transcribe every physical acoustic event in its interval.

The stateful streaming candidate does not impose chunk input/commit geometry. It instead advances an evaluation/finalization frontier from chronological acoustic evidence. It must still publish into the same Continuous evaluation/finalization contract.

A future model may emit generic pitch-by-time evidence, but the product queries and reconciles that evidence using known score pitches and known expected performance times. Expected timing remains approximate; legal early/late assignment windows still apply. One observed acoustic event must not satisfy multiple `ExpectedStrike`s.

The existing one-to-one reconciliation semantics remain valuable.

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

Finalization must respect one-to-one assignment conflicts. Same-pitch expected strikes whose legal assignment windows overlap, directly or transitively, can compete for the same observed evidence; those results are finalized only when the relevant safe assignment set is closed by analysis coverage or completion semantics. A strike reaching its individual late deadline is not by itself sufficient to freeze `MATCHED` or `MISSING` when overlapping same-pitch opportunities remain unresolved.

There is no second whole-performance inference pass for the same Continuous performance evaluation. The canonical evaluation for a performance is the accumulated immutable finalized result produced incrementally during that performance.

Stop or natural completion drains unfinished tail work only. Previously finalized regions are never re-inferred as part of completing the performance or opening Review. Review displays the same accumulated finalized truth.

A future, separately designed user-requested reanalysis of an old recording is out of scope and is not part of this performance lifecycle.

## Explicit Non-Goals

Phase 9A does not implement microphone analysis, model-specific contracts, chunk inference, score following, OLTW, score-position estimation, or production microphone enablement.

Old rolling/fixed-cadence acoustic scheduling must not be restored as a fallback product path.
