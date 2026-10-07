# Practice Product Contract v2

Status: Authoritative product/domain contract for future Practice architecture. Historical research reports remain preserved as evidence for the questions they actually tested, but they do not override this contract.

## Global Product Boundaries

Practice has two product modes: `STEP_BY_STEP` and `CONTINUOUS_PLAY`.

They may share low-level infrastructure such as `PracticeScoreArtifact`, score scope, resolved tempo, timebase primitives, MIDI primitives, microphone capture primitives, metronome primitives, and user recording primitives. They do not need to share one neural model, one acoustic event stream, one inference scheduler, or one high-level acoustic controller.

Recording and input source are orthogonal. User-selected audio or video recording is a media artifact for review. Analysis capture is PCM used by an acoustic analyzer. A future session may record media without performing acoustic analysis, or analyze PCM without producing user recording media.

Production microphone Practice remains disabled until a later model gate and integration phase explicitly validates and enables the relevant mode.

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

The product-domain evaluator owns the finalized ledger and the analysis coverage watermark. Evidence publications may be delayed by analyzer latency, but coverage only means the evidence source has completed analysis through a performance-time frontier. The frontier is not the playhead, and it does not move the performance clock.

Finalization must respect one-to-one assignment conflicts. Same-pitch expected strikes whose legal assignment windows overlap, directly or transitively, can compete for the same observed evidence; those results are finalized only when the relevant safe assignment set is closed by analysis coverage or completion semantics. A strike reaching its individual late deadline is not by itself sufficient to freeze `MATCHED` or `MISSING` when overlapping same-pitch opportunities remain unresolved.

There is no second whole-performance inference pass for the same Continuous performance evaluation. The canonical evaluation for a performance is the accumulated immutable finalized result produced incrementally during that performance.

Stop or natural completion drains unfinished tail work only. Previously finalized regions are never re-inferred as part of completing the performance or opening Review. Review displays the same accumulated finalized truth.

A future, separately designed user-requested reanalysis of an old recording is out of scope and is not part of this performance lifecycle.

## Explicit Non-Goals

Phase 9A does not implement microphone analysis, model-specific contracts, chunk inference, score following, OLTW, score-position estimation, or production microphone enablement.

Old rolling/fixed-cadence acoustic scheduling must not be restored as a fallback product path.
