# Disabled Continuous Acoustic Runtime

This is the sole Continuous acoustic path. Construction is internal; input capability
remains MODEL_NOT_VALIDATED. STEP remains ATTEMPT_ANALYZER_NOT_VALIDATED.

## Responsibilities

- model-contract: exact qualified core/model identities, fixed acoustic constants, errors.
- source-adapter: qualified 44.1k/48k float32 streaming FIR only; constant source ring.
- window-planner: per-segment half-open ownership and real 29120-sample inputs.
- model-inference / acoustic-worker / worker-client: exact asset verification, one ORT
  1.20.1 WebGPU session, sequential inference and explicit failure/disposal.
- acoustic-runtime: bounded scheduling and compact numeric diagnostics, not a scorer.
- capture-bridge / capture.worklet / capture: chronological source identity, strict
  credits/ACKs, analysis-only track ownership, externally supplied transport boundaries.
- publication: immutable model-agnostic ContinuousEvidencePublication projection.
- continuous-microphone-input (parent Practice boundary): sole publishAnalysis sink.

No acoustic module receives expected groups, score targets, BPM, cursor control or
verdicts. The product evaluator is unchanged. No backend execution or network fallback
exists. The asset endpoint delivers a separate, content-addressed exact ONNX; it is not
the historical ByteDance model endpoint. Model bytes are verified again in the Worker.

## Segment and Coverage Contract

Capture source samples are absolute within one sourceDomainId. Every external BEGIN
establishes a new semantic segment at the supplied performance coordinate. PAUSE closes
the performance-owned range; capture may continue as context only. A resumed segment
starts at that same performance coordinate, never filling pause with semantic silence.
Every input uses real context. The first full window needs 1050ms past plus the FIR
origin guard; very short final partial windows can require additional real past.
Insufficient context fails closed, with no padding.

The source-sample boundary is quantized to at most one capture sample relative to the
external clock. Acoustic analysis never drives that clock. Each segment has separate
window ownership, even if its real context overlaps adjacent segments or paused PCM.
At pause T the last publication covers previousFloat(T), not T. Only actual terminal
completion, after real tail and every job drains, emits empty exact-T coverage. It
asserts completion of [0,T), not an attack at T. Completion authority stays external.

## Resource Policy

Outstanding windows are capped at four before copying the next model input. A fifth
fails analysis explicitly; active/queued results cannot publish after failure. Capture
cleanup stops only its owned or cloned analysis tracks, never a borrowed recording.
Worker crashes while paused also invalidate analysis, without touching transport.

Persistent PCM: 65536 float32 target samples (262144 bytes), source ring512 bytes,
coefficients35284 bytes at44.1k or244 at48k. Four input copies total465920 bytes; one
structured-clone transport copy adds116480 bytes while a job is active. ORT tensors,
WebGPU allocation, JS object overhead and in-flight decode events are separate; this
is not an exact total heap bound. Worklet transport has32 credits of at most2048
float32 samples (262144 bytes payload). There is no full-session PCM persistence.

Diagnostics retain at most32 compact metadata records, zero publication event arrays;
512 bytes/record (16KiB) is a planning estimate, not a measured JS heap guarantee.
Pending segments cap at4 and externally scheduled boundaries at8; rapid control
overflow fails analysis rather than expanding retained state or delaying the clock.
Semantic observations are delivered synchronously once to product truth. A throwing
or Promise-returning sink fails analysis explicitly. No reentrant mutation is allowed.

The fixed resource ceilings are safety guards, not a product latency SLO. Historical
implementations are byte-archived outside the product tree with original revision,
Git blob IDs and SHA256 manifest; there is no runtime fallback or selector.
