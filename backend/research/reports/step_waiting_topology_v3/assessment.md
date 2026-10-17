# Waiting-user product topology v3

Disposition: `STEP_WAITING_USER_PRODUCT_TOPOLOGY_NOT_ESTABLISHED`.

## Stop condition

The mandatory **current-freeze Continuous engineering prerequisite did not pass**. No STEP Stage A inference, acoustic seal, MIDI/target Stage B scoring, or promotion followed the failure. No retry, model/decoder/H change, resource-ceiling change, corpus replacement or production patch was attempted to obtain a PASS.

This is a Continuous browser capture/resource prerequisite failure. It is **not a measured failure of the fixed STEP50ms candidate**, whose new corpus remains acoustically unexecuted. Architecture, empirical false-MATCH, recognition and latency metrics for that corpus are **NOT MEASURED**, not zero.

## Current-freeze witness

Engineering sequence:

| Rate | Cell | Result | Confirmed Neural Runs |
| --- | --- | --- | --- |
| 44100 | natural_recording_offline | PASS | 2 |
| 44100 | count_in_cancel_multiple_pause_manual_stop | PASS | 3 |
| 44100 | pause_near_terminal_resume_natural | PASS | 3 |
| 44100 | recording_analysis_failure_running | FAILED | incomplete |
| 48000 | all four cells | NOT STARTED | 0 |

Underlying code: `ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED`. This is the unchanged production Worklet's fail-closed condition `sequence - nextAck >= 32`, not the previous capture chronology error. `chronologyFailures=[]`. The exact ACK-stall scheduling cause is not established by these receipts; no profiling result or provider-failure theory is asserted.

At the failed-cell snapshot: source rate44100, 1191 accepted128-sample blocks, `nextSourceSampleIndex=152448`, `windowsQueued=1`, `windowsStarted=1`, `windowsPublished=0`, `outstanding=1`, no publications, runtimeFAILED. Exact model identity/ORT/WebGPU load succeeded. One Worker/session was constructed. The snapshot is taken before cleanup, so its outstanding window is not proof of a persistent resource leak.

The accepted harness explicitly called `controller.pause()` at approximately400.544ms and was waiting for the first window to publish and drain before Resume and intentional Worker-failure injection. The unexpected capture failure happened during that wait. Therefore the PAUSED transport/recorder snapshot must **not** be represented as acoustic failure pausing transport. `AudioContext.state=running` and root tracklive were recorded. The intended running-analysis-failure isolation probe was not reached; this cell did not qualify.

Confirmed current-freeze neural executions are **8**, with `modelRunCountComplete=false`: one source window started but no model-run receipt returned before failure. Exact count is unavailable and is not guessed. STEP holdout executions are **0**. Invalidated f2 performed94 Continuous executions. Whole-phase confirmed lower bound is102; exact phase count is incomplete. Fake inference, compilation, model load and DSP-only work are not neural runs.

## Prospective chain and proof

- Starting HEAD `966ea6b1a74907544ab9419b52a69700b067a993` was fetched and matched both remote and local, with a clean worktree.
- Initial tooling `44ad8013`; f1 freeze `c59bd356`.
- f1 invalidated before any neural run: old equal-pitch physical truth cannot corroborate a post-watermark attempt. Fix/test commit `0607d656`.
- f2 freeze `fd585d4b`; static and Continuous regression passed under it, but it was invalidated before STEP inference by metadata-only terminal coverage audit. Two cross-publication cases needed a full possible50ms capture beyond semantic end. Fix `d0cb1ff8` extends only real tail coverage by one full600ms interval; no occurrence, arm, H, intended waveform or production source changed.
- Acceptance-cycle f3 freeze `98f531aa98c69bc95b6bb5b85dc1de4728f08730`.
- Freeze SHA256 `e3b7750766c96b84214e3a1f9b53cd823cbd863d8135e01ec90afff9baac097c`.
- Static remote verification `2026-10-17T22:00:07.359Z`, execution start `2026-10-17T22:00:07.940Z`.
- Engineering remote verification `2026-10-17T22:01:56.557Z`, execution start `2026-10-17T22:01:57.187Z`.
- Earlier PASS results are historical invalidated-cycle receipts only; they are not inherited for f3 acceptance.

