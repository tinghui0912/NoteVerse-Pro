# Practice Session Planning

```text
Canonical Practice Source (sourceId + parsed artifact)
  + PracticeExecutionIntent
  -> planPracticeSession
  -> immutable PracticeSessionPlan
       -> resources: PracticeResourcePlan
       -> metronomePlan: ResolvedMetronomePlan
       -> STEP execution
       -> Continuous execution
```

Canonical Practice Source resolution returns a verified READY durable source. Live
revision ownership retains it for Setup/Practice; Take and active reservation references
retain that same source independently of revision deletion. [Practice Source](practice-source.md)
owns persistence and verification. Session planning consumes its identity and artifact.

## Intent and Plan

`planning/execution-intent.ts` defines the learner/application choices before Start:
mode, input source, recording mode, raw scope, tempo selection and metronome enabled.
STEP owns recording OFF; Continuous admits OFF/AUDIO/VIDEO. Invalid combinations fail
admission. Live note feedback is presentation state and is absent from the intent.

`planning/session-plan.ts` owns semantic planning. `createPracticeSessionPlanner()`
creates a composition-local `planPracticeSession(source, intent)` function. It checks
source identity and intent validity on an admitted runtime artifact, then resolves scope
and tempo. The frozen plan owns sourceId, the canonical artifact, mode/input/recording,
resolved scope, resolved tempo, the canonical resource plan and resolved metronome timing. Score/revision/artifact
IDs remain owned by the artifact. Scope and tempo projections and canonical notation
are immutable to consumers.

The planner retains only its current semantic resolution. A metronome flag change
uses that same resolved scope and tempo in a fresh immutable candidate plan. A scope,
tempo, source or execution configuration change establishes a new resolution.
This bounded composition-local memo is semantic data, not a resource lease or session
lifecycle owner.

The Practice page constructs the intent from resolved configuration and committed
workspace scope/tempo/metronome choices. PreparedPractice supplies its owned sourceId
and parsed artifact without a query. Page controls read the candidate plan's resolved projections.

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
refresh loop or controller physical-health subscription. The retained ResourceBinding and
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
Matching admission, exact Source, root health and engine lifecycle control the next Start.
Intervention End creates no independent readiness state.

Natural scope completion notifies once and retains completed presentation. Retry is
a deliberate command that fully releases the completed attempt and starts one fresh
controller directly. It does not reacquire retained roots or repeat preflight.
The execution view exposes the exact current Continuous completion after natural
completion; STEP exposes null. End, Retry and new execution remove the old completion
from that view. A stale callback cannot restore it. No global completion storage exists.

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
state. Continuous natural Result8 uses the executed scope/tempo without re-resolution.

## Setup Preparation and Retained Admission

```text
Score Detail -> Setup configuration
explicit Start Practice -> fresh revision Source admission
                        -> planPracticeResources(configuration)
                        -> acquire PracticeResourceBinding
                        -> validate SAME roots and acoustic/recording pipelines
                        -> atomically commit PreparedPractice
                        -> Practice borrows admitted artifact and MusicXML
Practice Start -> PracticeExecutionOwner -> selected attempt borrows SAME roots
```

Setup mounts without Source admission or physical acquisition. The command captures
pinned revision and resource configuration, locks selectors and fences asynchronous
completion with an abort signal. Source admission uses `admitPracticeSource`
and the canonical strict parser before any acquisition. Invalid revision admission
blocks this command; transient source failure remains retryable through the same CTA.

`PracticePreparationAdmission` is immutable: a complete AdmittedPracticeSource
(sourceId, artifact, musicXml) and mode/inputSource/recordingMode. The artifact alone
owns score/revision/artifact IDs. `PreparedPractice` pairs that admission with its
retained `PracticeResourceBinding` from the same successful transaction. It exists only
in workspace memory. Scope, tempo, metronome and live feedback do not identify this
admission. Resource choices change it; candidate musical/presentation edits do not.

Setup does not probe and release physical roots before Practice.
The explicit Setup command acquires the live roots that the admitted Practice execution will actually borrow.
Successful preparation does not create a persistent readiness flag.
It creates a retained resource binding plus exact Source admission.

The transaction rolls back its binding on acquisition, validation, cancellation or
stale completion. Commit checks transaction identity, configuration and current root
health atomically. Entering Setup retires any admitted binding before another command.
Unmount, revision/resource configuration replacement and superseding commands fence
pending work; late acquisitions are closed rather than published.

Fresh Source transport consumes the command signal directly and always requests
current admission without using a query cache. Retiring the command
aborts its HTTP request. Recording preflight consumes that same command signal: abort
settles the probe, clears its timeout, detaches recorder handlers and best-effort stops
an active recorder. Validation then releases all temporary cloned tracks immediately;
the resource binding alone releases retained originals. Late probe callbacks cannot
publish into a subsequent transaction.

Practice uses only PreparedPractice, browser URL identity and resource configuration.
It verifies route score/revision against the admitted artifact and makes no Source or
Score-detail request. Direct entry/reload without the memory-only admission shows
Setup required without acquisition, inference or controller construction.

