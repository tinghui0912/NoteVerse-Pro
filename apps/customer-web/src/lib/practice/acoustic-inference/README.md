# ByteDance Browser Acoustic Inference Boundary

This package is the shared browser-local inference boundary for future STEP and
CONTINUOUS practice. It does not implement live microphone capture,
AudioWorklet, model caching, or production model delivery.

## Model identity

- Model ID: `bytedance-piano-transcription-note-model`
- Model version: `CRNN_note_F1_0.9677_pedal_F1_0.9186`
- ONNX Runtime Web: `1.20.1`
- Required execution provider: `webgpu`
- Sample rate: 16 kHz mono PCM

The production ONNX binary is not committed here. The runtime consumes a
versioned manifest with model URL/path, expected byte size, SHA256, input/output
descriptors, preprocessing version, and decoder version.

The ORT runtime is intentionally pinned to `1.20.1`: a controlled same-machine
WebGPU A/B reproduced subsecond warm inference on 1.20.1 and a severe multi-
second regression on 1.30.0 for this exact fixed-anchor ONNX export.

## Input contract

The deterministic input is the fixed-anchor waveform validated in research:

- input tensor name: `audio`
- dtype: `float32`
- shape: `[1, 29120]`
- target anchor: 1600 ms
- future context: 220 ms

The model core is target-independent. It sees PCM only and produces generic
acoustic note evidence.

## Output descriptors

Output tensors are bound by name, never by array position:

- `reg_onset_output`
- `frame_output`

Both are interpreted as batch-1 matrices with 88 piano pitches, lowest MIDI
pitch 21, and 100 Hz frame timing.

## Worker lifecycle

The worker protocol is:

- `LOAD` -> `READY`
- `INFER` -> `RESULT`
- `DISPOSE` -> `DISPOSED`
- failures -> `ERROR`

The ONNX session is created once and reused. Concurrent inference is explicitly
rejected for deterministic ordering.

The browser construction boundary is
`createByteDanceBrowserWorkerClient()`, which creates a module Worker with
`new URL('./bytedance-worker.entry.ts', import.meta.url)`. This keeps the Worker
entry and `onnxruntime-web/webgpu` import visible to the frontend bundler.

## Timing

Physical attack time comes from capture/sample timing mapped into the frozen
`PracticeTimebase` session domain. Inference completion time is diagnostic only.

Fixed-anchor input construction permits left-side zero padding when the session
does not yet have 1000 ms of real lookback, but it never pads missing right-side
future context. A window is not ready until the full `+220 ms` future prefix is
captured.

## Event stream normalization

Per-window decoded events pass through `AcousticEventStreamNormalizer` before
STEP or CONTINUOUS consumption. It reuses the validated rolling verifier
identity rule:

- event identity is pitch + capture sample index;
- duplicate same-pitch events within `50 ms` are suppressed;
- same-pitch retriggers after that boundary are emitted as new attacks;
- inference completion time is not part of physical attack identity.

The decoder itself collapses adjacent above-threshold onset frames into one
peak event before stream normalization.

## Adapters

The STEP adapter converts generic acoustic events into a
`StepVerifierObservation` only when all expected physical attack pitches form one
fresh coherent post-activation gesture for the current target. STEP progression
remains owned by `StepPracticeRuntime`.

The CONTINUOUS adapter forwards the same generic acoustic evidence into the
existing Performance evaluator. The local Performance clock remains
authoritative.

## Reference fixtures

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

## Production Worker WebGPU smoke

The production-facing smoke must exercise the real Worker factory:

```bash
node apps/customer-web/scripts/bytedance-worker-webgpu-smoke.mjs \
  --model backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx \
  --fixture-dir backend/data/work/bytedance_browser_runtime_feasibility/golden_fixtures \
  --browser-channel chrome \
  --headed \
  --warm-runs 5 \
  --output backend/research/reports/bytedance_worker_webgpu_smoke_latest.json
```

The script recomputes the local model byte size and SHA256 before loading. It
uses `createByteDanceBrowserWorkerClient()`, so the Vite/Next-visible Worker
entry and `onnxruntime-web/webgpu` import are part of the browser bundle. The
older `backend/research/browser_runtime/bytedance_onnx_browser_harness.mjs`
remains useful as a direct ORT feasibility comparator, but it does not prove the
production Worker boundary.
