# Practice execution ownership

`application/execution-machine.ts` is the sole root lifecycle authority. Its state
owns READY, STARTING, RUNNING, COMPLETED, RELEASING, ERROR and DISPOSED, executionId,
candidate acceptance, Start/End/Retry, replacement, teardown and completion admission.
`PracticeExecutionActor` hosts its effects and serializes release acknowledgements;
it does not interpret mode commands or concrete controller snapshots.

## Sessions and composition

`PracticeExecutionSession` is a neutral leaf capability: mode, subscribe, observe,
start, retire, dispose, mode commands and mode-owned failure projection. Session
construction returns either a ready session or typed ExecutionFailure. Each adapter
projects start, subscription and release failures to the existing stable public codes;
raw causes remain engineering evidence. Root effects consume that typed projection.

`browser-execution-session-factory.ts` is the cross-mode browser bridge injected by
usePracticeExecution. It selects step/step-execution-session or
continuous/continuous-execution-session. Each mode adapter constructs one concrete
controller and its browser platform, projects immutable ExecutionObservation facts,
and adapts its natural-completion callback. It receives only the accepted plan and
execution-scoped ports, with no workspace preferences, preparation key or route state.

STEP owns skip and live metronome commands. Continuous owns pause, resume, live
metronome, continueWithoutAnalysis, continueWithoutRecording and continueAfterRecovery.
These ports contain no Start/End/Retry/retire/dispose/replacement operations. Controllers
retain distinct mode-internal state machines; they cannot construct another root attempt.

## Exact execution command admission

Every mode command checks the root-supplied capability before calling its controller.
Admission requires RUNNING, the exact executionId and the exact current session handle.
The synchronous transition into RELEASING closes admission before cleanup settles.
COMPLETED, ERROR and DISPOSED also reject commands. A callback retaining A.commands
cannot affect A during retirement or a later B, even after B becomes RUNNING.

The React hook exposes pure PracticeExecutionView facts, separate root start/end/retry
commands and a discriminated modeCommands capability. The page narrows that capability
by mode before wiring callbacks to presentation controls. Initial metronome is captured
in the plan; a live toggle updates the workspace preference and current mode command.

## Release, completion and resources

Root Start/End/Retry and release serialization remain machine-owned. Session retire
maps to its controller's graceful abandon; session dispose performs hard disposal.
Only matching formal SCOPE_COMPLETED evidence can win an End/retirement race. Continuous
reports completion only with its atomic session/result/recording materialization;
STEP reports formal completion with no Continuous completion payload. Root acceptance
fences stale/duplicate callbacks and hard teardown.

Completed leaf ownership retains recording until Review first retains its media handle.
Retry/replacement/teardown then releases the old owner before another session starts.
Release failure blocks overlapping ownership. Candidate rerenders do not replace the
captured executed plan; temporary Start-readiness loss does not revoke an accepted attempt.

Prepared physical roots and PracticeEnvironment remain Workspace-owned. Sessions only
borrow roots/root-health and inference capability. They may create and release their
own runtime contexts, MIDI message bindings, recording clones and metronomes; they never
reacquire devices or close the retained PracticeResourceBinding.
