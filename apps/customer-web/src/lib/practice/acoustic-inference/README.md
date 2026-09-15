# ByteDance Browser Acoustic Inference Boundary

This package is the shared browser-local inference boundary for future STEP and
CONTINUOUS practice. It does not implement live microphone capture,
AudioWorklet, model caching, or production model delivery.

## Model identity

- Model ID: `bytedance-piano-transcription-note-model`
- Model version: `CRNN_note_F1_0.9677_pedal_F1_0.9186`
- ONNX Runtime Web: `1.30.0`
- Required execution provider: `webgpu`
- Sample rate: 16 kHz mono PCM

The production ONNX binary is not committed here. The runtime consumes a
versioned manifest with model URL/path, expected byte size, SHA256, input/output
descriptors, preprocessing version, and decoder version.

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

## Timing

Physical attack time comes from capture/sample timing mapped into the frozen
`PracticeTimebase` session domain. Inference completion time is diagnostic only.

## Adapters

The STEP adapter converts generic acoustic events into a
`StepVerifierObservation` only when all expected physical attack pitches have
fresh post-activation events for the current target. STEP progression remains
owned by `StepPracticeRuntime`.

The CONTINUOUS adapter forwards the same generic acoustic evidence into the
existing Performance evaluator. The local Performance clock remains
authoritative.
