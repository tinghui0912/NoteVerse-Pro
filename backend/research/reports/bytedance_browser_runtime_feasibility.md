# ByteDance note_model Browser Runtime Feasibility

Date: 2026-09-13

Scope: research only. This pass does not change production STEP progression,
does not connect real microphone input, does not modify Matchmaker, does not
touch the frozen evaluation set, and does not tune the frozen `0.2 / 0.2`
verifier.

## Trigger Research Status

Handcrafted RMS/flux causal trigger research is stopped for now:

```text
handcrafted RMS/flux causal trigger
= no robust candidate selected

trigger remains an unresolved runtime component
```

The work below only evaluates whether the frozen fixed-anchor ByteDance
`note_model` can plausibly run in a browser/frontend runtime once some future
runtime trigger provides a candidate timestamp.

## Model Audit

Source artifact:

- Policy: `backend/research/policies/step_microphone_bytedance_v1.json`
- Checkpoint SHA256: `c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141`
- Local checkpoint used in research container:
  `/app/models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth`

The `note_model` is:

```text
piano_transcription_inference.models.Regress_onset_offset_frame_velocity_CRNN
```

It contains:

- `torchlibrosa.stft.Spectrogram`
- `torchlibrosa.stft.LogmelFilterBank`
- CNN/CRNN acoustic branches
- GRU layers
- output heads for onset, offset, frame, and velocity

For NoteVerse verification, only these raw outputs are used:

```text
reg_onset_output
frame_output
```

The model has `24,651,903` parameters. The estimated fp32 parameter bytes are
`98,607,612`. The original checkpoint is `171,966,578` bytes, while the fixed
shape ONNX export produced in this pass is `98,691,493` bytes.

Fixed-anchor input/output shape:

```text
input waveform:      (1, 29120) float32
sample rate:         16kHz mono
target anchor:       1600ms
future:              220ms
normal duration:     1820ms

reg_onset_output:    (1, 183, 88)
frame_output:        (1, 183, 88)
```

## Golden Fixtures

Fixtures were selected from development/calibration manifests only, never from
the frozen evaluation set.

Saved under:

```text
backend/data/work/bytedance_browser_runtime_feasibility/golden_fixtures/
```

Fixtures:

- `s01_correct_strike_001_g01`
- `s01_correct_chord_001_g01`
- `s01_same_note_retrigger_001_g02`

Each fixture stores:

- fixed-anchor input waveform tensor
- PyTorch `reg_onset_output`
- PyTorch `frame_output`
- PyTorch `velocity_output` for diagnostics
- metadata including expected pitches and target anchor

## ONNX Export

The research script exported a fixed-shape ONNX model:

```text
backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx
```

Python ONNX Runtime findings:

- Default ORT graph optimization failed with:
  `MatMulBnFusion_Gemm ShapeInferenceError: First input does not have rank 2`
- Disabling ORT graph optimization allowed the model to load and run.

This means any browser path must either:

- disable the problematic optimization pass if supported by ORT Web, or
- use a graph/export path that avoids this fusion issue.

Python ORT numerical agreement against PyTorch was close on the three fixtures:

| Fixture | Onset mean abs delta | Onset max abs delta | Frame mean abs delta | Frame max abs delta |
| --- | ---: | ---: | ---: | ---: |
| correct single | 0.00000104 | 0.00158 | 0.00000114 | 0.00214 |
| correct chord | 0.00001038 | 0.00593 | 0.00001350 | 0.01132 |
| retrigger | 0.00000961 | 0.01001 | 0.00001408 | 0.01809 |

## Browser Harness

Added:

```text
backend/research/browser_runtime/bytedance_onnx_browser_harness.mjs
```

The harness:

- starts a local HTTP server,
- loads a real Chromium page through Playwright,
- serves `onnxruntime-web`,
- loads the exported ONNX model,
- runs the golden fixtures,
- compares browser raw outputs with PyTorch fixture outputs,
- evaluates frozen verifier decision agreement.

Environment observed:

```text
Windows 10
HeadlessChrome/149.0.7827.55
onnxruntime-web 1.20.1
```

### WebGPU

The WebGPU path did not run in this headless environment:

```text
Failed to get GPU adapter
```

This is an environment/runtime availability blocker, not proof that the model
cannot run with WebGPU. A follow-up should run the same harness in a browser
environment that exposes a real WebGPU adapter.

### WASM

WASM ran successfully with graph optimization disabled.

Results:

```text
model load:        1112 ms
first inference:   1940.4 ms
warm median:       1942.1 ms
warm p95:          1977.0 ms
```

Numerical agreement:

| Fixture | Onset mean abs delta | Onset max abs delta | Frame mean abs delta | Frame max abs delta | Verifier decision |
| --- | ---: | ---: | ---: | ---: | --- |
| correct single | 0.00000107 | 0.00158 | 0.00000116 | 0.00214 | agree |
| correct chord | 0.00001039 | 0.00593 | 0.00001351 | 0.01132 | agree |
| retrigger | 0.00000963 | 0.01001 | 0.00001409 | 0.01809 | agree |

Interpretation:

- Browser ONNX raw outputs can match PyTorch closely enough for the frozen
  verifier on these golden fixtures.
- WASM latency is not plausibly interactive for STEP.
- Browser WebGPU remains the relevant feasibility question.

## Conclusion

Current status:

```text
browser numerical consistency: GO on WASM golden fixtures
browser WASM latency: NO-GO for interactive STEP
browser WebGPU latency: unresolved, current harness could not acquire adapter
model size: large but technically exportable (~99MB ONNX fp32)
```

The architecture is not ready to enter production integration. The next useful
step is not more RMS/flux trigger research; it is to run the existing browser
harness in a WebGPU-capable browser environment. If WebGPU is still unavailable
or too slow, the next decision should be between:

- distillation / smaller target-conditioned verifier,
- backend inference,
- or a hybrid architecture where browser handles capture and backend verifies
  candidate strikes.

