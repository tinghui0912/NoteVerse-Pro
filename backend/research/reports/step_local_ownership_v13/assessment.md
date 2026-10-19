# V13 Local STEP Ownership

`STEP_LOCAL_OWNERSHIP_V13_APPLICATION_RUNTIME_LIFECYCLE_SEPARATED`

Disposition: `STEP_LOCAL_OWNERSHIP_V13_APPLICATION_RUNTIME_LIFECYCLE_SEPARATED_ACOUSTIC_BAKEOFF_NOT_STARTED`.

## Separate Authorities

- `StepControllerState`, defined in StepPracticeController, is the browser application/resource lifecycle: IDLE / PREPARING / ACTIVE / ENDED / DISPOSED. Preparation, asynchronous MIDI start cancellation, resource cleanup and application disposal remain controller concerns.
- `StepRuntimeStatus`, defined in the local domain snapshot contract and written only by StepPracticeRuntime, is ACTIVE / ENDED. Runtime construction is ACTIVE. Runtime types cannot represent IDLE, PREPARING or DISPOSED.
- Attempt interaction independently remains READY / CAPTURING / ANALYZING / POST_VERDICT. V12 attempt semantics are unchanged.
- The old shared StepPracticeLifecycle type is removed without compatibility/deprecated aliases. There is no universal STEP/Continuous lifecycle enum.

## Snapshot And Identity

LocalStepSessionSnapshot now serializes `runtimeStatus`, not `lifecycleState`. STEP snapshot schema/runtime identity is bumped to 5 / `step-paced-attempt-v5`. No v4 snapshot parser or compatibility shim is introduced; immutable V12 artifacts remain v4 evidence.

`completionReason` stays separate. Natural scope completion is runtimeStatus=ENDED, completionReason=SCOPE_COMPLETED, completed=true. User Stop is runtimeStatus=ENDED, completionReason=STOPPED_BY_USER without fabricating completed=true or committing pending MATCH. Final MATCH still waits for explicit rearm before consuming its pending transition and advancing generation/index once. Existing READY-only explicit Skip behavior is unchanged.

The runtime's existing `state` getter is narrowed to StepRuntimeStatus. It is a domain-only read of the same private status, not an application lifecycle alias. Runtime snapshots expose only runtimeStatus for domain terminal status.

`localSessionId` still identifies a local practice instance. Score/revision/artifact identity, scope, input source, tempo/metronome, timestamps, target generation, bounded attempt/Skip history and completion reason are preserved. It is NOT a backend Practice runtime, WebSocket session, matchmaker session, server authority or transport identity.

During controller PREPARING, an internal runtime may already exist and truthfully report runtimeStatus=ACTIVE while input is unavailable. Controller readiness remains false. Hook exposes applicationState and runtimeStatus distinctly; generic UI `lifecycle` denotes application presentation only. Hooks neither mutate runtime status nor own semantic re-arm timing.

Continuous domain/transport/session semantics are independent and unchanged, including its lifecycleState field, PAUSED/count-in/finalization. The existing UI type unions remain thin presentation boundaries, not shared domain authority.

## Vocabulary Audit

`vocabulary-inventory.json` lists production STEP, shared local-core dependencies and STEP hook occurrences with file/line/context and classification:

- A: valid local practice-instance identity, local metadata or same-instance time domain; retained.
- B: valid browser application/resource lifecycle or explicitly documented UI presentation state; retained under controller ownership.
- C: valid domain status/completion metadata; STEP narrowed to ACTIVE/ENDED. Shared Continuous metadata remains independent.
- D: obsolete server/session authority; no active occurrence found. Negative server/WebSocket/matchmaker boundary documentation is not active authority.

No backend lifecycle authority was reintroduced. No historical research evidence was renamed. The normalized source audit verifies the complete runtime implementation equals V12 after only the enumerated type/private-field/serialized-field renames. Controller method bodies are byte-for-byte unchanged after its type/import/comment change. MIDI gesture and retirement-policy source are unchanged.

## Verification

30 focused deterministic test files: 315 passed, 0 failed, 0 skipped. Includes terminal runtime guards, natural completion versus user Stop, PREPARING versus internal ACTIVE truthfulness, async preparation failure/disposal, cleanup/completion cardinality, type/architecture assertions, and all accepted V12 paced/MIDI/watermark regressions. TypeScript --noEmit and full Next webpack production build PASS. Full ESLint JSON: 0 errors, 1 existing prefer-const warning in scripts/step-boundary/prepare-tooling.mjs:3.

STEP browser smoke: 5 passed, 0 failed, 0 flaky, 0 skipped; no model-asset requests. Existing jsdom HTMLMediaElement pause/load diagnostics, browser NO_COLOR/FORCE_COLOR and Verovio encoded-break warnings are retained. Raw generated logs are not normalized to hide progress-line whitespace. This is local verification, NOT GitHub CI.

GitHub combined status, individual statuses and workflow runs are queried at the starting/evidence commits and again at final receipt HEAD. Pending with empty statuses/workflow_runs means NOT CI PASS.

Exact changed files, historical raw hashes, source-comparison proof, verification counts and remote evidence receipt are machine-readable alongside this report. V3-V12 historical trees and acoustic/model assets remain unchanged.

## No Acoustic Execution

newNeuralRuns=0; decoderRuns=0; modelSessionLoads=0; acousticWorkerConstructions=0; selectedPcmDecodeRuns=0; StageAReruns=0; StageBReruns=0; ContinuousAcousticReruns=0; freshHoldoutAccess=0.

No V11 repair/resumption, no Wave-1, no acoustic evidence, no candidate selection, no scientific claim, no qualification and no fresh holdout access. Future microphone retirement remains contract-only and its minimum duration is not selected. No RMS, spectral flux, onset detector or transient gate is added.

Continuous=MODEL_NOT_VALIDATED; STEP=ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false. Next step is independent V13 audit only. This production ownership shape, once independently accepted, is what a subsequent acoustic development protocol must bind. No automatic acoustic execution follows this cleanup.
