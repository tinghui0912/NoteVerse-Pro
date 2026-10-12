# ByteDance Browser Acoustic Inference Boundary (Historical Candidate)

This package contains low-level browser acoustic inference components and
research fixtures for the historical ByteDance candidate. It is not the
authoritative Practice v2 acoustic architecture. The current product contract is
`docs/architecture/practice-product-contract-v2.md`.

The old rolling/fixed-anchor Practice product flow must not be restored as a
fallback product path. The useful parts here are low-level implementation
primitives:

- AudioWorklet PCM capture and source-sample identity helpers;
- deterministic preprocessing;
- ONNX/WebGPU session loading;
- raw tensor output descriptors;
- decoder behavior for generic pitch/time evidence;
- browser Worker protocol tests and compact reference fixtures.

Those primitives may be reused only if a future local acoustic runtime preserves
the browser-local fixed-clock Practice boundary. They must not create a backend
Practice runtime, score-following runtime, or clock-controlling acoustic path.

## Model Identity

- Model ID: `bytedance-piano-transcription-note-model`
- Model version: `CRNN_note_F1_0.9677_pedal_F1_0.9186`
- ONNX Runtime Web: `1.20.1`
- Sample rate: 16 kHz mono PCM

The production ONNX binary is not committed here. The runtime consumes a
versioned manifest with model URL/path, expected byte size, SHA256,
input/output descriptors, preprocessing version, and decoder version.

## Low-Level Input And Output Contract

The fixed-anchor research tensor is:

- input tensor name: `audio`
- dtype: `float32`
- shape: `[1, 29120]`
- target anchor: 1600 ms
- future context: 220 ms

Output tensors are bound by name:

- `reg_onset_output`
- `frame_output`

Both are interpreted as batch-1 matrices with 88 piano pitches, lowest MIDI
pitch 21, and 100 Hz frame timing.

The model sees PCM only and produces acoustic evidence only. It must never
control fixed BPM, playhead movement, scope, completion, or score position.

## Worker Lifecycle

The low-level Worker protocol is:

- `LOAD` -> `READY`
- `INFER` -> `RESULT`
- `DISPOSE` -> `DISPOSED`
- failures -> `ERROR`

The ONNX session is created once and reused. Concurrent inference is rejected
for deterministic ordering.

The browser construction boundary is
`createByteDanceBrowserWorkerClient()`, which creates a module Worker with
`new URL('./bytedance-worker.entry.ts', import.meta.url)`. This keeps the Worker
entry and `onnxruntime-web/webgpu` import visible to the frontend bundler.

## Timing Ownership

Physical event time comes from capture/sample timing mapped into the frozen
`PracticeTimebase` session domain. Inference completion time is diagnostic only.
Any future product integration must publish model-agnostic acoustic evidence
into the existing local Continuous evaluator; it must not move the local
`PerformanceClockRuntime`.

## Reference Fixtures

`__fixtures__/bytedance-python-reference-contract.json` is generated from the
existing non-frozen dev/cal PyTorch golden fixture under
`backend/data/work/bytedance_browser_runtime_feasibility/golden_fixtures`.
Those research artifacts are local and gitignored; materialize them first with
the existing backend feasibility workflow before regenerating the checked
compact contract fixture.

Regenerate it with:

```bash
node apps/customer-web/scripts/generate-bytedance-reference-contract-fixture.mjs
```

It stores source tensor hashes, raw output shapes, and the minimal local raw
values needed to lock the validated temporally-bound event interpretation.

## Production Worker WebGPU Smoke

The browser Worker smoke exercises the real Worker factory:

```bash
node apps/customer-web/scripts/bytedance-worker-webgpu-smoke.mjs \
  --model backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx \
  --fixture-dir backend/data/work/bytedance_browser_runtime_feasibility/golden_fixtures \
  --browser-channel chrome \
  --headed \
  --warm-runs 5 \
  --output backend/research/reports/bytedance_worker_webgpu_smoke_latest.json
```

This proves low-level Worker/runtime wiring only. It does not prove product
microphone eligibility.
