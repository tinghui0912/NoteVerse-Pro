# V12 Paced STEP Product Contract

Disposition: `STEP_PACED_LIFECYCLE_V12_PRODUCT_CONTRACT_ESTABLISHED_ACOUSTIC_BAKEOFF_NOT_STARTED`.

`V11_ACOUSTIC_BAKEOFF_NOT_RESUMED_PRODUCT_CONTRACT_CHANGED_FIRST`

`NO_NEURAL_EXECUTION_IN_V12`

## Authority And Interaction

1. Session lifecycle: `IDLE | PREPARING | ACTIVE | ENDED | DISPOSED`. The controller owns application preparation/resources/disposal. The pure runtime is constructed ACTIVE and owns semantic progression until ENDED.
2. Attempt lifecycle: `READY | CAPTURING | ANALYZING | POST_VERDICT`. No RESET alias. STEP snapshot schema is now 4, `step-paced-attempt-v4`.
3. READY for user input means ACTIVE session, available input, READY attempt phase, current target, and no fatal input error. `canAcceptAttempt` derives from semantic/application state, not React timers.
4. Only READY may create an attempt. CAPTURING can accept further notes only inside the already-open bounded gesture. Outside that interval, and throughout ANALYZING/POST_VERDICT, input is not queued, reassigned, or carried forward.
5. `completeAttempt()` finalizes one immutable verdict but leaves the answered target current. The runtime stores one pending post-verdict transition, not a future-attempt queue. MATCH advancement occurs only at `rearm(explicitWatermark)` together with next READY.
6. Final MATCH stays POST_VERDICT until that same commit, then ends scope once. A user Stop may end the session without applying pending advancement, but cannot fabricate SCOPE_COMPLETED. READY-only Skip remains a separate runtime-owned explicit user action.
7. MIDI retirement uses current PracticeTimebase session time at the actual re-arm transition, not the previous gesture end. Native `MIDIMessageEvent.timeStamp` is preserved: a delayed callback whose timestamp is <= watermark cannot open a new attempt.
8. MIDI adds no artificial cooldown or post-verdict timer. Its existing first-NOTE_ON 35ms half-open chord window is unchanged; it is not a cooldown.
9. Future microphone policy only: capture continues without Pause/Resume; a qualified retirement condition may precede the capture owner's physical capturedThrough watermark. Runtime alone commits that explicit watermark and pending transition.
10. No microphone cooldown duration was selected: `MICROPHONE_POST_VERDICT_MINIMUM_NOT_YET_ENGINEERING_QUALIFIED`.
11. No RMS, spectral flux, transient gate, second strike detector or acoustic change was introduced.
12. No neural model, acoustic Worker/session, decoder A/B, selected PCM decode, Stage A/B, or acoustic Continuous regression ran. Fresh holdout access is zero.
13. V11 was not resumed or repaired. Its historical disposition is still `EVALUATION_INTEGRITY_BLOCKED`.
14. Microphone capabilities remain closed: Continuous `MODEL_NOT_VALIDATED`, STEP `ATTEMPT_ANALYZER_NOT_VALIDATED`, productionMicrophone=false, D4=false. MIDI lifecycle testing is not microphone qualification.
15. Local testing is not GitHub CI. Actual combined statuses and workflow runs are queried in the machine-readable assessment and remote receipt. Empty pending GitHub evidence means `NOT CI PASS`.

## Isolation And Presentation

One StepPracticeRuntime, one StepPracticeController, one attempt owner and one target owner remain. Correctness is exact attack-pitch-set equality for all modalities. No target-conditioned filter is introduced.

Input availability is orthogonal to finalized feedback. Disconnect during capture/analysis cancels unfinished identity and input timer, retaining session/target. Disconnect during POST_VERDICT retains its immutable record and pending transition. Reconnect first establishes a fresh explicit watermark; controller then requests re-arm and consumes a pending transition exactly once. Old completions and old/equal timestamps remain invalid.

Hook exposes `stepInteractionPhase`, `canAcceptAttempt`, last finalized record and current group from controller snapshots. UI derives capture/analysis/feedback messages and disables busy Skip. Metronome/current group remain on the answered target until re-arm commits advancement. No hook-owned semantic timers, direct re-arm, or parallel UI state machine.

## Historical Evidence And Future Research

V3-V10 and V11 research source/report trees are unchanged, verified by diff against starting HEAD and a raw-file SHA inventory. Historical V9/V10 safety evidence belongs to the OLD lifecycle, not the newly refactored contract. No old disposition or acoustic seal is rewritten.

Future microphone qualification must be rebuilt only after independent V12 acceptance. Paced learning does not require rapid-retrigger recognition as normal usability. It MUST qualify `NON_READY_INPUT_ISOLATION`: non-owned gestures in CAPTURING and all gestures in ANALYZING/POST_VERDICT must never create attempt2, queue, carry over, advance, or become next-target evidence. Busy/late stress remains mandatory, but old busy/late zero-denominator shipping rules are not automatically inherited unchanged.

V11 candidate/corpus design may later be reused as exposed DEVELOPMENT evidence only. Its old immediate-rearm Stage B scorer is superseded for future execution; no candidate, threshold, H, decoder or holdout is selected here. Future development must bind accepted V12 semantics in a NEW independently authorized protocol.

Portable tooling lesson: Windows absolute filesystem paths must not be passed directly to dynamic ESM `import()`. Future tooling should use `pathToFileURL(absolutePath).href`. V11 is deliberately left untouched.

## Local Verification

- Product Vitest: 29 files, 304 passed, 0 failed, 0 skipped. Focused local-core/STEP/MIDI/hooks/presentation/architecture/capability coverage, not an acoustic research suite.
- STEP browser smoke: 5 passed, 0 failed, 0 flaky, 0 skipped, no model-asset requests. Covers local MIDI, no STEP Pause/Resume, metronome, presentation/range, MIDI retry, and disabled microphone capability.
- TypeScript `--noEmit`: PASS.
- Full ESLint JSON: 0 errors, 1 existing warning (`scripts/step-boundary/prepare-tooling.mjs:3`, prefer-const), not suppressed.
- Full Next webpack production build: PASS. Initial native SWC load was blocked by Windows Application Control; Next used its WASM bindings. Subsequent build used the cached implementation. This is build tooling, not an acoustic fallback path.
- Existing jsdom HTMLMediaElement pause/load messages and browser NO_COLOR/FORCE_COLOR / Verovio encoded-break warnings remain documented, not hidden.
- No Docker/model/backend execution was required or run. No claim of full acoustic Vitest, neural parity or qualification.

Raw test/lint/build/smoke artifacts and exact changed-file/production-file lists are recorded alongside `assessment.json`. The additive remote receipt binds the evidence commit and actual GitHub state; final receipt HEAD is independently fetched and queried in task closeout.

## Stop Boundary

All acoustic/neural execution counters are zero. No production microphone enablement, scientific winner, acoustic survivor or qualification claim. Next allowed action is independent V12 product-contract audit only, not automatic resumption of Wave-1 or microphone integration.
