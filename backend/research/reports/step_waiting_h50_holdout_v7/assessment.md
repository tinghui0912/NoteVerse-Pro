# V7 Continuous Prerequisite and Blind Stage A

Disposition: STEP_WAITING_H50_STAGE_A_ACOUSTIC_EXECUTION_BLOCKED.

Failure seal: BLOCKED_AUDIO_OUTPUT_SEALED. No rerun, tuning, truth opening or Stage B followed.

## Gates and Accounting

Starting HEAD was exactly 44c464e6d26631d777941eff52f1bef55fad2a3f. The accepted primary freeze 570114cbe1f11983d6b07956078b4a655275b976, canonical SHA256 4a0264d06939fab1c12f1199be1903bc089cbe9fa0f0bf06f1456c4faf298b57, retained all 254 exact path/hash bindings. Only the six permitted evidence files had been added after that freeze. Production and v3/v4/v5/v6 diffs remain empty.

Execution freeze: 9406d68acab9f4f66aac6d38feb7473aeecc5ac1.
Canonical SHA256: 86d3b68d2a0dd405769e4cd2317fa8b70d6a42247de99d37ca1ad0c55d2512ed.
Independent remote verification at 2026-10-18T11:00:35.530564+00:00 preceded post-freeze static checks and every neural execution. The earlier TLS handshake failure and successful re-verification are recorded explicitly, not treated as a failed/retried neural cell.

Focused static verification: 14 checks passed, zero failed, two test files, plus 18 source jobs / 228 exact frozen input windows through an explicitly empty inference port. Those 228 dry windows are NOT neural runs. Syntax/build checks and Stage A browser/Worker import graphs passed without truth-side dependencies.

Fresh canonical Continuous results:

| Gate | Result | Actual neural runs |
| --- | --- | ---: |
| Engineering | 8/8 PASS | 18 |
| Musical | 8/8 PASS | 66 |
| Production-controller | PASS | 10 |
| Total Continuous | complete accounting | 94 |

Accepted capture-aggregation baseline: a399051d4007b57144e0d06b0606df7c53f770a7, SHA256 3f24728b4043be0eecba4ddc3774d1ff89fc5d068bf1a44bb09324106941326f. Exact stable publication/counterfactual semantic diffs were []. Only the accepted availabilityTimeMs/finalizedAtMs/finalizationTimeMs exclusions were used. Production-controller parity retains the existing status/completion/run-count witness scope, not UUID rewriting or an expanded field exclusion.

## Stage A Failure Witness

All 18 jobs and 228 model windows completed. Actual model runs=228, modelRunCountComplete=true, unresolved runs=0, modelInputMismatches=0. The combined fresh actual neural accounting is 94 Continuous + 228 blocked Stage A = 322; graph compilation, model loads and dry-port checks are not counted.

The frozen runner's final condition required the raw Playwright page worker-created count to equal 1. It observed 4: one /worker.js plus three workers whose URL is /ort/ort-wasm-simd-threaded.jsep.mjs. The production entry's independent ownership trace records one AcousticModelWorker construction and one model-session load. The gate therefore failed after complete inference. See worker-accounting-witness.json for all four event identities/timestamps.

This is a qualification Worker-accounting gate failure. It is not evidence of H50 acoustic safety failure, a second product model session, or a fallback model. The gate is not relaxed after output access, the output status remains BLOCKED, and no source/tooling change or rerun occurred.

The browser was headed branded Chrome 155.0.8059.80, Playwright 1.48.2; GPU adapter vendor=nvidia, architecture=lovelace. Production model metadata records ORT Web 1.20.1, WebGPU, automaticFallback=false, one session load and exact Robust SHA256 4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3. Frozen graph optimization, decoder, FIR and geometry were unchanged. Two ORT W-tagged node-assignment messages are retained verbatim in diagnostics.

## Isolation and Seal

Stage A parsed only the frozen opaque jobs as primary corpus metadata. Its separate process did not import the outer freeze verifier, STEP runtime, controller, selector, scorer, MIDI parser or truth/scenario code. The full Continuous parity results stayed outside that process; its permission gate contained no target/gesture data. Server routes were an exact audio/model/runtime allowlist; forbiddenRequests=0. Browser/Worker truthBearingBundleInputs=[].

truthOpened=false; midiOpened=false; scenarioOpened=false; targetOpened=false; productVerdictComputed=false. The outer integrity process verified truth-bearing files as raw hashes only. No H50 expected target or truth was used to interpret the acoustic output.

Acoustic output: stage-a/acoustic.json.
SHA256: 61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1.
Seal: stage-a/acoustic-seal.json.
Seal SHA256: 5ffdb33b8f34791249f40e8c7b6c778b6d93a5f362b305b77120269ceb933f85.

The failure output and seal are committed/pushed as evidence; evidence-remote-proof.json records exact remote verification and raw Git blob byte SHA comparison. GitHub receipts and final HEAD are queried independently. Local qualification is not CI PASS.

## Closed Boundaries

StageB=NOT_STARTED. Every H50 safety counter, usability metric and product causal latency metric remains NOT_MEASURED. No physical microphone, UX SLO or commercial qualification was performed. Batik remains a NONCOMMERCIAL_ENGINEERING_QUALIFICATION_SOURCE. Robust remains the browser/product engineering default; scientific disposition remains STATISTICAL_TIE / NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER.

Continuous=MODEL_NOT_VALIDATED; STEP=ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false.

STOP for independent audit of the immutable failure seal and Worker-count distinction. No Stage B, candidate/scorer adjustment, neural rerun or microphone integration is authorized by this report. The primary corpus has now had an acoustic execution; a future rerun must not be advertised as fresh blind evidence.
