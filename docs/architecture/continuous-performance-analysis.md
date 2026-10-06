# Continuous Performance Analysis

Status: Historical Continuous analysis notes. Superseded for product/domain authority by [Practice Product Contract v2](./practice-product-contract-v2.md).

Date: 2026-10-03

## Superseded Scope

This document preserves historical research context and still describes useful Continuous evaluation mechanics such as score-clock ownership and one-to-one `ExpectedStrike` reconciliation. It is not the authoritative long-term Practice acoustic architecture.

Practice Product Contract v2 supersedes any reading that Continuous requires generic realtime transcription, a shared realtime physical-onset identity layer, a shared acoustic controller with STEP, or sub-200 ms live feedback. The current product direction is chunked, score-aware, delayed Continuous verification over expected score targets. STEP microphone is a separate bounded-attempt product flow and does not require a continuous generic onset stream.

Production microphone Practice remains disabled until later model gates and integration work explicitly enable it.

## Context

Continuous microphone feedback previously used a rolling ByteDance fixed-anchor path:

```text
150 ms rolling anchor
+ one active inference
+ latest pending coalescing
+ skipped anchors
+ 170 ms trusted absence interval
```

That design is rejected only for the old generic sliding-window transcription / trusted-region / one-owner Continuous architecture. The current headed Chrome WebGPU production-path evidence is committed at:

```text
backend/research/reports/bytedance_rolling_anchor_feasibility_2026-10-03.json
```

The important measured values were:

```text
duration                 15 s
completed inference      28
submitted anchor         29
skipped anchor           69
median worker            ~521.7 ms
p95 worker               ~728.2 ms
trusted coverage ratio   0.316
max coverage gap         1030 ms
500 ms fully covered     0 / 29 proxy windows
```

With that throughput, the old rolling path cannot provide gap-free generic transcription coverage for missing-note verdicts. Keeping that path as a fallback would make inference speed change musical correctness, which is not acceptable.

This historical verdict did not evaluate the newer score-aware target-verification question:

```text
known expected pitch set
+ known or candidate target time
+ PCM
-> target-local verifier decision
```

Current production microphone state remains unavailable until that shared target-verification gate is completed.

## Invariants

### Score Timeline

The score, resolved tempo plan, and resolved scope are the only source of truth for the expected performance timeline. Before performance starts, the domain can determine each expected strike:

```text
pitch
group
performanceTimeMs
renderNoteIds
```

Inference never decides when a note should have been played.

### Event Time

Model output must be matched to score by capture/performance event time. Callback time, worker completion time, and React render time can affect feedback presentation latency, but not the musical verdict.

### Inference Latency

Inference latency affects:

```text
feedback presentation latency
analysis backlog
finalization duration
```

It must not affect the final matched/missing/extra result for the same analyzed PCM.

### STEP Versus Continuous

STEP and Continuous are different product semantics but both have known expected pitches:

```text
STEP:
known current target
+ unknown physical performance time
+ candidate attack trigger time
-> target-local verification

Continuous:
known expected score targets
+ known expected performance times
-> scheduled target-local verification
```

The neural model remains score-independent:

```text
PCM -> raw acoustic evidence
```

The verifier layer reads score information:

```text
expected pitch set
target time
legal timing policy
```

STEP still needs a validated high-recall attack trigger before microphone production can be enabled. Continuous still needs a scheduled target-verification gate before microphone production can be enabled. Neither mode may use score following, OLTW, location estimation, or the old rolling scheduler.

## Historical Shared Target-Verifier Sketch

The following sketch was a research direction after the old generic transcription gate failed:

```text
Browser microphone PCM
  -> shared acoustic model raw evidence
  -> SharedAcousticTargetVerifier
       /                                \
STEP candidate attack time        Continuous expected score time
  -> StepEvidenceSession           -> ContinuousEvaluationSession
```

This sketch is now superseded as a product requirement. Practice v2 does not require STEP and Continuous to share one acoustic event stream, one neural model, one inference scheduler, or one high-level acoustic controller.

The current Continuous v2 direction is:

```text
continuous microphone PCM
  -> overlapping model-agnostic analysis chunks
  -> one inference may evaluate multiple expected score groups
  -> score-aware local verification / reconciliation
  -> delayed live feedback for an already elapsed region
```

Each future Continuous chunk has an input region supplied to the model and a separate non-overlapping commit region whose `ExpectedStrike` verdicts it may finalize. Chunk ownership applies to expected-strike verdicts, not generic transcription coverage. The production tree must not restore the old rolling scheduler as a fallback. Production microphone entry points remain disabled until their respective gates pass.

## PCM Boundaries

Production browser PCM capture is intentionally absent while microphone practice is disabled. A future integration phase should reintroduce a model-agnostic shared PCM capture boundary for STEP and Continuous together, not restore the old STEP-only or generic-transcription capture path.

For Continuous, normalized PCM is only valid while the performance runtime is RUNNING. COUNT_IN and PAUSED audio are ignored. Pause/resume creates separate analysis segments, so pre-pause and post-resume audio are not stitched into a single model context.

Performance media remains separate from analysis PCM:

```text
performance terminal
  -> freeze MediaRecorder / recording timebase
  -> stop performance media recording
  -> keep microphone capture only for analysis post-roll
```

Analysis post-roll is context-only. It never extends Performance media duration, PerformanceTake duration, replay duration, or recording timebase.

## Shared Target-Verifier Contract

The research contract should be shaped around target verification, not generic transcription:

```text
TargetVerificationRequest {
  expectedPitches
  targetTimeWithinInput
  legalEarlyMs
  legalLateMs
  pcm
}

TargetVerificationResult {
  expectedPitchEvidence
  completeExpectedSetPresent
  detectedOnsetOffsets
  confidence
}
```

The model input context, future context, and product timing tolerance are separate concepts. Long input context may add past musical context without increasing required user-facing future latency. Product assignment tolerance is an evaluation policy, not a model magic number.

The contract must pass:

```text
model gate: target-local correctness over dev/cal families
runtime gate: browser target-verification latency and throughput for score-target workload
```

If ByteDance cannot pass both gates, microphone STEP and Continuous remain unavailable for acoustic input. The old rolling path must not return as a fallback.

## Evaluation Semantics

Continuous evaluation is built around strike instances:

```text
ExpectedStrike {
  strikeId
  groupId
  pitch
  expectedPerformanceTimeMs
  renderNoteIds
}

ObservedAttack {
  observationId
  pitch
  performanceTimeMs
  confidence
  source
}
```

Matching is one-to-one:

```text
same pitch
and within legal assignment window
```

Each expected strike matches at most one observed attack, and each observed attack matches at most one expected strike. Extra notes are analyzed observed attacks that are not matched to any expected strike.

Successful natural completion produces complete deterministic evaluation. Manual stop may produce NOT_REACHED for future strikes that never had a full matching opportunity. Fatal analysis failure is an evaluation-level unavailable state, not hundreds of fake unconfirmed strikes.

## Provider Policy

Provider selection is explicit per session:

```text
webgpu
wasm
```

The selected provider is immutable for that session. No exception-based WebGPU-to-WASM fallback is allowed in Continuous analysis. Provider changes can affect throughput and latency diagnostics only, not model semantics.

## Persistence Boundary

CompletedPerformance can hold detailed transient evaluation for the current Review. PerformanceTake remains a durable media/source/scope/tempo/timebase record and must not persist:

```text
detailed strike evaluation
observations
transcription events
analysis queue state
diagnostics
annotation state
```