Practice Start checks matching admission, healthy retained roots, valid candidate
scope/tempo and the engine's actual acquisition lifecycle. Capability validation belongs
to Setup. Candidate musical/presentation edits do not replace the physical binding.

## Explicit Transient Review Handoff

The execution owner retains `{ result, recording }` for its current natural Continuous
completion. Try Again creates no ReviewSession. Only View Review calls the workspace's
`handoffToReview(completion)` command. The command checks sourceId and artifact identity,
validates the result/recording, and builds `{ result, recording, artifact, musicXml }`
using the same canonical references and Blob. It releases PreparedPractice's binding
before navigation and retains the handoff in workspace memory.

Review consumes that complete TransientReviewSession, not a Source query. Scope
projection and Verovio render errors remain presentation failures; a second server
source or revision cannot replace admitted notation. Replay, annotations and current
local composite/export use the owned representation even after Score/Revision deletion.

Explicit Review exit clears the handoff. Route entry into Setup or Practice also
invalidates it, including browser Back; unchanged-route renders between handoff and
Review navigation preserve it. Provider disposal releases browser references. A direct
Review visit/reload has no handoff and is expired, with no recovery read or persistence.
Review Retry opens pinned Setup for a fresh admission and physical binding.

## Resource Planning and Lifetimes

```text
PracticeExecutionIntent (mode + inputSource + recordingMode)
  -> planPracticeResources
  -> immutable PracticeResourcePlan
       -> PracticeSessionPlan.resources
       -> qualification -> Setup validation on retained roots
       -> liveRoots -> PracticeResourceBinding / retained physical roots
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

The workspace can plan resources from complete execution configuration. The explicit
Setup command acquires `liveRoots` once. `validatePracticeResources` consumes those
objects, detects current capabilities and verifies connected/live tracks. It acquires
no physical devices. Recording preflight starts/stops a real MediaRecorder with the
same MIME strategy as execution, using clones of the planned audio/video roots;
clones are released on every outcome and retained original tracks stay live.

`PracticeEnvironment.validateAcoustic` borrows the retained input microphone for a
temporary AudioContext/FIR/capture pipeline and owns the warm model/worker engine.
Temporary processing objects are released while the microphone and healthy engine
remain retained. Model preparation performs its controlled smoke inference. When an
old attempt is LEASED/RETIRING, validation observes its retirement without stealing
the lease. Attempt Start creates fresh processing resources and inference leases.

`usePracticeResourceBinding` observes the supplied binding without opening/closing it.
Replacement/clear immediately hides retired roots and fences late owner callbacks.
The binding alone interprets physical health. It never reacquires after a fault.
Physical roots may fail after successful preparation; such a failure is an event on the same retained binding, not a second acquisition failure.

Attempt End, natural completion and same-page Retry retain the binding. Entering
Setup, Review, leaving the route family, configuration replacement or explicit
abandonment closes it exactly once. Review navigation releases physical roots before
routing; Review owns only its transient handoff. Pipeline faults do not close the binding.

Resource planning defines requirements and bindings, not acquisition or Start/End
lifecycle. `PracticeExecutionOwner` serializes attempt release before any new controller
construction.

Artifact schemaVersion 1, STEP schema9/runtime `step-piano-key-learning-v12`, Result schema8,
count-in policy, timing/recognition/resource values and acoustic identities are their
current contracts. See the [product contract](practice-product-contract.md) and
[Practice Source](practice-source.md).

## Physical Root Health and Pipeline Health

```text
PracticeResourcePlan.liveRoots
  -> PracticeResourceBinding
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

ResourceBinding observes borrowed media-track mute/unmute/ended and retained MIDIAccess
statechange. A required live unmuted media track is HEALTHY, a muted live track is
INTERRUPTED, and a missing/ended track is LOST. MIDI is HEALTHY with at least one
connected input and LOST otherwise. Same-access MIDI reconnects refresh message
routing. Health notifications also permit refreshing routing when connected input
membership changes while the MIDI root remains HEALTHY. No execution consumer
reacquires roots.

Physical root health is distinct from processing pipeline health:

| Fact | Owner |
| --- | --- |
| Borrowed microphone/camera mute or end | ResourceBinding |
| Retained MIDIAccess connectedness | ResourceBinding |
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
strongest recoverability and the single canonical pause. ResourceBinding never interprets
context, capture, analysis or recorder failures as physical root loss.

## Metronome Plan, Runtime and Audio

`PracticeSessionPlan.metronomePlan` is the immutable musical projection owned by
session planning. It contains STEP/CONTINUOUS mode, meter segments, resolved tempo,
finite timeline end, scope start/end and initial enabled state. Meter timing is
nonempty, explicitly MUSICXML-sourced and starts at beat 0. Missing initial meter
fails admission; planning and runtime perform no meter repair. Runtime receives no
Artifact and performs no semantic scope/tempo resolution. A candidate initial-enable
change reuses the same resolved scope and tempo.

