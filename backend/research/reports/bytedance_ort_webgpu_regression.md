# ByteDance ONNX Runtime WebGPU Regression Check

Date: 2026-09-16

This is a research-only A/B. No product dependency, model, graph, threshold, cadence, decoder, Worker, STEP, CONTINUOUS, AudioWorklet, or backend runtime behavior was changed.

## Historical baseline

Historical report: `backend/research/reports/bytedance_browser_runtime_feasibility.md`

| Browser | ORT asset | OS | Model load | First inference | Warm median | Warm p95 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Chrome 152.0.7977.75 | onnxruntime-web 1.20.1 | Windows 10.0.26200 x64 | 1554.1 ms | 2573.6 ms | 608.3 ms | 820.3 ms |
| Edge 153.0.4234.32 | onnxruntime-web 1.20.1 | Windows 10.0.26200 x64 | 1636.9 ms | 2915.8 ms | 767.3 ms | 838.7 ms |

Historical command used `executionProviders = ["webgpu"]` and `graphOptimizationLevel = "disabled"`.

## Current regression baseline

Direct browser feasibility path, current customer-web ORT asset:

| Browser | ORT asset | Model load | First inference | Warm median | Warm p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| Chrome 152.0.7977.75 | customer-web onnxruntime-web 1.30.0 | 1922.6 ms | 6211.0 ms | 4241.1 ms | 4694.2 ms |

Production Worker smoke at the same stage found warm median `4021.8 ms`, with Worker/client overhead only `0.3-0.6 ms`. The Worker boundary is therefore not the cause of the multi-second inference.

## Probe directory

Before installing any isolated A/B packages, the historical probe directory still contained:

```text
version:        1.20.1
package path:   backend/data/work/browser_runtime_probe/node_modules/onnxruntime-web/package.json
dist path:      backend/data/work/browser_runtime_probe/node_modules/onnxruntime-web/dist
package mtime:  2026-09-13 11:44:35 local
dist mtime:     2026-09-13 11:44:40 local
```

This matches the historical report. The current contents alone are not the historical proof, but they confirm the local probe directory has not drifted away from `1.20.1`.

## Frozen variables

```text
model:      backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx
byte size:  98,691,493
SHA256:     6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5

input fixture: s01_correct_strike_001_g01
input tensor:  audio float32 [1, 29120]

browser:    Chrome 152.0.7977.75, headed
OS:         Windows 10.0.26200 x64
launch:     --enable-unsafe-webgpu
EP:         ["webgpu"]
graph opt:  disabled
```

The A/B uses isolated local ORT installs under `backend/data/work/ort-ab/`; these directories are gitignored and not committed.

## Controlled A/B

| ORT version | ORT asset path | Chrome | Model load | First inference | Warm median | Warm p95 | Strike->decision median | Strike->decision p95 | Correctness |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1.20.1 | `backend/data/work/ort-ab/1.20.1/node_modules/onnxruntime-web/dist` | 152.0.7977.75 | 1501.0 ms | 1267.1 ms | 397.2 ms | 454.6 ms | 617.2 ms | 674.6 ms | 3/3 verifier decisions agree |
| 1.30.0 | `backend/data/work/ort-ab/1.30.0/node_modules/onnxruntime-web/dist` | 152.0.7977.75 | 1677.5 ms | 5235.7 ms | 4096.8 ms | 4163.4 ms | 4316.8 ms | 4383.4 ms | 3/3 verifier decisions agree |

### ORT 1.20.1 raw warm samples

```text
462.0
430.8
419.1
396.5
376.5
382.9
408.8
393.7
406.8
412.6
454.6
410.0
390.0
388.1
397.2
383.7
380.2
381.8
397.6
371.7
```

Summary:

```text
min:    371.7 ms
median: 397.2 ms
p95:    454.6 ms
max:    462.0 ms
```

### ORT 1.30.0 raw warm samples

```text
3847.6
4016.1
3969.8
3838.8
3852.4
3840.2
4170.0
4090.4
4130.3
4113.0
4089.6
4096.8
4104.8
4098.6
4102.1
4131.5
4128.7
4163.4
4095.7
4069.7
```

Summary:

```text
min:    3838.8 ms
median: 4096.8 ms
p95:    4163.4 ms
max:    4170.0 ms
```

## Correctness lock

All three non-frozen golden fixtures retained shape agreement and verifier decision agreement under both ORT versions. Thresholds were unchanged: onset `0.2`, frame `0.2`.

