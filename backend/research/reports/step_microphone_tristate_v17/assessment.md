# V17 Conservative Tristate Policy

STEP_MICROPHONE_V17_CONSERVATIVE_TRISTATE_SAFETY_SUPPORTED_ON_EXISTING_EXPOSED_EVIDENCE

EXPOSED_DEVELOPMENT_PRODUCT_POLICY_RESEARCH_ONLY_NOT_QUALIFICATION

## Policy And Runtime

P2 uses existing MATCH / MISMATCH / RETRY domain semantics: exact set -> MATCH; proper target coverage with extras -> RETRY/UNCERTAIN; missing target -> MISMATCH. No confidence, octave, timing or decoder heuristic.
Actual current StepPracticeRuntime schema5 / step-paced-attempt-v5 finalized every attempt. RETRY enters POST_VERDICT, retains target/generation and needs explicit rearm. Original observations are retained in sidecars; product RETRY records intentionally assert no observed set.

## Counterfactual Rows

| Rate | MATCH | RETRY | MISMATCH | Dangerous MATCH |
|---|---:|---:|---:|---:|
| 44100 | 4 | 7 | 6 | 0 |
| 48000 | 4 | 7 | 6 | 0 |

Correct chord [56,64] with observed [52,56,64,68] becomes RETRY, not a false MISMATCH or automatic MATCH. Both legitimate octave-chord repeats [46,58] also become separate RETRY attempts, with POST_VERDICT and explicit rearm.
Wrong-octave target [52,56] is unsupported by physical [56,64]; P2 returns UNSUPPORTED_RETRY instead of the unsafe P1 MATCH. Missing chord tone and wrong semitone remain MISMATCH; correct single remains MATCH.
Zero dangerous automatic MATCH here is exposed-development support, not universal safety or microphone qualification. Acoustic target hallucination still exists and remains in the diagnostics.

## Physical Evidence And Burden

34 counterfactual attempts reduce to 18 exact physical/acoustic rate units, 9 physical gestures ignoring rate, from 4 recordings. Full grouping, target views and multiplicities remain in tristate-results.json.
Among 12 supported unique units: MATCH 6, RETRY 6, MISMATCH 0. SAFE_AUTO_MATCH_COVERAGE=0.5; SUPPORTED_AMBIGUITY_RETRY_RATE=0.5.
NOT_GENERALIZABLE_PRODUCT_RATE: scenario counterfactuals and rate variants are correlated, not independent performances. These are descriptive diagnostics, not population retry rates.
PERSISTENT_ACOUSTIC_AMBIGUITY_USABILITY_RISK
Two rate variants are not repeated user trials. Distinct frozen same-target physical repeats can both return RETRY. Deterministic ambiguity may persist; no population or repeated-device-run rate claim.
Never auto-pass the Nth retry, majority-vote, accumulate/union across attempts or auto-skip. A future manual Continue/Skip must be a distinct user action after READY, not MATCH. No UI changed.

## Future Operating Point

ACOUSTIC_OPERATING_POINT_REOPEN_JUSTIFIED_FOR_EXPOSED_DEVELOPMENT_ONLY
The recurrence decision uses the prospectively frozen cross-recording/two-rate rule, not a post-result success threshold. It authorizes a recommendation to design research only, not execution.
Objective: maximize SAFE_AUTO_MATCH_COVERAGE subject to DANGEROUS_TARGET_HALLUCINATION safety, required-target recall, runtime stability and latency.
Prospective order: decoder operating point .30/.05; then owned600/future170 versus historical owned600/future120; new readout only if separately shown necessary. No tuning direction, parameter grid or new mechanism selected.
MODEL_INPUT_CONTRACT_NOT_REOPENED. 16k mono, 29120/1820ms, Robust ONNX and shared model remain unchanged. Decoder A, onset .30, frame .05 and owned600/past1050/future170 all remain current defaults, not a global optimum claim.

## Temporal Identity And Continuous

REARM_REQUIRED_INDEPENDENT_OF_PITCH_VERDICT_POLICY. Strict newer-than-watermark eligibility, old identity rejection and no carryover remain intact. No microphone cooldown duration chosen.
V16 Continuous inventory hashes still match. No projection or Continuous acoustic replay was rerun. Internal MATCHED/WRONG/EXTRA ownership/finality remains authoritative. Acoustic WRONG/EXTRA are not physical-key facts. Final review exposes Extra playing; no direct live WRONG/EXTRA badge or deterministic overall score formula exists in the inspected path.
CONTINUOUS_SOURCE_SENSITIVE_PRESENTATION_READY_FOR_SEPARATE_PRODUCT_REFACTOR is a design note only. Raw precision/recall/F1, false-positive onsets/minute, extras and decoder diagnostics must remain; product leniency is not model improvement.

## Verification And Stop

Historical research files raw-hash verified unchanged: 1467. Production diff empty; all execution counters zero. Freeze remote proof 2026-10-19T07:29:03.986Z precedes analysis 2026-10-19T07:29:10.500Z.
Local: 24 research tests and 315 product tests across 30 files passed; research typecheck/lint passed. jsdom emitted media pause/load not-implemented notices. Local tests are not GitHub CI; actual status evidence is recorded separately.
V3-V16 historical conclusions remain unchanged. No neural/model/session/Worker/decoder/PCM execution, Continuous projection rerun, fresh holdout, production modification, qualification or microphone enablement.
Capabilities remain Continuous MODEL_NOT_VALIDATED; STEP ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false.
STOP for independent audit. Any future acoustic study requires separate authorization and prospective freeze.