Mode controllers compose `MetronomeRuntime(plan.metronomePlan, audio)` with a
`MetronomeAudioPort` supplied by browser infrastructure. Musical plan fields are
immutable during the attempt. The runtime owns enabled/running state, pulse cursor
and one 25ms scheduling interval with a 100ms lookahead. Pause, stop and idempotent
disposal clear the interval; disposed callbacks cannot restart scheduling.

STEP commands the current target onset and has no count-in. Its meter grid follows
that target; repeated pulses keep the BPM at the target until the target changes.
Continuous commands `continuousMetronomeSyncPoint` from its canonical transport:
COUNT_IN carries exact remaining phase and RUNNING carries the current musical beat.
Metronome mirrors those coordinates without owning another count-in policy or clock.
Live enable resynchronizes against the current mode context; disable silences future
click scheduling. Both commands preserve the attempt, scope, tempo and progression.

The browser audio adapter owns Web Audio construction/resume, click oscillator/gain
envelopes and context release. Microphone attempts provide a BORROWED attempt context,
which metronome disposal never closes. MIDI uses an OWNED metronome context, constructed
on audio activation and closed at most once. `MetronomeAudioPort` exposes only
`activate`, `nowMs`, `scheduleClick({ atMs, accent })` and `dispose`. Optional audio
creation/resume/click/cleanup faults stay nonfatal and cannot become physical root,
analysis, recording or critical attempt-cleanup failures.


## Meter and Count-In policy

The artifact supplies admitted meter facts: `startBeat`, `numerator`, `denominator`.
The pure score-domain measure-duration helper derives quarter beats using canonical
six-decimal rounding. `kernel/count-in.ts` owns the execution policy: a full active
measure supplies Count-In duration, and its numerator supplies the number of pulses.
Thus 3/4 gives 3 beats/3 pulses, 6/8 gives 3 beats/6 pulses, and 2/2 gives 4 beats/2
pulses. Count-In pulses are not part of the score artifact or source identity.

Metronome pulse-grid policy uses a step of `4 / denominator`, with downbeats and pulse
indices derived from the same admitted meter and measure-duration helper. Invalid
meter invariants fail closed. Continuous PerformanceClock owns the actual countdown;
MetronomeRuntime consumes its live sync point. STEP has no Count-In.

## Executed Source Provenance

PracticeSessionPlan.sourceId is the admitted canonical durable source identity.
Local STEP and Continuous session snapshots retain it. Natural Continuous completion
verifies session/artifact descriptive identity and copies session.sourceId verbatim
into Result schema8. The explicit workspace Review handoff validates and preserves
that identity with the admitted artifact and notation; save sends only source_id as Source lineage.
Source authorization and retention belong to [Practice Source](practice-source.md).

## Durable Save Planning

Browser planning owns live execution truth. A save submits the admitted sourceId,
FULL or RANGE moment selection, tempo selection and media/recording evidence.
`app/modules/practice/planning/score_plan.py` owns pure server planning from the
verified exact Source artifact. FULL spans the first moment onset to scoreEndBeat;
RANGE spans its selected start onset to its selected end canonicalEndBeat.

The server resolves a score-wide tempo plan: missing initial MusicXML tempo uses
PRODUCT_DEFAULT 80 BPM; explicit segments remain MUSICXML. CUSTOM_FIXED_BPM accepts
finite 40–240 BPM, retains the raw selection and rounds the segment BPM upward at
positive half-integers, matching browser Math.round. Scope does not trim tempo.

Both language implementations consume the same concrete expected
[planning cases](../../contracts/practice/score-planning-cases.json). The reservation
response separates intent metadata from resolved_scope and resolved_tempo_plan.
Before media upload, the browser compares that canonical response with Result8's
executed source/scope/tempo. A mismatch fails closed and best-effort cancels a new
RESERVED upload. Completed replay and finalize responses also require agreement.

Reservation persistence owns the resolved save truth. Replay compares the stored
intent/evidence without new authorization or planning; finalize transfers the saved
scope/tempo unchanged to the Take, including after live revision deletion.

## Durable Media Provenance

Save Recording is a new server admission, independent of the browser's admitted flow.
The server authorizes the exact live Source and resolves durable scope/tempo before
committing a self-contained UploadReservation. Deletion before this admission denies
new saves; deletion afterward does not revoke that reservation. Finalize copies its
provenance and canonical plan into PerformanceTake without Source reads or replanning.
PracticeSource follows ScoreRevision lifetime only. Take owns raw media and historical
provenance, not retrievable score content. Saved local score-based export requires a
currently authorized generic exact-source read; raw media remains independently usable.

## Browser-local Video Export

VideoExport consumes a source-neutral VideoExportSession containing sessionId, sourceId,
score identity, video, scope, tempo and recording timebase. The current Review adapter
uses the transient admitted representation; it initiates no Source read. The saved
Take adapter uses generic exact-source authorization for optional score-based export.
Both feed the same clean-score preview/render pipeline and browser Blob download.
Export creates no server asset and grants no sharing access.
