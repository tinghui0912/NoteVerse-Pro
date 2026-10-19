# V25 STEP Microphone Resource Owner

STEP_V25_MICROPHONE_RESOURCE_OWNER_ESTABLISHED_CAPTURED_THROUGH_RETIREMENT_CONTRACT_CAPABILITY_CLOSED

The production StepMicrophoneInput uses shared BrowserAcousticCapture, SourceAnalysisRuntime and the existing Robust Worker/asset/FIR path, but remains unreachable from normal STEP startup. Runtime v6 and all V24 H50 semantics are unchanged.

One persistent chronology, mapping, assembler/identity registry and long-lived region belong to each input. Physical capturedThroughSourceSample comes only from accepted chunks. ownedThroughSourceSample is analyzed coverage for H50 only and is never a retirement watermark. AudioContext origin and a fixed PracticeTimebase preserve source sample identity; no arrival-time rewrite, transport, fit, compensation or cooldown.

Owner-issued immutable boundaries cannot be fabricated, reused, moved backward or silently committed after capture has advanced. The future application must commit runtime acceptInputAfter/rearm and input arm synchronously in that order. If arm fails after runtime commit, fail the application closed without target rollback. This orchestration is documented only, not installed in the controller.

Failure stops capture, invalidates ownership and notifies once. Analysis/Worker disposal waits for setup and publication delivery to unwind, never ends a region reentrantly. Capture owns its clone, not the root stream; AudioContext remains borrowed. No reconnect or fallback.

Local verification: 495 product tests passed including 38 frozen persistent tests / 36 end-to-end fixtures at 44.1/48k. Typecheck/lint and pre-execution regressions are recorded separately.

All real neural/model/Worker-model/decoder/PCM-file/V20-tensor/fresh-holdout/Continuous-acoustic executions are zero. Integration uses synthetic PCM and deterministic fake inference ports with actual source/runtime/assembler/domain classes. Adversarial publication injections are test doubles, not recorded acoustic output. No V24 34-row replay was rerun.

V3-V24 history and all pre-existing production files remain byte-identical. Defaults remain shared Robust 16k/29120/1820ms, decoder A .30/.05, 600/1050/170, ORT 1.20.1 WebGPU/no fallback; not a global optimum. MIDI and Continuous are unchanged.

STEP_ANALYSIS_UNAVAILABLE / ATTEMPT_ANALYZER_NOT_VALIDATED and MODEL_NOT_VALIDATED remain. productionMicrophone=false; D4=false. FIXED_MICROPHONE_COOLDOWN_NOT_ESTABLISHED.

Local tests are not GitHub CI. See remote-result-proof.json for actual status/workflow evidence. STOP for independent audit. STEP_MICROPHONE_BROWSER_QUALIFICATION_NOT_YET_EXECUTED; no browser/device/latency/UX/model qualification or capability promotion is claimed.
