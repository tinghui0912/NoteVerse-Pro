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

The future microphone direction is:

```text
continuous microphone PCM
-> overlapping model-agnostic analysis chunks
-> one inference may evaluate multiple expected score groups
-> score-aware local verification / reconciliation
-> delayed live feedback for an already elapsed region
```

The product does not require sub-200 ms instant feedback. Accuracy has priority over feedback latency.

## Continuous Chunk Ownership

A future Continuous microphone chunk has two separate regions:

```text
input region:
  audio supplied to the acoustic model, including overlapping context

commit region:
  the non-overlapping performance-time interval whose ExpectedStrike verdicts
  this chunk is authorized to finalize
```

Chunk ownership applies to `ExpectedStrike` verdicts. It is not a requirement that a chunk generically transcribe every physical acoustic event in its interval.

A future model may emit generic pitch-by-time evidence, but the product queries and reconciles that evidence using known score pitches and known expected performance times. Expected timing remains approximate; legal early/late assignment windows still apply. One observed acoustic event must not satisfy multiple `ExpectedStrike`s.

The existing one-to-one reconciliation semantics remain valuable.

## Live and Final Evaluation

During performance, delayed chunk results may update live feedback for elapsed regions. After Stop or natural completion, a later full-performance or final analysis may become the canonical Review result.

The architecture must not assume live delayed feedback and final Review are produced by the same model or runtime.

## Explicit Non-Goals

Phase 9A does not implement microphone analysis, model-specific contracts, chunk inference, score following, OLTW, score-position estimation, or production microphone enablement.

Old rolling/fixed-cadence acoustic scheduling must not be restored as a fallback product path.
