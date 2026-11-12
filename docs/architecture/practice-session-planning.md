# Practice Session Planning

```text
Canonical Practice Bundle (bundleId + parsed artifact)
  + PracticeIntent
  -> planPractice
  -> immutable PracticePlan
       -> resources: PracticeResourcePlan
       -> metronomePlan: ResolvedMetronomePlan
       -> STEP execution
       -> Continuous execution
```

PracticeBundle resolution authorizes a revision and reads its explicit binding before
compilation. Multiple revisions can share one immutable content Bundle. Only revision
bindings retain the representations. Take and UploadReservation retain provenance
snapshots; raw media remains independently accessible. Saved score export reauthorizes
the saved revision binding and requires exact Bundle/artifact identity agreement.
See [Practice Bundle](practice-bundle.md).

## Intent and Plan

`planning/intent.ts` defines the learner/application choices before Start:
mode, input source, recording mode, raw scope, tempo selection and metronome enabled.
STEP owns recording OFF; Continuous admits OFF/AUDIO/VIDEO. Invalid combinations fail
admission. Live note feedback is presentation state and is absent from the intent.

`planning/practice-plan.ts` exposes the pure `planPractice(bundle, intent)` function.
It validates the Bundle binding identity and choices, and resolves scope, tempo, resources,
metronome timing and Continuous initial Count-In. Equal semantic inputs produce equal
plans independently of call history. Each immutable `PracticePlan` owns:

- `bundle`: revision binding and the admitted artifact; notation remains in AdmittedPracticeBundle.
- `mode`: STEP_BY_STEP or CONTINUOUS_PLAY.
- `scope`, `tempoPlan`, `metronomePlan`: resolved musical execution facts.
- `resources`: input, analysis and recording requirements, without physical objects.
- `countIn`: Continuous initial execution policy; STEP has no Count-In.

Input kind and recording mode are read from `resources`; score/revision/bundle IDs
remain owned by `bundle.binding`, and artifactId by `bundle.artifact`. Planning does not retain mutable caches or sessions. It freezes only its own projections;
bundle admission owns the deeply immutable artifact, whose reference is reused unchanged.

The Practice page constructs the intent from resolved configuration and committed
workspace scope/tempo/metronome choices. PreparedPractice supplies its owned bundleId
and parsed artifact without a query. Page controls read the candidate plan's resolved projections.

## Explicit Execution Ownership

```text
Pinned revision -> Canonical Practice Bundle -> strict artifact admission
  -> PracticeIntent -> candidate PracticePlan -> READY
  -> explicit Start -> PracticeExecutionActor -> one selected controller
                                       STEP / Continuous
```

`usePracticeExecution` bridges React presentation and the ordinary
`application/practice-execution-actor.ts` actor. READY has no attempt controller,
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
Continuous starts its count-in and canonical transport. End immediately fences ordinary
observations and asks the selected controller to retire gracefully. End before the
formal scope-completion latch abandons and returns READY after hard disposal.
An already-latched natural completion finishes its cleanup and reaches COMPLETED.
Matching admission, exact bound Bundle, root health and engine lifecycle control the next Start.
Intervention End creates no independent readiness state.

Natural scope completion notifies once and retains completed presentation. Retry is
a deliberate command that fully releases the completed attempt and starts one fresh
controller with that exact executed PracticePlan. Candidate preference changes do not
change Retry semantics. Admission loss or composition replacement cancels restart. It does not reacquire retained roots or repeat preflight.
The execution view exposes the exact current Continuous completion after natural
completion; STEP exposes null. End, Retry and new execution remove the old completion
from that view. A stale callback cannot restore it. No global completion storage exists.

`execution-machine.ts` owns the explicit READY, STARTING, RUNNING, COMPLETED,
RELEASING, ERROR and DISPOSED states. STARTING distinguishes scheduled preparation
from controller construction in progress. Each accepted execution has one executionId,
plan and composition identity. Async start, controller observation, completion and
release outcomes return as identity-scoped events. Stale outcomes are ignored by
the pure reducer. Public views are pure projections of accepted state and its latest
leaf observation, without reading controller handles.

