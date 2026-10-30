# Practice Session Planning

```text
Canonical Practice Source (sourceId + parsed artifact)
  + PracticeExecutionIntent
  -> planPracticeSession
  -> immutable PracticeSessionPlan
       -> STEP execution
       -> Continuous execution
```

## Intent and Plan

`planning/execution-intent.ts` defines the learner/application choices before Start:
mode, input source, recording mode, raw scope, tempo selection and metronome enabled.
STEP owns recording OFF; Continuous admits OFF/AUDIO/VIDEO. Invalid combinations fail
admission. Live note feedback is presentation state and is absent from the intent.

`planning/session-plan.ts` owns semantic planning. `createPracticeSessionPlanner()`
creates a composition-local `planPracticeSession(source, intent)` function. It checks
source identity, canonical artifact validity and intent validity, then resolves scope
and tempo. The frozen plan owns sourceId, the canonical artifact, mode/input/recording,
resolved scope, resolved tempo and the initial metronome flag. Score/revision/artifact
IDs remain owned by the artifact. Scope and tempo projections and canonical notation
are immutable to consumers.

The planner retains only its current semantic resolution. A metronome flag change
uses that same resolved scope and tempo in a fresh immutable candidate plan. A scope,
tempo, source or execution configuration change establishes a new resolution.
This bounded composition-local memo is semantic data, not a resource lease or session
lifecycle owner.

The Practice page constructs the intent from resolved configuration and committed
workspace scope/tempo/metronome choices. The source query supplies sourceId and the
parsed artifact. Page controls read the candidate plan's resolved projections.

## Execution and Runtime State

STEP and Continuous controller options require their mode-specific plan together
with browser/resource ports. They receive no parallel raw scope or tempo selection.
Pure domain components receive narrow resolved projections and do not plan intent.

STEP initializes target progression from the planned scope indexes. Its metronome
uses the plan's artifact, start/terminal beats and tempo plan. Attack equality,
continuation exclusion, rearm, mismatch and Skip keep their domain owners.

Continuous session, evaluator and performance clock consume the same resolved scope
and tempo. The clock derives transport-only time coordinates and count-in timing.
It receives resolved tempo explicitly. Natural completion reads the executed session
snapshot's scope and tempo; Result schema7 serializes that truth without planning
again and without adding sourceId.

Common local snapshots expose sourceId, resolved scope, resolved tempo and the current
live metronome state alongside local session identity and runtime metadata. The
Continuous performance section owns transport state and elapsed/count-in coordinates.
Scope/tempo truth belongs to the common snapshot.

Runtime state is the mutable attempt/transport lifecycle after Start. The initial
metronome flag is captured at admission. Active enable/disable uses the existing
`setMetronomeEnabled` command. That live control does not replace an execution owner,
change localSessionId, reset progress/transport or resolve scope/tempo.

## Resource Boundaries

The plan contains no devices, AudioContext, inference lease, timers or callbacks.
Existing readiness, device, environment, application controllers and resource-release
coordination own those resources. Both mode hooks are mounted by the local binding;
the selected plan determines execution. Planning does not consolidate resource
requirements or redefine lifecycle/start policy.

Artifact schema3, STEP schema9/runtime `step-piano-key-learning-v12`, Result schema7,
count-in policy, timing/recognition/resource values and acoustic identities are their
current contracts. See the [product contract](practice-product-contract.md) and
[Practice Source](practice-source.md).
