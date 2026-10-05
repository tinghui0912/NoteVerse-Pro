# Continuous Performance Analysis

Status: Accepted for the pre-release continuous microphone rewrite.

Date: 2026-10-03

## Context

Continuous microphone feedback previously used a rolling ByteDance fixed-anchor path:

```text
150 ms rolling anchor
+ one active inference
+ latest pending coalescing
+ skipped anchors
+ 170 ms trusted absence interval
```

That design is rejected for Continuous absence analysis. The current headed Chrome WebGPU production-path evidence is committed at:

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

With that throughput, the old rolling path cannot provide gap-free trusted coverage for missing-note verdicts. Keeping it as a fallback would make inference speed change musical correctness, which is not acceptable.

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

### No Dropped Analysis

Continuous analysis must not permanently discard unanalyzed performance audio for low latency. If analysis is slower than capture, queue lag grows and feedback appears later. Audio regions do not become unconfirmed merely because an old scheduler skipped them.

### STEP Versus Continuous

STEP and Continuous are different product semantics. They may share browser PCM capture, resampling, fixed-window preprocessing, decoder, and timebase primitives, but they must not share a high-level controller or acoustic model adapter that mixes:

```text
STEP target-local verification
Continuous performance-time transcription
Continuous reconciliation
```

STEP may use a target-local verifier only behind a validated event-time attack trigger. Continuous requires a transcription pipeline over performance-aligned PCM. ByteDance is rejected for Continuous microphone; its target-local STEP classifier remains only a candidate until the live STEP trigger and scheduling path are revalidated.

## Target Pipeline

Continuous microphone analysis is:

```text
Browser microphone
  -> BrowserPcmCapture
  -> 16 kHz mono normalized PCM
  -> PerformancePcmTimeline
  -> ContinuousChunkPlanner
  -> ContinuousTranscriptionQueue
  -> ContinuousTranscriptionModel
  -> owned timestamped ObservedAttack events
  -> PerformanceReconciler
  -> live feedback projection
  -> CompletedPerformance
```

The production tree must not contain a second rolling Continuous path after this rewrite.

## PCM Boundaries

`BrowserPcmCapture` is model-agnostic. It owns getUserMedia, AudioContext, AudioWorklet, source continuity, resampling, lifecycle, and capture errors. It does not know about ByteDance, scores, STEP targets, Continuous evaluation, coverage, annotation, or MediaRecorder.

`PerformancePcmTimeline` accepts normalized PCM only while the performance runtime is RUNNING. COUNT_IN and PAUSED audio are ignored. Pause/resume creates separate analysis segments, so pre-pause and post-resume audio are not stitched into a single model context.

Performance media remains separate from analysis PCM:

```text
performance terminal
  -> freeze MediaRecorder / recording timebase
  -> stop performance media recording
  -> keep microphone capture only for analysis post-roll
```

Analysis post-roll is context-only. It never extends Performance media duration, PerformanceTake duration, replay duration, or recording timebase.

## Continuous Model Contract

Continuous requires an explicit `ContinuousTranscriptionContract` that centralizes:

```text
sampleRateHz
inputSamplesPerWindow
trustedOutputStartSamples
trustedOutputEndSamples
futureContextSamples
batchSize
```

The planner owns window sequencing. The contract does not declare an unused
stride field; if future model research proves a separate ownership geometry is
needed, the contract must add that field with matching runtime use and tests.

The contract must pass two gates:

```text
model gate: trusted output semantics are supported by dev/cal evidence
runtime gate: selected provider and batch throughput exceed capture production rate with headroom
```

If ByteDance cannot pass both gates, microphone Continuous is explicitly unavailable. The old rolling path must not return as a fallback.

## Queue Semantics

The Continuous planner must not drop windows. Slow inference creates backlog:

```text
capturedThroughPerformanceMs
analyzedThroughPerformanceMs
analysisLagMs
queuedBatchCount
```

Jobs are published in performance order. A later completed job cannot advance analyzed frontier past an earlier pending job.

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