The actor runs preparation, construction/start, retirement, disposal and completion-notification
effects. Its single opaque runtime handle owns the controller, subscription detach
and preparation acknowledgement. RELEASING owns an explicit reason (END, REPLACEMENT,
RETRY or DISPOSE) and phase (RETIRING or DISPOSING). END first waits for leaf abandon
and late preparation. Only a matching formal SCOPE_COMPLETED event can cross that
retirement fence; ordinary updates and Start results remain fenced. A natural outcome
reaches COMPLETED after retirement settlement, with one notification and without
hard-disposing its retained completion owner. An abandonment outcome proceeds to
hard disposal. A new execution cannot be constructed before complete release.
Release failure blocks Start. Composition/admission replacement and route teardown
hard-dispose without accepting late completion or automatically starting a replacement.
Losing the admitted Bundle projection revokes ownership. Temporary Start-readiness
changes, including a leased inference engine, do not revoke an already accepted plan.
Natural SCOPE_COMPLETED transitions before one completion notification; Continuous
also requires its atomic result/recording payload. STOPPED_BY_USER is abandonment.

The React bridge subscribes, forwards commands and supplies candidate admission.
Its cleanup hard-fences the leaf immediately; an effect-lifetime microtask permanently
disposes the actor only for an actual unmount, preserving StrictMode remounts.
Device acquisition and mode-specific progression remain outside the actor.

STEP and Continuous controllers retain their distinct domain and pipeline owners.
They consume admitted plans, browser roots and the read-only root-health port.
ContinuousPracticeController hosts effects for a pure Continuous control machine.
ContinuousControlState owns its lifecycle, analysis coordination, resource incidents
and shared pause ownership. All browser callbacks and operation-scoped asynchronous
results enter its event mailbox; clock mutations, finalization and cleanup execute
only as machine effects. Synchronous callbacks wait until the current clock
transaction returns. PerformanceClock, evaluation and recording keep their own
authorities. Snapshot reads are passive; refresh explicitly catches up semantic time.
Natural terminal latching owns finalization, and COMPLETE is published only after
atomic completion materialization and complete resource release.
Pure runtime components consume resolved projections without full score traversal.
`session/session.ts` defines the common `PracticeSession` snapshot contract:
localSessionId, the executed plan, createdAtMs, updatedAtMs and completionReason.
Only Start creates a concrete `StepPracticeSession` or `ContinuousPracticeSession`.
Their constructors receive the matching mode-specific plan and runtime infrastructure.
Snapshots reference that exact plan and add mode-specific state; musical facts are
not copied into sibling fields. Natural Continuous Result carries one ExecutedPerformance created at natural completion.
It preserves the Plan bundle, scope and tempo references without re-resolution.

`score/` owns admitted artifact facts, piano keys and exact score coordinates.
`planning/` owns intent, scope/tempo/resource/metronome resolution and Count-In policy.
`session/` owns local execution identity and runtime clock mapping. Score depends on
neither planning nor runtime; planning depends on score; session depends on planning;
mode domains consume these packages without importing each other or browser controllers.

## Setup Preparation and Retained Admission

```text
Score Detail -> Setup configuration
explicit Start Practice -> fresh revision Bundle admission
                        -> planPracticeResources(configuration)
                        -> acquire PracticeResourceBinding
                        -> validate SAME roots and acoustic/recording pipelines
                        -> atomically commit PreparedPractice
                        -> Practice borrows admitted artifact and MusicXML
Practice Start -> PracticeExecutionActor -> selected attempt borrows SAME roots
```

Setup mounts without Bundle admission or physical acquisition. The command captures
pinned revision and resource configuration, locks selectors and fences asynchronous
completion with an abort signal. Bundle admission uses `admitPracticeBundle`
and the canonical strict parser before any acquisition. Invalid revision admission
blocks this command; transient Bundle failure remains retryable through the same CTA.

`PracticePreparationAdmission` is immutable: a complete AdmittedPracticeBundle
(binding, artifact, musicXml) and mode/inputSource/recordingMode. The artifact alone
owns score/revision/artifact IDs. `PreparedPractice` pairs that admission with its
retained `PracticeResourceBinding` from the same successful transaction. It exists only
in workspace memory. Scope, tempo, metronome and live feedback do not identify this
admission. Resource choices change it; candidate musical/presentation edits do not.

Setup does not probe and release physical roots before Practice.
The explicit Setup command acquires the live roots that the admitted Practice execution will actually borrow.
Successful preparation does not create a persistent readiness flag.
It creates a retained resource binding plus exact Bundle admission.

The transaction rolls back its binding on acquisition, validation, cancellation or
stale completion. Commit checks transaction identity, configuration and current root
health atomically. Entering Setup retires any admitted binding before another command.
Unmount, revision/resource configuration replacement and superseding commands fence
pending work; late acquisitions are closed rather than published.

