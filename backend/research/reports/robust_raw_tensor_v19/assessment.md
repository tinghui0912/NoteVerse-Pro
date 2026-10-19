# V19 Raw Tensor Foundation: Blocked Before Freeze

ROBUST_V19_RAW_TENSOR_CAPTURE_INTEGRITY_BLOCKED

## Stop Witness

The pre-execution static test at tests.mjs:79 expected one occurrence of the literal `onsetThreshold: 0.30, frameThreshold: 0.05` in baseline.mjs. It found two: the actual decoder call argument and the result-report metadata field. This is a source-text proxy/test defect, not evidence of two decoder executions.

The failed gate was not bypassed or repaired. Under the requested any-failure STOP rule, V19 stops before protocol freeze, browser creation, model/session loading or any decoder call. All draft harness sources are NOT_ADMITTED_FOR_EXECUTION, not a successful protocol. No V19 rerun is authorized by this report.

## Established Input Facts

All nine frozen cases, both 44100/48000 rates, 18 jobs and 228 inputs were reconstructed using current production QualifiedSourceAdapter and planWindow. Each input is 29120 finite Float32 samples; canonical little-endian SHA matched both V6 input/reference identities and V7 input/window metadata, with zero mismatches. Existing prepared PCM was read; no audio codec decode occurred.

Exact model size/SHA and pinned ORT asset bytes were statically verified. This is not an ONNX session-load or neural execution claim. The raw-only browser/Worker and production baseline decoder import graphs passed their completed checks.

## Not Established

Capture protocol freeze: NOT_CREATED. Raw tensor corpus/seal: NOT_CREATED. Stage A: NOT_STARTED. Stage B: NOT_STARTED. Baseline parity: NOT_ESTABLISHED. Actual raw pairs/bytes: 0/0, not the planned 228/29373696. No reusable current-lineage tensor corpus was produced.

Stage A counters: session loads=0; model runs=0; capture Workers=0; input count executed=0; raw pairs=0; canonical raw bytes=0; decoder runs=0; product verdict runs=0; truth access=0; hidden warmups=0; unknown runs=0.

Stage B counters: neural runs=0; baseline decoder runs=0; alternative-threshold decoder runs=0; product verdict runs=0. No threshold grid, direction, metrics, scoring or winner selection.

## Verification And Boundaries

Pre-execution research tests: 12 passed before the failure, 1 failed, 2 not run. Research TypeScript and lint completed successfully in the same already-issued preflight batch. Product tests were not run after the STOP. Local checks are not CI and the preflight is not PASS.

Production and historical V3-V18 evidence remain unchanged, including runtime schema6 / step-source-sensitive-verdict-v6. MIDI_EXACT_SET, MICROPHONE_CONSERVATIVE_TRISTATE and explicit rearm remain authoritative. No microphone cooldown selected. Continuous and acoustic defaults/model/FIR/ORT/geometry were not modified.

Current decoder A .30/.05 and owned600/past1050/future170 remain defaults. Historical threshold grid remains metadata only, not executed. Capabilities remain Continuous MODEL_NOT_VALIDATED, STEP ATTEMPT_ANALYZER_NOT_VALIDATED, productionMicrophone=false, D4=false. No fresh holdout access.

Actual GitHub statuses/workflows and remote evidence identity are recorded in the additive receipt. No empty checks are called CI PASS.

STOP for independent audit and explicit authorization of a new prospective tooling phase. Do not silently repair/resume V19 or start threshold research.