Every executed artifact contains its own pre-execution remote proof. `engineering.json` preserves the full failed-cell payload and browser diagnostics; `verification.json` preserves all test results and actual lint messages. Full implementation/freeze chain is in `final.json`; evidence/GitHub commits follow separately.

## Fixed qualification contract prepared, not accepted

H remains exactly50ms, first eligible source anchor, half-open interval, no extension or target-aware close, source-coverage sealing. No strike detector, threshold search, model science or inference gate was introduced.

The frozen causal harness supplies original context-prefix PCM while semantic input is unavailable. It stops physical supply at the predeclared integer source arm watermark, verifies actual startup inference completion, actually arms READY, and only then supplies future user PCM. Inference delays extend waiting, not source timestamps or internal waveform timing. Source arming/capture, model availability wall time, and product verification are separate. Replay is backpressured offline engineering infrastructure, not real-time physical capture or UX latency evidence.

Subsequent READY retires the authoritative physically supplied source watermark, including ANALYZING/RESET input and late receipts. Source ownership, raw acoustic observation identity and50ms bounds are score-blind. Only post-seal Stage B imports production `StepPracticeRuntime`; nearby physical truth must itself be post-watermark and full-pitch-set corroborating. RETRY classifier is not implemented.

No Stage A server was started for these STEP cases. No truth/score entered the acoustic path. There is **no new acoustic seal SHA** because no STEP acoustic execution occurred. Prepared MIDI metadata is not an acoustic qualification result.

## Corpus inventory

28 case slots /56 rate-cases correspond to **24 unique physical occurrences**, not56 independent performances. Ten selected recordings. Six core READY categories each have2 physical occurrences from2 recordings; held-note and pedal guards likewise each have2 separate guards from2 recordings. Core occurrences are not reused. Suppression scripts can reuse one physical occurrence across distinct controlled analysis/reset/late conditions; all such reuse is visible in the manifest.

Prior STEP decoded sufficiency/assembly development, fresh-strike development, waiting V2 and known historical STEP exposures were excluded by recording ID, audio SHA and MIDI SHA. Exact sources, hashes, selected ranges, exclusion receipts, minimum-source counts and numeric arming scripts are frozen in `inventory.json`, `truth.json`, `jobs.json`, and the freeze. The same original physical occurrence supplies both rates. No downloaded/raw audio or MIDI was committed. No external dataset was downloaded. SMD is not globally blind due prior AMT/Continuous exposure; no scientific-independence claim is made.

## Current-freeze static verification

- Vitest: **151 files,1131 passed,0 failed**, including8 new focused tests.
- Node research/accounting: **5 passed**; Python metadata tests: **4 passed**.
- TypeScript noEmit: **PASS**; full Next webpack production build: **PASS**.
- ESLint: **0 errors,1 existing warning**, path `scripts/step-boundary/prepare-tooling.mjs`, rule `prefer-const`, message `'text' is never reassigned. Use 'const' instead.`, severity1, line3, column6.
- Docker asset unittest: **4 passed**; Docker route tests: **3 passed**, existing `PytestConfigWarning: Unknown config option: asyncio_mode` retained.
- Current-freeze Continuous engineering: **3 PASS,1 FAILED,4 NOT STARTED**. Musical replay/controller/parity: **NOT STARTED** after the prerequisite failure.

## Protected identities and limits

Production diff across `apps/customer-web/src`, `apps/customer-web/public`, and `backend/app` is empty. No controller, hook, MIDI, STEP lifecycle, Continuous, model, decoder, FIR, Worklet or capability code changed. The canonical existing Continuous research runner is reused directly, not forked.

Exact Robust asset: `practice-acoustic-robust-browser@v1`, 98,689,283bytes, SHA256 `4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3`, ORT Web1.20.1, WebGPU, automatic fallbackfalse, decoder .30/.05, owned600/past1050/future170ms. FIR identities unchanged. The32-credit transport ceiling remains enforced; it was not widened or bypassed after failure.

Continuous=`MODEL_NOT_VALIDATED`; STEP=`ATTEMPT_ANALYZER_NOT_VALIDATED`; productionMicrophone=false; D4=false. Previous V2 BLOCKED result remains unchanged. No perfect strike detection, real-device, commercial, scientific-winner, universal safety, microphone enablement or UX-SLO claim is made.

STOP. No STEP integration or further qualification follows. Await independent audit. GitHub receipt is separate; local tests/build are not CI PASS.