Fresh Bundle transport consumes the command signal directly and always requests
current admission without using a query cache. Retiring the command
aborts its HTTP request. Recording preflight consumes that same command signal: abort
settles the probe, clears its timeout, detaches recorder handlers and best-effort stops
an active recorder. Validation then releases all temporary cloned tracks immediately;
the resource binding alone releases retained originals. Late probe callbacks cannot
publish into a subsequent transaction.

Practice uses only PreparedPractice, browser URL identity and resource configuration.
It verifies route score/revision against the admitted binding and makes no Bundle or
Score-detail request. Direct entry/reload without the memory-only admission shows
Setup required without acquisition, inference or controller construction.

Practice Start checks matching admission, healthy retained roots, valid candidate
scope/tempo and the engine's actual acquisition lifecycle. Capability validation belongs
to Setup. Candidate musical/presentation edits do not replace the physical binding.

## Explicit Transient Review Handoff

The execution actor retains `{ result, recording }` for its current natural Continuous
completion. Try Again creates no ReviewSession. Only View Review calls the workspace's
`handoffToReview(completion)` command. The command checks bundleId and artifact identity,
validates the typed completion against the exact admitted artifact reference and
stable binding identities, validates recording and non-empty notation, and builds
`{ result, recording, musicXml }`. Artifact is read from result.executed.bundle.artifact.
The Review route derives one memoized RecordedPerformance from result.executed and
the Review-owned READY recording, borrowing its media reference for Save, replay and
VideoExport. The handoff releases PreparedPractice's binding
before navigation and retains the handoff in workspace memory.

Review consumes that complete TransientReviewSession, not a Bundle query. Scope
projection and Verovio render errors remain presentation failures; a second server
Bundle or revision cannot replace admitted notation. Replay, annotations and current
local composite/export use the owned representation even after Score/Revision deletion.

Explicit Review exit clears the handoff. Route entry into Setup or Practice also
invalidates it, including browser Back; unchanged-route renders between handoff and
Review navigation preserve it. Provider disposal releases browser references. A direct
Review visit/reload has no handoff and is expired, with no recovery read or persistence.
Review Retry opens pinned Setup for a fresh admission and physical binding.

## Resource Planning and Lifetimes

```text
PracticeIntent (mode + inputSource + recordingMode)
  -> planPracticeResources
  -> immutable PracticeResourcePlan
       -> PracticePlan.resources
       -> qualification -> Setup validation on retained roots
       -> liveRoots -> PracticeResourceBinding / retained physical roots
       -> input -> STEP / Continuous input binding
       -> analysis -> acoustic execution
       -> recording -> recorder audio/video root binding
```

`planning/resource-plan.ts` owns the complete resource matrix. Its input is the
resource-choice projection of `PracticeIntent`; scope, tempo, metronome,
Bundle/artifact identity and live feedback have no effect on resource requirements.
STEP accepts recording OFF. Invalid mode/input/recording combinations fail admission.
All arrays and nested projections are frozen. Equivalent resource choices return the
same immutable plan and stable projection identities.

The plan contains qualification requirements, live root names, discriminated input
and analysis bindings, and a discriminated recording binding. It contains no
MediaStream, MIDIAccess, AudioContext, inference/recorder instance, callback or health
state. `PracticeDeviceRoots` maps the planned root names directly to acquired objects.

| Mode       | Input      | Recording | Qualification                                                    | Live roots                        | Analysis                  | Recording binding                   |
| ---------- | ---------- | --------- | ---------------------------------------------------------------- | --------------------------------- | ------------------------- | ----------------------------------- |
| STEP       | MICROPHONE | OFF       | acousticEngine, browserAudio, microphone                         | inputMicrophone                   | ACOUSTIC: inputMicrophone | OFF                                 |
| STEP       | MIDI       | OFF       | midi                                                             | midi                              | NONE                      | OFF                                 |
| Continuous | MICROPHONE | OFF       | acousticEngine, browserAudio, microphone                         | inputMicrophone                   | ACOUSTIC: inputMicrophone | OFF                                 |
| Continuous | MICROPHONE | AUDIO     | acousticEngine, audioRecording, browserAudio, microphone         | inputMicrophone                   | ACOUSTIC: inputMicrophone | AUDIO: inputMicrophone              |
| Continuous | MICROPHONE | VIDEO     | acousticEngine, browserAudio, camera, microphone, videoRecording | inputMicrophone, camera           | ACOUSTIC: inputMicrophone | VIDEO: inputMicrophone + camera     |
| Continuous | MIDI       | OFF       | midi                                                             | midi                              | NONE                      | OFF                                 |
| Continuous | MIDI       | AUDIO     | audioRecording, microphone, midi                                 | midi, recordingMicrophone         | NONE                      | AUDIO: recordingMicrophone          |
| Continuous | MIDI       | VIDEO     | camera, microphone, midi, videoRecording                         | midi, recordingMicrophone, camera | NONE                      | VIDEO: recordingMicrophone + camera |

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
lifecycle. `PracticeExecutionActor` serializes attempt release before any new controller
construction.

