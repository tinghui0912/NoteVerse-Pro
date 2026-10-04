# ByteDance Continuous Microphone Feasibility Decision

Date: 2026-10-04T18:04:10.879070+00:00

Git HEAD: `e321e7296989b5262342e48c4a904bdadaf7556b`

Verdict: `INCONCLUSIVE`

Production state: `CONTINUOUS_ANALYSIS_UNAVAILABLE`

## Gate Criteria

The decision gate was defined before accepting any result as a PASS:

- Raw B=1 batch export parity must pass.
- Raw B=2/B=4/B=8 per-item parity must pass.
- A trusted output region must be demonstrated with stable event identity/timing, including repeated notes.
- Headed Chrome WebGPU effective unique trusted-audio throughput must be sustainably above realtime.
- 10-minute backlog simulation must not grow unbounded.
- No WASM or provider fallback is allowed.

## Blocking Evidence

- PyTorch checkpoint/export source is unavailable, so batch export parity cannot be executed.
- Available golden fixtures do not cover the required trusted-region dataset categories.

## Batch Export Parity

Status: `BLOCKED`

Reason: PyTorch checkpoint/export source is not available in this workspace; cannot generate a research-only [B,29120] ONNX export.

## Headed Browser Batch Benchmark

Status: `BLOCKED`

Reason: Batch benchmark requires a batch-capable ONNX export with raw parity first.

Historical single-window smoke summary is included in the JSON report for context only; it is not a batch benchmark.

## Trusted Region

Status: `BLOCKED`

Reason: Trusted-region experiment requires batch export parity and enough dev/cal audio windows covering positions across the model input.

Available golden fixture count: 3

## Backlog Simulation

Status: `BLOCKED`

Reason: Backlog simulation requires measured batch latency sequence and selected unique trusted-output duration.

## Decision

`INCONCLUSIVE` is the only defensible result because the batch export/parity gate could not be executed in this workspace. This does not pass ByteDance for Continuous microphone production, and it does not fail the model mathematically; it blocks production integration until the missing research inputs are provided and the gate is rerun.