| Fixture | ORT | Onset shape | Frame shape | Onset mean abs delta | Onset max abs delta | Frame mean abs delta | Frame max abs delta | Decision |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `s01_correct_strike_001_g01` | 1.20.1 | yes | yes | 0.0000010246406324 | 0.0015820861 | 0.0000011266305340 | 0.0021401644 | agree |
| `s01_correct_chord_001_g01` | 1.20.1 | yes | yes | 0.0000103672084052 | 0.0059363395 | 0.0000134881202771 | 0.0113265961 | agree |
| `s01_same_note_retrigger_001_g02` | 1.20.1 | yes | yes | 0.0000095977427833 | 0.0100121051 | 0.0000140717928177 | 0.0180881023 | agree |
| `s01_correct_strike_001_g01` | 1.30.0 | yes | yes | 0.0000010245224020 | 0.0015820563 | 0.0000011267245228 | 0.0021398962 | agree |
| `s01_correct_chord_001_g01` | 1.30.0 | yes | yes | 0.0000103676688855 | 0.0059371442 | 0.0000134877350057 | 0.0113279670 | agree |
| `s01_same_note_retrigger_001_g02` | 1.30.0 | yes | yes | 0.0000095975518172 | 0.0100122839 | 0.0000140715484076 | 0.0180882215 | agree |

## Provider / node-assignment evidence

Both runs acquired a WebGPU adapter in Chrome. Adapter info exposed no vendor/device string (`info: {}`), but reported WebGPU features and limits including:

```text
maxBufferSize: 2147483648
maxStorageBufferBindingSize: 2147483644
maxComputeWorkgroupStorageSize: 32768
```

Both ORT versions emitted the generic warning:

```text
Some nodes were not assigned to the preferred execution providers...
Rerunning with verbose output on a non-minimal build will show node assignments.
```

An additional short ORT 1.30.0 `ort.env.logLevel = "verbose"` probe recorded:

```text
WebGPU EP preferred layout: 1
WebGPU EP graph capture enable: 0
WebGPU EP force CPU node count: 0
WebGPU EP power preference: 2
WebGPU EP Dawn backend type: 0
WebGPU EP Context is created
```

It also logged WebGPU shader generation for at least these op families:

```text
Transpose, Pad, Conv2dMM, Pow, Add, MatMul, Clip, Log, Div, Mul, Sub,
BatchNormalization, Relu, Pool, MatMulSubgroup, Slice, GruStateCopy,
GruGate, GruHidden, Sigmoid, Concat
```

The minified/browser ORT build did not expose a WebGPU-vs-CPU node assignment count. The warning itself explicitly says a non-minimal build is needed for node assignments, so no exact provider assignment summary is claimed here.

## Diagnosis

### Proven

- The same ONNX file, same SHA256, same Chrome channel/version, same OS, same input fixture, same WebGPU-only provider request, and same `graphOptimizationLevel = "disabled"` produce subsecond warm inference with `onnxruntime-web 1.20.1`.
- The same controlled setup produces ~4.1 second warm inference with `onnxruntime-web 1.30.0`.
- Golden fixture correctness remains locked for both versions.
- The production Worker boundary is not responsible for the slowdown; direct 1.30.0 and Worker 1.30.0 are both multi-second while Worker overhead is <1 ms.

### Strong evidence

- The historical ~608 ms class was reproduced and exceeded by isolated ORT 1.20.1 (`397.2 ms` median in this run).
- The current ~4.2 s class was reproduced by isolated ORT 1.30.0 (`4096.8 ms` median).
- ORT package/runtime version is sufficient to explain the regression observed in current customer-web.

### Still unknown

- The exact internal ORT 1.30.0 cause is not fully identified. The available browser/minimal build logs do not provide node assignment counts.
- It remains unknown whether the slowdown comes from changed WebGPU kernels, layout policy, CPU fallback of high-cost nodes, synchronization/readback behavior, Dawn/WebGPU runtime interaction, or another ORT 1.30.0 execution-path change.

## Narrow root-cause statement

The regression is localized to the ONNX Runtime Web WebGPU runtime version path: `onnxruntime-web 1.30.0` is dramatically slower than `onnxruntime-web 1.20.1` for this fixed ByteDance ONNX model under otherwise identical browser, model, input, execution-provider, graph-optimization, and machine conditions.

This report does not recommend or perform a production downgrade. It only establishes that ORT version/runtime behavior is the sufficient reproduction variable.

## Artifacts

Local, untracked raw reports:

```text
backend/data/work/bytedance_browser_runtime_feasibility/ort_1_20_1_chrome_webgpu_ab.json
backend/data/work/bytedance_browser_runtime_feasibility/ort_1_30_0_chrome_webgpu_ab.json
backend/data/work/bytedance_browser_runtime_feasibility/ort_1_30_0_chrome_webgpu_verbose_probe.json
```

Committed research harness instrumentation:

```text
backend/research/browser_runtime/bytedance_onnx_browser_harness.mjs
```

