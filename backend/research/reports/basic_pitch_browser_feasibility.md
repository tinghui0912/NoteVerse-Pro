# Basic Pitch Browser-Local Feasibility

Date: 2026-09-13

Scope: research only. This pass does not modify production STEP progression,
does not connect real microphone input, does not touch the frozen evaluation
set, and does not tune the ByteDance or Basic Pitch verifier thresholds.

This benchmark asks only:

```text
Can the official browser-compatible Basic Pitch package plausibly serve as a
lightweight local STEP_BY_STEP bounded verifier under the same fixed-anchor
runtime input contract used by the browser latency smoke test?
```

## Runtime Prototype

Added:

```text
backend/research/browser_runtime/basic_pitch_browser_entry.js
backend/research/browser_runtime/basic_pitch_browser_harness.mjs
backend/scripts/evaluate_basic_pitch_fixed_anchor_window.py
```

The harness uses the official package:

```text
@spotify/basic-pitch@1.0.1
TensorFlow.js browser runtime
Chrome headed mode
```

It runs the same three golden smoke fixtures used by the ByteDance browser
feasibility pass:

```text
s01_correct_strike_001_g01
s01_correct_chord_001_g01
s01_same_note_retrigger_001_g02
```

These fixtures are numerical/runtime smoke tests, not cross-source validation.
The development/calibration STEP metrics below come from the existing
development/calibration source manifests only. The frozen evaluation set was
not used.

## Browser Result

Environment:

```text
Chrome 152.0.7977.75
Windows x64
TensorFlow.js backend: webgl
```

Model assets:

```text
model.json: 174,537 bytes
weights shard: 742,392 bytes
total model assets: 916,929 bytes
```

Runtime:

| Metric | Basic Pitch Chrome/WebGL |
| --- | ---: |
| model load | 180.2ms |
| first inference | 12,448.1ms |
| warm 16k→22050 resample median | 0.5ms |
| warm 16k→22050 resample p95 | 0.7ms |
| warm model inference median | 311.9ms |
| warm model inference p95 | 362.1ms |
| warm local compute median | 312.5ms |
| warm local compute p95 | 362.5ms |
| estimated strike→decision median | 532.5ms |
| estimated strike→decision p95 | 582.5ms |

Estimated strike-to-decision uses:

```text
220ms future prefix
+ browser warm resample + model inference
```

The input smoke fixture is the same fixed-anchor bounded clip shape used in
the ByteDance feasibility work:

```text
16k mono input: 29,120 samples
resampled for Basic Pitch: 22,050 Hz, 40,131 samples
```

## Frame Timing And Parity

The browser harness now uses a JavaScript equivalent of official Basic Pitch
`model_frames_to_time()` rather than the earlier `t / 86` approximation.

Parity check:

```text
frame_count = 220
max_abs_delta_seconds = 0.0
mean_abs_delta_seconds = 0.0
```

Browser/Python smoke parity used the same three fixed-anchor golden fixtures:

```text
decision agreement = 3 / 3
output shape agreement = 3 / 3
max local onset delta <= 0.0033
max local frame delta <= 0.0173
```

The small raw-value differences are expected because the browser path uses the
official TensorFlow.js package and explicit 16k→22050 linear resampling, while
the Python path writes the 16k WAV and lets the official Python inference stack
perform its own file loading/resampling. The verifier decisions agreed.

## STEP Metrics

Exact fixed-anchor development + calibration report:

```text
input = 16k source PCM
max real lookback = 1000ms
target anchor = 1600ms
future = 220ms
left zero padding follows the ByteDance fixed-anchor contract
Python Basic Pitch official inference path performs its own 16k→22050 resampling
onset threshold = 0.5
frame threshold = 0.3
local evidence = target -50ms .. target +120ms
```

Aggregate development + calibration:

| Metric | old source-prefix +350ms | new fixed-anchor +220ms |
| --- | ---: | ---: |
| correct single | 20 / 24 | 20 / 24 |
| correct chord | 13 / 24 | 14 / 24 |
| retrigger | 13 / 24 | 15 / 24 |
| clean semitone false accept | 1 / 18 | 1 / 19 |
| clean octave false accept | 1 / 23 | 1 / 24 |
| clean missing-note false accept | 0 / 20 | 0 / 20 |
| clean negative false accept | 2 / 61 | 2 / 63 |
| no local model frames | 0 / 192 | 0 / 192 |

The exact runtime contract improves chord and retrigger recall slightly, but it
does not remove clean false accepts and it still leaves chord/retrigger recall
well below the level needed for a STEP verifier.

## Comparison To Current References

Current ByteDance browser WebGPU smoke reference:

```text
model size: ~98.7MB ONNX
Chrome WebGPU warm median: 608.3ms
Chrome estimated strike→decision median: 828.3ms
```

Corrected hybrid ByteDance online latency reference:

```text
0ms one-way estimated median: 353.6ms
25ms one-way estimated median: 432.2ms
50ms one-way estimated median: 485.6ms
100ms one-way estimated median: 581.4ms
```

Basic Pitch is much smaller and substantially faster than the current
ByteDance browser WebGPU path. It is not clearly faster than the best hybrid
online reference, but it avoids network dependency.

## Conclusion

Basic Pitch browser-local runtime is feasible as a lightweight browser model:

```text
small model assets
official browser-compatible package
warm browser local compute around 313ms on this machine
estimated strike→decision around 533ms
```

However, the exact fixed-anchor +220ms STEP evidence metrics are still not
acceptable enough to select it as the offline verifier:

```text
correct chord: 14 / 24
retrigger: 15 / 24
clean semitone false accept: 1 / 19
clean octave false accept: 1 / 24
```

Per the stop rule, do not start large Basic Pitch threshold tuning from this
result. Basic Pitch remains useful as a lightweight local reference, but it is
not selected as the STEP_BY_STEP verifier without additional calibration or a
separate verifier design.

Inference-location research should stop here for now:

```text
ByteDance browser WebGPU = numerically viable but too heavy
ByteDance hybrid = online latency reference, not selected architecture
Basic Pitch browser = lightweight but fixed-anchor STEP accuracy/safety insufficient

Basic Pitch local verifier = STOP
```

The remaining unresolved product/research problem is still:

```text
causal physical-strike candidate generation
and a verifier architecture that preserves STEP safety without excessive
latency or model size
```
