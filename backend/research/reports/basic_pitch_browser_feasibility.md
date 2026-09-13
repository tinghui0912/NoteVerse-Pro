# Basic Pitch Browser-Local Feasibility

Date: 2026-09-13

Scope: research only. This pass does not modify production STEP progression,
does not connect real microphone input, does not touch the frozen evaluation
set, and does not tune the ByteDance or Basic Pitch verifier thresholds.

This benchmark asks only:

```text
Can the official browser-compatible Basic Pitch package plausibly serve as a
lightweight local STEP_BY_STEP bounded verifier?
```

## Runtime Prototype

Added:

```text
backend/research/browser_runtime/basic_pitch_browser_entry.js
backend/research/browser_runtime/basic_pitch_browser_harness.mjs
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
development/calibration frontend comparison reports.

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
| model load | 256.4ms |
| first inference | 11,665.6ms |
| warm inference median | 291.6ms |
| warm inference p95 | 304.0ms |
| estimated strike→decision median | 511.6ms |
| estimated strike→decision p95 | 524.0ms |

Estimated strike-to-decision uses:

```text
220ms future prefix
+ browser warm inference
```

The input smoke fixture is the same fixed-anchor bounded clip shape used in
the ByteDance feasibility work:

```text
16k mono input: 29,120 samples
resampled for Basic Pitch: 22,050 Hz, 40,131 samples
```

## STEP Metrics

Existing development + calibration reports, using the existing Basic Pitch raw
evidence semantics:

```text
onset threshold = 0.5
frame threshold = 0.3
local evidence = target -50ms .. target +120ms
bounded causal prefix = target +350ms in the source benchmark
```

Aggregate development + calibration:

| Metric | Basic Pitch | ByteDance reference |
| --- | ---: | ---: |
| correct single | 20 / 24 | 20 / 24 |
| correct chord | 13 / 24 | 19 / 24 |
| retrigger | 13 / 24 | 17 / 24 |
| clean semitone false accept | 1 / 18 | 0 / 18 |
| clean octave false accept | 1 / 23 | 0 / 23 |
| clean missing-note false accept | 0 / 20 | 0 / 20 |
| no local model frames | 0 / 192 | 0 / 192 |

Development split:

| Metric | Basic Pitch |
| --- | ---: |
| correct single | 16 / 16 |
| correct chord | 10 / 16 |
| retrigger | 9 / 16 |
| clean semitone false accept | 0 / 10 |
| clean octave false accept | 1 / 15 |
| clean missing-note false accept | 0 / 13 |

Calibration split:

| Metric | Basic Pitch |
| --- | ---: |
| correct single | 4 / 8 |
| correct chord | 3 / 8 |
| retrigger | 4 / 8 |
| clean semitone false accept | 1 / 8 |
| clean octave false accept | 0 / 8 |
| clean missing-note false accept | 0 / 7 |

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
warm browser inference around 292ms on this machine
estimated strike→decision around 512ms
```

However, the existing STEP evidence metrics are not acceptable enough to select
it as the offline verifier:

```text
correct chord: 13 / 24
retrigger: 13 / 24
clean semitone false accept: 1 / 18
clean octave false accept: 1 / 23
```

Per the stop rule, do not start large Basic Pitch threshold tuning from this
result. Basic Pitch remains useful as a lightweight local reference, but it is
not selected as the STEP_BY_STEP verifier without additional calibration or a
separate verifier design.

Inference-location research should stop here for now:

```text
ByteDance browser WebGPU = numerically viable but too heavy
ByteDance hybrid = online latency reference, not selected architecture
Basic Pitch browser = lightweight but current STEP accuracy/safety insufficient
```

The remaining unresolved product/research problem is still:

```text
causal physical-strike candidate generation
and a verifier architecture that preserves STEP safety without excessive
latency or model size
```