Artifact schemaVersion 1, mode-specific PracticeSession snapshots, transient Result,
count-in policy, timing/recognition/resource values and acoustic identities are their
current contracts. See the [product contract](practice-product-contract.md) and
[Practice Bundle](practice-bundle.md).

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

| Fact                                                          | Owner                 |
| ------------------------------------------------------------- | --------------------- |
| Borrowed microphone/camera mute or end                        | ResourceBinding       |
| Retained MIDIAccess connectedness                             | ResourceBinding       |
| MIDIInput message listener binding and NOTE_ON/OFF parsing    | BrowserMidiController |
| AudioContext state                                            | Execution pipeline    |
| Capture bridge validity / worker or model failure             | Acoustic pipeline     |
| Owned recording clone tracks / MediaRecorder state and errors | Recorder pipeline     |

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

Shared `practice/media/` owns browser-local bytes, OPFS, Web Locks and download
leases. Recording owns its RecordingSink port and OPFS adapter. The sink serializes
raw MediaRecorder writes, and READY media carries one `LocalMediaAsset`. Controller
retirement, Review handoff and asynchronous media consumers retain/release that owner
without changing borrowed physical roots or the performance timebase. Storage write
failure is a recording-only hard intervention, not acoustic failure or root loss.
Saved Take media streams into a separate temporary OPFS namespace and yields the
same handle contract. Review/replay, raw download, save and VideoExport hold explicit
leases; the last reference removes backing storage. RecordedPerformance pairs the executed semantics with one READY recording.
The studio retains its recording media for every export operation. Downloaded Take bytes are not buffered wholesale in JavaScript heap
and have no arbitrary frontend size ceiling.

## Metronome Plan, Runtime and Audio

`PracticePlan.metronomePlan` is the immutable musical projection owned by
session planning. It contains STEP/CONTINUOUS mode, meter segments, resolved tempo,
finite timeline end, scope start/end and initial enabled state. Meter timing is
nonempty, explicitly MUSICXML-sourced and starts at tick 0. Missing initial meter
fails admission; planning and runtime perform no meter repair. Runtime receives no
Artifact and performs no semantic scope/tempo resolution. A candidate initial-enable
change is resolved by the pure planner; it preserves scope and tempo semantics.

Mode controllers compose `MetronomeRuntime(plan.metronomePlan, audio)` with a
`MetronomeAudioPort` supplied by browser infrastructure. Musical plan fields are
immutable during the attempt. The runtime owns enabled/running state, pulse cursor
and one 25ms scheduling interval with a 100ms lookahead. Pause, stop and idempotent
disposal clear the interval; disposed callbacks cannot restart scheduling.

STEP commands the current target onset and has no count-in. Its meter grid follows
that target; repeated pulses keep the BPM at the target until the target changes.
Continuous commands `continuousMetronomeSyncPoint` from its canonical transport:
COUNT_IN carries the remaining countdown and a frozen timeline-time anchor; RUNNING
carries elapsed timeline milliseconds. The planner selects integer pulse ticks.
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

The artifact supplies admitted meter facts: `startTick`, `numerator`, `denominator`.
The pure score-time helper derives exact measure duration ticks using the artifact
timebase. `planning/count-in.ts` owns the execution policy: a full active
measure supplies Count-In duration, and its numerator supplies the number of pulses.
Thus 3/4 gives 3 beats/3 pulses, 6/8 gives 3 beats/6 pulses, and 2/2 gives 4 beats/2
pulses. Count-In pulses are not part of the score artifact or Bundle identity.

