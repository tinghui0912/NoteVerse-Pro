# ByteDance Continuous Microphone Feasibility Decision

Generated: 2026-10-05T01:20:49.342414+00:00

Verdict: INCONCLUSIVE

Production state: CONTINUOUS_ANALYSIS_UNAVAILABLE

## Completed Gates

- Batch-capable dynamic ONNX export: PASS
- Raw B=1/B=2/B=4/B=8 parity: PASS
- Max raw tensor abs delta: 9.328126907348633e-06
- Headed Chrome WebGPU batch benchmark: PASS
- Chrome: 154.0.8037.95
- ORT Web: 1.20.1
- B=8 warm median: 1426 ms/batch, 5.610098176718092 windows/sec
- B=8 warm p95: 1557 ms/batch, 5.138086062941555 windows/sec

## Blocking Gate

Trusted output region is BLOCKED. Available fixtures do not cover the required dev/cal categories and window positions, so no one-owner publication region can be selected.

## Decision

INCONCLUSIVE is the only valid result. ByteDance has now passed the batch export/parity and headed WebGPU throughput prerequisites, but it has not passed the trusted-region correctness gate. Therefore Continuous microphone remains disabled and must not be integrated into production.
