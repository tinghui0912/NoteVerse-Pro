# V18 Runtime-Owned Source-Sensitive Verdict

STEP_V18_RUNTIME_OWNED_SOURCE_SENSITIVE_VERDICT_ESTABLISHED_V17_PARITY_PRESERVED

ZERO_NEURAL_PRODUCT_DOMAIN_REFACTOR_EXPOSED_REGRESSION_NOT_QUALIFICATION

## Domain Ownership

V17_RESEARCH_POLICY_RESULT_ACCEPTED_EXTERNAL_POLICY_OWNER_NOT_PRODUCTION_ARCHITECTURE
The sole StepPracticeRuntime resolves policy from pinned inputSource. MIDI remains MIDI_EXACT_SET. Microphone ordinary EVIDENCE is interpreted inside completeAttempt: exact -> MATCH; target-covered with extras -> RETRY/UNCERTAIN; missing target -> MISMATCH.
No target-aware analyzer/controller/hook helper or caller policy parameter was added. Existing controller still only forwards evidence and blocks microphone start. It retains legitimate score context for display/metronome orchestration, not correctness.
Schema6 / step-source-sensitive-verdict-v6 replaces v5 cleanly. Runtime uncertainty retains normalized observed pitches, original confidence and capture boundary in one finalized record. Score-blind acquisition RETRY remains []/null; both cases stay distinguishable without parallel history.

## Immutable Replay

All 34 frozen attempts across 22 scenario-rate cells entered the actual runtime as ordinary EVIDENCE, including every historical RETRY. External P2 executions=0. Verdicts were compared against V17 only after runtime finalization.

| Rate | MATCH | RETRY | MISMATCH | Dangerous automatic MATCH |
|---|---:|---:|---:|---:|
| 44100 | 4 | 7 | 6 | 0 |
| 48000 | 4 | 7 | 6 | 0 |

Per-row V17 parity is exact. Physical classes: SAFE_MATCH=8, SUPPORTED_RETRY=12, UNSUPPORTED_RETRY=2, TRUE_REJECT=12, FALSE_REJECT=0, DANGEROUS_FALSE_MATCH=0.
Correct chord [56,64] with observed [52,56,64,68] returns RETRY while keeping all four pitches/confidence. Wrong-octave target [52,56] with the same observation also returns RETRY, not MATCH. Correct single remains MATCH; missing tone and wrong semitone remain MISMATCH; paced repeats remain RETRY/RETRY.
CONSERVATIVE_TRISTATE_RUNTIME_SEMANTICS_ESTABLISHED_NOT_MICROPHONE_QUALIFIED. Exact-but-hallucinated target evidence can still MATCH; the new deterministic test explicitly retains this limitation. Wrong octave is not universally solved.

## Lifecycle Unchanged

Controller resource lifecycle remains separate from ACTIVE/ENDED domain status. READY/CAPTURING/ANALYZING/POST_VERDICT, capacity one, no queue/carryover, strict retirement equality rejection and stale identity fencing remain unchanged.
RETRY retains target/generation. Only explicit rearm commits pending MATCH advancement and final scope completion. Acquisition RETRY remains supported. MIDI exact-set and 35ms half-open gesture regressions passed.
REARM_REQUIRED_INDEPENDENT_OF_PITCH_VERDICT_POLICY. No microphone cooldown duration selected.

## Future Study Only

ACOUSTIC_OPERATING_POINT_REOPEN_AUTHORIZED_FOR_FUTURE_EXPOSED_DEVELOPMENT_STUDY_NOT_EXECUTED_IN_V18
FUTURE_THRESHOLD_STUDY_REQUIRES_ONE_TIME_FROZEN_RAW_TENSOR_CAPTURE
Committed historical executor declares rawTensorExportEnabled=false; production returns decoded events/diagnostics only. Current V7/V17 evidence has no reusable onset/frame tensor corpus. Unexecuted V11 journal design is not evidence. This does not deny unrelated older calibration caches.
A future threshold study first requires separately frozen one-time raw-tensor capture. None is performed here.
Verified historical Phase9GA3 onset [0.15,0.20,0.25,0.30,0.35], frame [0.05,0.10,0.15,0.20]. PRE_EXISTING_BOUNDED_THRESHOLD_GRID_AVAILABLE_FOR_FUTURE_ROBUST_DEVELOPMENT; not calibrated for current Robust600/170, not executed and no direction selected.
Maximize SAFE_AUTO_MATCH_COVERAGE subject to zero/controlled dangerous automatic MATCH, non-worsening DANGEROUS_TARGET_HALLUCINATION, required-target recall, runtime stability and latency. Not merely fewer EXTRA, more CORRECT, higher recall or higher precision.
Robust model/input, .30/.05, 600/1050/170, ORT, FIR and Worker topology remain unchanged. Continuous source/evaluation/UI were not modified or rerun; ownership/finality remains authoritative and source-sensitive presentation is a separate future refactor.

## Verification And Closure

Historical research raw files unchanged: 1494. Freeze remote verification 2026-10-19T08:01:04.654Z precedes replay 2026-10-19T08:01:11.434Z. Replay executions=1; every neural/session/Worker/decoder/PCM/acoustic/fresh-holdout/warmup/unknown counter=0.
Local: 336 product tests across 31 files, 6 pre-replay research tests, 6 stored-result replay assertion tests passed. Full application and research typecheck passed; seven production files and three research files linted with zero errors/warnings. Initial new-test assertion/fixture-type issues were fixed before freeze; no actual-output tuning. jsdom media notices persisted without test failure.
Build not run; no Next API or bundle configuration changes. Local results are not CI. Actual GitHub combined state/statuses/workflows are in the remote receipt and independently queried again at final HEAD.
Continuous MODEL_NOT_VALIDATED; STEP ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false.
STOP for independent audit. No automatic Wave-1, tensor capture, parameter sweep, fresh qualification or microphone integration.
