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
source identity and intent validity on an admitted runtime artifact, then resolves scope
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

## Explicit Execution Ownership

```text
Pinned revision -> Canonical Practice Source -> strict artifact admission
  -> PracticeExecutionIntent -> candidate PracticeSessionPlan -> READY
  -> explicit Start -> PracticeExecutionOwner -> one selected controller
                                       STEP / Continuous
```

`usePracticeExecution` bridges React presentation and the ordinary
`application/practice-execution-owner.ts` owner. READY has no attempt controller,
platform, inference lease, AudioContext, MIDI message binding, recorder, metronome,
refresh loop or controller physical-health subscription. The page DeviceLease and
workspace Environment have their independent retained lifetimes.

The candidate plan is editable before Start. Scope, tempo and initial metronome
choices update candidate data only. Start captures the exact immutable plan and
constructs one selected controller. That executed plan controls the attempt's scope,
tempo and presentation. Candidate rerenders cannot replace it. Scope/range/tempo
editing is locked during preparation, active/paused execution and finalization.
Metronome enable/disable remains a live command on the same session.

Both STEP and Continuous require user Start. STEP starts learning input acceptance
without count-in or a performance clock and may wait indefinitely for the first note.
Continuous starts its count-in and canonical transport. End detaches presentation,
fences callbacks, abandons/disposes the selected controller, and returns READY.
Current source/environment/device/capability admission controls the next Start.
Intervention End creates no independent readiness state.

Natural scope completion notifies once and retains completed presentation. Retry is
a deliberate command that fully releases the completed attempt and starts one fresh
controller directly. It does not reacquire page roots or requalify the Environment.
The owner clears the transient Continuous completion handoff only at genuine new
attempt construction and publishes it only from the current natural completion.

The owner holds one release chain. A new controller waits for old disposal and any
late preparation to settle. Generation plus selected-controller identity fences
snapshots and natural completion. Composition/route identity replacement retires the
old owner; ordinary candidate edits do not. Cleanup failure remains visible and blocks
replacement. The React bridge uses subscriptions, not mode-specific mounted hooks or
an idle refresh loop.

STEP and Continuous controllers retain their distinct domain and pipeline owners.
They consume admitted plans, browser roots and the read-only root-health port.
Pure runtime components consume resolved projections without full score traversal.
Common local snapshots expose sourceId, resolved scope/tempo and current metronome
state. Continuous natural Result7 uses the executed scope/tempo without re-resolution.

## Score Admission

`usePracticeRevisionSource` maps the untrusted source envelope through
`parsePracticeScoreArtifact()` and verifies source/score/revision identity. The strict
parser owns revision-wide score correctness. Setup prominently displays invalid-score
state and disables preparation; mode/input/Section cannot repair the revision.
Practice consumes that same admission result as a defensive route gate and creates no
execution plan/controller for missing, invalid or failed source data. Revision pinning
is retained. Planning validates intent, sourceId, scope/tempo selection and resource
combinations; execution assumes the artifact was admitted. It does not introduce
another full artifact validator.

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
admission are owned by the device boundary. DeviceLease is the sole physical health interpreter of the retained roots.
Controllers consume its read-only port; pipeline health has separate owners.

Resource planning defines requirements and bindings, not acquisition or Start/End
lifecycle. `PracticeExecutionOwner` serializes attempt release before any new controller
construction.

Artifact schema3, STEP schema9/runtime `step-piano-key-learning-v12`, Result schema7,
count-in policy, timing/recognition/resource values and acoustic identities are their
current contracts. See the [product contract](practice-product-contract.md) and
[Practice Source](practice-source.md).

## Physical Root Health and Pipeline Health

```text
PracticeResourcePlan.liveRoots
  -> PracticeDeviceLease
       -> retained roots and physical root health
       -> PracticeRootHealthPort
            -> STEP application owner
            -> Continuous application owner
                 -> AudioContext / capture / analysis / recorder pipelines
```

`PracticeRootHealthPort` exposes immutable root-keyed HEALTHY, INTERRUPTED and LOST
facts through `snapshot()` and `subscribe(listener)`. Subscription registers the
listener and synchronously delivers current facts. Controllers assign their detach
function, then recheck the current snapshot before admission. This closes the
snapshot/subscription gap without polling or relying on React rendering. Only the
active execution owner subscribes; cleanup detaches the subscription.

DeviceLease observes borrowed media-track mute/unmute/ended and retained MIDIAccess
statechange. A required live unmuted media track is HEALTHY, a muted live track is
INTERRUPTED, and a missing/ended track is LOST. MIDI is HEALTHY with at least one
connected input and LOST otherwise. Same-access MIDI reconnects refresh message
routing. Health notifications also permit refreshing routing when connected input
membership changes while the MIDI root remains HEALTHY. No execution consumer
reacquires roots.

Physical root health is distinct from processing pipeline health:

| Fact | Owner |
| --- | --- |
| Borrowed microphone/camera mute or end | DeviceLease |
| Retained MIDIAccess connectedness | DeviceLease |
| MIDIInput message listener binding and NOTE_ON/OFF parsing | BrowserMidiController |
| AudioContext state | Execution pipeline |
| Capture bridge validity / worker or model failure | Acoustic pipeline |
| Owned recording clone tracks / MediaRecorder state and errors | Recorder pipeline |

STEP microphone interruption suspends unfinished acoustic evidence and preserves the
session and target. HEALTHY recovery uses the canonical physical retirement boundary;
LOST causes the infrastructure intervention. STEP MIDI loss cancels the gesture and
makes input unavailable. Same-access recovery refreshes routing and advances the
retirement watermark on the same session and target.

Continuous combines normalized microphone facts with AudioContext health in
`ContinuousMicrophoneHealth`. Source interruption is recoverable on the same pipeline;
source loss is restart-required. Suspended/interrupted context is recoverable and
closed context is restart-required. Capture invalidity remains a separate hard
pipeline fact. MIDI loss pauses the canonical transport and reports NO_CONNECTED_INPUT;
recovery preserves position and requires explicit intervention/user continuation.

The application maps planned recording roots to AUDIO/VIDEO source-health facts.
`PerformanceRecorder` consumes those facts without retaining borrowed-track health
observers. It independently watches its owned clone tracks and MediaRecorder. Both
physical and pipeline incidents preserve their audio/video mute/ended meanings,
strongest recoverability and the single canonical pause. DeviceLease never interprets
context, capture, analysis or recorder failures as physical root loss.
