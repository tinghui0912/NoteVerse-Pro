# Practice Session Planning

```text
Canonical Practice Source (sourceId + parsed artifact)
  + PracticeExecutionIntent
  -> planPracticeSession
  -> immutable PracticeSessionPlan
       -> resources: PracticeResourcePlan
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
resolved scope, resolved tempo, the canonical resource plan and the initial metronome flag. Score/revision/artifact
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

## Resource Planning and Lifetimes

```text
PracticeExecutionIntent (mode + inputSource + recordingMode)
  -> planPracticeResources
  -> immutable PracticeResourcePlan
       -> PracticeSessionPlan.resources
       -> qualification -> Setup / PracticeEnvironment / temporary probes
       -> liveRoots -> PracticeDeviceLease / retained page roots
       -> input -> STEP / Continuous input binding
       -> analysis -> acoustic execution
       -> recording -> recorder audio/video root binding
```

`planning/resource-plan.ts` owns the complete resource matrix. Its input is the
resource-choice projection of `PracticeExecutionIntent`; scope, tempo, metronome,
source/artifact identity and live feedback have no effect on resource requirements.
STEP accepts recording OFF. Invalid mode/input/recording combinations fail admission.
All arrays and nested projections are frozen. Equivalent resource choices return the
same immutable plan and stable projection identities.

The plan contains qualification requirements, live root names, discriminated input
and analysis bindings, and a discriminated recording binding. It contains no
MediaStream, MIDIAccess, AudioContext, inference/recorder instance, callback or health
state. `PracticeDeviceRoots` maps the planned root names directly to acquired objects.

| Mode | Input | Recording | Qualification | Live roots | Analysis | Recording binding |
| --- | --- | --- | --- | --- | --- | --- |
| STEP | MICROPHONE | OFF | acousticEngine, browserAudio, microphone | inputMicrophone | ACOUSTIC: inputMicrophone | OFF |
| STEP | MIDI | OFF | midi | midi | NONE | OFF |
| Continuous | MICROPHONE | OFF | acousticEngine, browserAudio, microphone | inputMicrophone | ACOUSTIC: inputMicrophone | OFF |
| Continuous | MICROPHONE | AUDIO | acousticEngine, audioRecording, browserAudio, microphone | inputMicrophone | ACOUSTIC: inputMicrophone | AUDIO: inputMicrophone |
| Continuous | MICROPHONE | VIDEO | acousticEngine, browserAudio, camera, microphone, videoRecording | inputMicrophone, camera | ACOUSTIC: inputMicrophone | VIDEO: inputMicrophone + camera |
| Continuous | MIDI | OFF | midi | midi | NONE | OFF |
| Continuous | MIDI | AUDIO | audioRecording, microphone, midi | midi, recordingMicrophone | NONE | AUDIO: recordingMicrophone |
| Continuous | MIDI | VIDEO | camera, microphone, midi, videoRecording | midi, recordingMicrophone, camera | NONE | VIDEO: recordingMicrophone + camera |

Input binding is MICROPHONE to inputMicrophone or MIDI to midi. Acoustic execution
uses the planned analysis source root. Microphone recording shares inputMicrophone;
MIDI recording uses recordingMicrophone without acoustic analysis or browserAudio
qualification. Selected-input capability combines the planned input/analysis bindings
with detected browser facts. Recording capability remains separate Setup evidence.

The workspace can plan resources as soon as execution configuration is complete;
artifact, source identity, scope and tempo are not prerequisites for qualification.
`PracticeEnvironment` consumes `qualification` and owns qualification execution and
the warm acoustic engine. `qualificationFingerprint` is the sole qualification-set
identity derivation. Setup probes release their temporary streams, capture and
AudioContext. They do not provide live execution roots.

The exact Practice page gives that same resource plan to `usePracticeDeviceLease`.
The lease consumes `liveRoots`, retains acquired roots, observes them and releases
them on unmount. Its binding transaction, same-root observation and fail-closed
admission are owned by the device boundary. Controller pipeline/analysis/recorder
health remains with its current execution owners.

Both mode hooks are mounted by the local binding; the selected session plan determines
execution. `PracticeResourceCoordinator` sequences release between execution owners.
Resource planning defines requirements and bindings, not acquisition or Start/End
lifecycle.

Artifact schema3, STEP schema9/runtime `step-piano-key-learning-v12`, Result schema7,
count-in policy, timing/recognition/resource values and acoustic identities are their
current contracts. See the [product contract](practice-product-contract.md) and
[Practice Source](practice-source.md).
