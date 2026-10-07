# Phase 9E-A ByteDance Chunked DEVELOPMENT Report

Status: `BLOCKED_NOT_RUN`

The research-only ByteDance score-aware chunked adapter, planner, real ORT Web smoke path, and bake-off scorer integration were implemented and tested. The local ONNX asset was present, matched the expected identity, and executed in a real browser ONNX smoke run:

- SHA256: `6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5`
- bytes: `98,691,493`

Runtime smoke: `PASS` with ORT Web `1.20.1`, Chromium `149.0.7827.55`, `wasm` execution provider, and graph optimization disabled. The smoke run verified `reg_onset_output` and `frame_output` tensors with shape `[1, 183, 88]`.

Pipeline integration smoke: `PASS`. Actual browser raw outputs were consumed by the authoritative TypeScript ByteDance decoder and converted into a canonical `CandidatePublication`. This remains `PIPELINE_INTEGRATION_SMOKE_ONLY`, not product accuracy.

No real DEVELOPMENT acoustic metrics were produced in this artifact. The causal-case runner audited 128 DEVELOPMENT cases and excluded all 128 as `EXCLUDED_NO_COMPLETION`: the manifest is an old STEP/target-case contract and does not expose finite Practice v2 Continuous completion boundaries. The historical 421 ByteDance target-verifier rows remain historical taxonomy/evidence; they were not converted into Practice v2 Continuous truth because they are per-target old-gate rows rather than coherent full source intervals with a complete `ExpectedStrike[]` and synchronized physical truth contract.

Comparative outcome: `INSUFFICIENT_EVALUATION_SET`

Calibration used: `NO`

Evaluation used: `NO`

Production microphone enabled: `NO`

Candidate selected: `NO`