Metronome pulse-grid policy uses a step of `4 * ticksPerQuarter / denominator`, with downbeats and pulse
indices derived from the same admitted meter and measure-duration helper. Invalid
meter invariants fail closed. Continuous PerformanceClock owns the actual countdown;
MetronomeRuntime consumes its live sync point. STEP has no Count-In.

## Executed Bundle Provenance

PracticePlan.bundle contains the admitted revision binding and immutable artifact.
Local STEP and Continuous session snapshots reference the executed Plan. Natural
Continuous completion creates ExecutedPerformance from its completed Plan once. Review validates
its exact admitted binding, artifact reference and notation. Save submits
practice_binding with score_id, revision_id and bundle_id from ExecutedPerformance.
Revision-binding authorization and retention belong to [Practice Bundle](practice-bundle.md).

## Durable Save Planning

Browser planning owns live execution truth. A save submits the exact admitted revision binding,
FULL or RANGE moment selection, tempo selection and media/recording evidence.
`app/modules/practice/planning/score_plan.py` owns pure server planning from the
verified exact bound Bundle artifact. FULL spans the first moment onset to scoreEndTick;
RANGE spans its selected start onset to its selected end canonicalEndTick.

The server resolves a score-wide tempo plan: missing initial MusicXML tempo uses
PRODUCT_DEFAULT 80 quarter-note BPM; explicit segments remain MUSICXML. CUSTOM_FIXED_BPM accepts
finite positive BPM and retains the exact value in the CUSTOM segment. Runtime timing
validates numerical representability for the selected score and tempo. Scope does not trim tempo.

Both language implementations consume the same concrete expected
[planning cases](../../contracts/practice/score-planning-cases.json). Reservation and Take
responses expose the same immutable `manifest` with score timebase, resolved scope and tempo.
The score timebase is their shared written-coordinate owner.
Before media upload, the browser compares that canonical response with RecordedPerformance's
executed binding/scope/tempo and artifact's `ticksPerQuarter`. A mismatch fails closed and best-effort cancels a new
RESERVED upload. Completed replay and finalize responses also require agreement.

PerformanceTakeManifest owns the resolved save truth. Reservation and Take reference the same
Manifest row. Replay compares request intent/evidence against that value without new authorization
or planning; finalize retains its identity and facts, including after Bundle GC.

## Durable Media Provenance

Save Recording is a new server admission, independent of the browser's admitted flow.
The server authorizes the exact live revision binding and Bundle and resolves durable scope/tempo before
committing a Manifest and UploadReservation with its artifact-local score timebase. Deletion before
admission denies new saves; deletion afterward does not revoke the Manifest. Finalize creates
PerformanceTake with the same manifest_id, without Bundle reads or replanning.
Only ScoreRevisionPracticeBinding retains PracticeBundle. Take owns final raw media; Manifest
owns immutable provenance, not retrievable score content. Saved local score-based export requires a
currently authorized exact revision-binding read; raw media remains independently usable.

## Browser-local Video Export

VideoExport consumes RecordedPerformance for both current and saved performances.
Its executed value supplies canonical binding/artifact, resolved scope and tempo;
its recording supplies media and RecordingTimebase. Review and VideoExport use the
same recorded-performance media-time-to-score-tick mapping. CursorScope is derived
presentation, and MusicXML remains a separate notation representation.

The archive admission boundary validates a saved TakeManifest against the
reauthorized Bundle and materialized media once. Saved replay and VideoExport
share that RecordedPerformance. Raw saved media playback remains independent of
Bundle availability. Save transport projects its request from RecordedPerformance
and verifies server Manifest agreement; the server reauthorizes and resolves the
canonical save plan. Save remains an explicit user action.
Export creates no server asset and grants no sharing access.

Explicit tempo interpretation and the cross-runtime missing-tempo policy belong to
[Score tempo semantics](score-tempo.md).

## Exact score coordinates

Artifacts, scope endpoints, tempo-segment positions, metronome pulses and session
planning use `ScoreTick` on the artifact's `ticksPerQuarter` grid. Group IDs remain
the user selection identity. FULL ends at `scoreEndTick`; RANGE ends at the final
selected moment's `canonicalEndTick`.

`PracticeTempoTimeline.tickToTimeMs()` converts integer tick deltas to runtime
milliseconds using `tickDelta / ticksPerQuarter * 60000 / bpm`. Its inverse selects
the last integer tick reached. Continuous metronome resume uses elapsed timeline
milliseconds to retain wall-clock phase and chooses its next pulse on the integer
meter grid. Floating values at runtime/UI boundaries never define score identity.
