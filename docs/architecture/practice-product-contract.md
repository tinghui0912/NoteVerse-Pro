# Practice Product Contract

## Revision-Wide Score Admission

Practice-ready validity belongs to the entire pinned score revision. The only current
artifact is schema3 with integer PracticePianoKey21..108. FULL/Section and STEP/Continuous
consume that same valid artifact; source or scope never repairs an invalid revision.
Setup requests it through the shared Source parser only when Start Practice is pressed,
before Environment qualification. Invalid direct Practice entry disables DeviceLease/session
resources and shows an in-place score-unavailable state. Device readiness remains independent. See the
[canonical contract](practice-piano-key-contract.md) for owners, error codes and versions.

## Execution and Inputs

Practice execution is browser-local. The backend Practice Source service authorizes
one revision and builds an immutable source bundle containing schema3 artifact and
prepared notation representations. One `/source` request returns `source_id`, the
artifact, and optional prepared-MusicXML notation. The revision-source hook owns one
query and runtime artifact parsing. Setup requests `include_notation=false` and
receives no MusicXML. Practice and Review request `include_notation=true` for Verovio
presentation; notation is not an evaluation/domain input. [Practice Source](practice-source.md)
owns deterministic construction, snapshot persistence and retention.
The backend also provides immutable model assets. Once the required
assets are loaded, an active session executes independently of network availability.
Cold-start offline availability depends on asset and application caching.

Practice has two modes: `STEP_BY_STEP` and `CONTINUOUS_PLAY`. Both support MIDI and
browser-local microphone analysis when the required browser acoustic runtime is
available. Capability detection represents browser/runtime prerequisites, not a
guarantee of physical-device recognition quality. Physical microphone compatibility,
permission UX and end-to-end device latency require separate product qualification.

Microphone analysis requires standard AudioContext, AudioWorklet, getUserMedia,
Worker, WebGPU adapter access, OPFS and cryptographic digest support. MIDI capability
is independent of these acoustic prerequisites. Setup performs actual permission,
device, capture and model-runtime probes before session creation.

Recording and input source are orthogonal. User-selected audio or video recording
is a review artifact. Analysis capture supplies PCM directly to the acoustic runtime.
MediaRecorder output is not the analysis PCM source. Generic application realtime
notifications invalidate application data independently of Practice execution.

## Practice Configuration

`configuration/` owns serializable user intent. `PracticePreferenceProfile` schema 1
stores mode, input source, and Continuous recording intention (OFF/AUDIO/VIDEO),
each initially unselected. Live note feedback defaults to false. First use requires
explicit mode/input selection and, for Continuous, recording selection. STEP needs
no recording selection. Invalid JSON, unknown schemas, extra fields and illegal
enums are treated as unconfigured rather than repaired.

Only this profile is stored under `noteverse.practice.preferences.v1` in localStorage.
Score/revision/artifact identity is not a preference. `practiceRevisionId` remains
in the URL through Setup, Practice and Review Retry; Retry uses the completed result's
revision. Tempo, metronome and committed scope are workspace-memory options, initially
SCORE, OFF and FULL. Retry and same-page Try Again retain all these options.

Setup exclusively edits mode, input source and recording mode. Practice exposes execution
controls and presentation preferences, with no inline editors for readiness-affecting
configuration. Unavailable admission stays on Practice with explicit Setup navigation;
an active recording intervention keeps the current attempt while the user decides. STEP settings contains configuration navigation only. Continuous Live Feedback uses a labelled, keyboard-accessible Switch in Practice,
not Setup. The switch controls score feedback visibility independently of readiness,
session identity, inference, evaluation, Review and Share Video. The preference
persists with the profile and defaults to OFF.

## Environment, Device Lease and Attempt Lifetimes

```text
Practice Environment (shared Practice layout / workspace)
    verified model, warm Worker, WebGPU ONNX session, qualification
        ↓
Practice Device Lease (exact Practice page mount)
    input microphone root, recording microphone root, camera root, MIDIAccess
        ↓
Practice Attempt (one fresh play-through)
    identity/timebase, AudioContext, capture/worklet, inference lease,
    evaluator, recorder clones/timebase, completion
```

`device/` acquires the required browser roots quietly on Practice page entry,
observes mute/unmute/ended and MIDI statechange events without polling, and owns
all root-track disposal and physical-health interpretation. Its read-only
`PracticeRootHealthPort` supplies immutable normalized facts to execution owners.
Subscription delivers current facts synchronously; controllers recheck after registering
their cleanup. Active execution receives events directly, independently of page rendering. Required device health is represented by compact status
icons within the stable `PracticeStatus` surface, without extra healthy-state prose.

Fault ownership follows the same three lifetimes. Environment invalidates only its
own qualification/model/runtime truth (including AcousticEngine failure). Device and Attempt errors do not invalidate
Environment or automatically navigate to Setup; warm model/Worker/ONNX remain ready.
An Attempt owns its failure/retry and Device Lease owns root recovery.

Device issues identify a resource (`inputMicrophone`, `recordingMicrophone`, `camera`
or `midi`), phase (`OPEN` or `RUNTIME`) and stable condition. Permission denial maps
to PERMISSION_DENIED, missing hardware to NOT_FOUND, browser NotReadableError to
BUSY, mute to INTERRUPTED, ended/disconnected input to LOST, and other acquisition
failure to UNAVAILABLE. Browser exception text is not public product state.
Open is transactional: failure releases every root/listener acquired by that open.
The execution Device Lease binds roots once for the mounted Practice page. Hard
lost roots and failed binding are observed and surfaced, never reacquired there.
Repeated open calls cannot retry a failed transaction or replace a lost root.

Device Lease faults update the message inside the same `PracticeStatus` shell,
without replacing its geometry, background or border. Required resources come from
`PracticeResourcePlan.liveRoots`. Microphone icons keep the same glyph: healthy is green,
unavailable/interrupted is red, with localized accessible labels. Required camera and
MIDI resources use the same compact pattern. Popovers are informational only: resource,
health and issue facts, without commands or access to device/platform/session owners.

Explicit device/permission requalification belongs exclusively to Practice Setup:
The single Start Practice action first refetches and admits the pinned Source, then
checks the selected capability and invokes `PracticeEnvironment.requalify(requirements)`.
Every successful Score-admission command runs fresh browser/device requirement probes,
even when Environment evidence is READY. `workspace.ready` describes live runtime
admission; it does not authorize navigation or skip qualification.

A stable, quiet Practice setup navigation is always available. Both that navigation
and Settings → Setup only close the Settings sheet and push the exact pinned revision
URL. Navigation has no device/environment side effects: no acquisition, qualification,
invalidation, restart or synthetic failure reason. Active attempts end through normal
page unmount/disposal. Every Setup visit starts with unprepared transaction presentation.

Explicit requalification moves normally to CHECKING and then READY, or BLOCKED only
when that qualification transaction actually fails. Entering Setup is not a failure.
A healthy READY_IDLE acoustic engine/model/worker stays warm: fresh external probes do
not recreate the engine, request model access, download or load the model again. A
FAILED/DISPOSED engine is constructed and prepared inside the explicit
requalification transaction.

Fresh Setup qualification may overlap asynchronous retirement of the previous Practice
attempt's acoustic inference lease. The previous attempt owns that retirement through
its unmount/controller cleanup. After fresh external probes, Environment observes its
warm engine and waits by state subscription while it is LEASED or RETIRING; it never
forces the lease to retire. This normal ownership handoff keeps readiness CHECKING,
not BLOCKED, without a polling timer or timeout. Once READY_IDLE, the same engine,
worker and loaded model are reused. A genuinely FAILED/DISPOSED engine is replaced
inside the explicit qualification transaction. CHECKING owns any resulting qualification
failure; ambient engine failure invalidates only live READY evidence. Only an actually
unsuccessful qualification ends in BLOCKED. Environment disposal aborts the wait and
detaches its subscription, preventing a later READY publication.

Permission-denied browser policy may make `getUserMedia()` reject immediately; the app
cannot force a browser permission prompt. The learner allows access in browser site
settings, returns to Practice Setup, and explicitly prepares again. Execution status has
no Reconnect, Retry or fault-specific configuration action.

Natural same-resource recovery has its own ownership. Microphone mute/unmute observes
the same root; input controllers own recovery on that root. MIDIAccess statechange may
observe a connected input again without requesting new access. Neither requires Setup.
A hard access/permission reacquisition does. Settings navigation remains deliberate;
ordinary device faults do not invalidate Environment or navigate automatically.

| Configuration | Device Lease roots |
| --- | --- |
| STEP / microphone | Input microphone |
| STEP / MIDI | MIDIAccess |
| Continuous / microphone / OFF or AUDIO | Input microphone |
| Continuous / microphone / VIDEO | Input microphone, camera video |
| Continuous / MIDI / OFF | MIDIAccess |
| Continuous / MIDI / AUDIO | MIDIAccess, recording microphone |
| Continuous / MIDI / VIDEO | MIDIAccess, recording microphone, camera video |

Setup probes are temporary and released; they are not handed into Practice.
Same-page Start, End, natural completion and Try Again
retain the same Device Lease. Attempts borrow roots, bind fresh MIDI listeners,
and never acquire or stop roots. Recorder audio always clones the selected audio
root; video combines that clone with a camera-root clone. Preview only displays
the Device Lease camera stream. Normal healthy completion Try Again creates a fresh
attempt on these roots, without device recovery. If devices or Environment are no longer
ready, Try Again stays on Practice without starting an attempt. The learner can choose
the pinned Setup navigation to prepare. There is no in-place root
replacement or multi-segment recording.

Leaving the exact Practice page for Setup, Review, Score or another route immediately
stops its root microphone/camera tracks and detaches MIDI/device listeners. Same-page
End retains these devices and their browser privacy indicators. Review Retry opens
a new Device Lease. Leaving the entire Practice layout also closes the Environment.

Each Attempt has a fresh localSessionId, PracticeTimebase/source domain, AudioContext,
capture chronology, inference token, evaluator/ledger, recorder and recording timebase.
Attempt cleanup releases its capture, context, inference lease, recorder clones and
listeners. Start and Retry use the existing Environment and DeviceLease without
readiness probes, model downloads, ONNX creation or root reacquisition. Retry releases
the completed attempt and starts a fresh attempt directly.

Both modes present Start when READY and admitted. READY has no execution controller
or attempt-owned resources. Start shows compact preparation state; Continuous then
owns count-in/transport while STEP immediately accepts learning input and waits for
the learner without count-in or a performance clock. Ordinary End returns READY and
presents Start again. Natural completion opens its completion dialog once; Try Again
is an explicit Retry command.

Scope, Section and tempo are editable before Start and locked during PREPARING,
ACTIVE, PAUSED and FINALIZING. Candidate edits create no controller. The executed plan
is captured at Start and remains stable through later candidate rerenders. Metronome
is a live command on the existing session. Settings links to Setup for mode/input/
recording changes; Continuous feedback remains presentation-only.

A recording indicator is shown only after an AUDIO/VIDEO recorder actually starts:
a red dot and recording elapsed time. STEP and Continuous OFF show no timer. Pause,
Resume Count-In and interventions freeze recording duration; explicit continuation
without recording removes the indicator.

Bounded engineering-only diagnostics distinguish deviceLeaseOpen from per-attempt
waitPreviousRelease, acquireInferenceLease, audioContextResume, firLoad, captureConnect,
acousticPreroll, midiBind and recorderAdmission. They never enter Result, metrics,
PerformanceTake or backend data and have no learner-facing debug UI.

Physical root health is distinct from processing pipeline health. DeviceLease alone
interprets borrowed microphone/camera tracks and MIDIAccess connectedness. STEP and
Continuous consume normalized facts for their planned roots. MIDI adapters bind
messages through `refreshInputs()`; AudioContext, capture, inference, owned recording
clones and MediaRecorder retain their pipeline-specific health owners. Recoverable
incidents preserve session/target/performance identity and require their existing
retirement or explicit continuation boundary. See [physical health contracts](practice-session-planning.md#physical-root-health-and-pipeline-health).

## Failure Ownership

External failures are normalized once by browser, media, worker and Source adapters
into closed typed causal facts. STEP and Continuous application policies project those
facts into their own stable error codes and interventions. Physical root health remains
DeviceLease-owned; context/capture/inference/recorder failures describe pipeline health.
Domain invariants fail closed under their domain owners. Presentation consumes stable
application codes; raw causes and text are diagnostic only. Cleanup failures remain
explicit and block execution replacement. See [failure boundaries](practice-failures.md).

## Practice Readiness

`planning/resource-plan.ts` derives qualification, live roots and input/analysis/recording
bindings from the execution configuration. `PracticeSessionPlan.resources` carries
that immutable plan into execution. The workspace uses its qualification projection
for candidate configuration. Live Environment readiness is UNCONFIGURED, CHECKING,
READY or BLOCKED, with component diagnostics and download progress. Its fingerprint
represents the effective requirement set. Environment evidence supports current runtime
admission and warm infrastructure ownership; it is never persisted or used as a navigation
credential. Setup presents only the preparation transaction initiated on its current visit.

| Configuration | Required checks |
| --- | --- |
| STEP / microphone | Audio capture, qualified source adapter/worklet, warm recognition |
| STEP / MIDI | MIDI access and at least one connected input |
| Continuous / microphone / OFF | Audio capture, qualified source adapter/worklet, warm recognition |
| Continuous / microphone / AUDIO | Microphone recognition plus audio recorder |
| Continuous / microphone / VIDEO | Microphone recognition, video-only camera and video recorder |
| Continuous / MIDI / OFF | MIDI access and at least one connected input |
| Continuous / MIDI / AUDIO | MIDI, recording microphone and audio recorder |
| Continuous / MIDI / VIDEO | MIDI, recording microphone, camera and video recorder |

MIDI recording never starts acoustic analysis. Microphone recording uses the session
microphone audio; camera acquisition is video-only. `qualification` defines disposable Setup checks; `liveRoots` defines retained
Practice-page physical roots. Both projections have one resource-planning owner and
different lifecycle owners. `PracticeDeviceLease` and the page status controls consume
the same live-root projection. Controllers bind acoustic analysis and recorder audio/video
from the planned root names. Recorder probes use the same
MIME strategy as the session recorder, construct and start/stop a real recorder,
and discard all probe data. Probe tracks, worklets and AudioContexts are released.
VIDEO/AUDIO/MIDI failures keep the selected intent and block Start; no fallback
changes the configuration. Technical reason codes are available behind details.

Score Detail's Practice command always enters `/practice/setup`, pinning the current
head revision when available. A direct Setup URL resolves and pins an absent revision
from score metadata. Mounting Setup and editing configuration perform no Practice Source
admission, Environment probes, DeviceLease acquisition or execution construction.
Setup has a Back to score navigation and one primary action: Start practice (开始练习).

Every Setup Start Practice command captures the pinned revision, complete configuration
and planned requirements. It requests a fresh artifact-only Practice Source through the
canonical parser first, then checks the current selected input capability and calls
`PracticeEnvironment.requalify()` for the captured qualification projection. Cached Source
success and READY Environment state never skip these checks. Healthy warm infrastructure
may be reused by its owner. Controls are locked during preparation; stale or unmounted
completion cannot navigate. Only successful current preparation replaces the route with
Practice at the exact admitted revision.

Invalid Score admission stays on Setup and blocks preparation for that revision before
qualification. A transient Source load failure stays retryable through the same CTA.
Capability or qualification failure stays on Setup. All navigation is user-directed except
successful preparation and revision pinning within the current route.

Practice loads and strictly parses its own Source response defensively. Missing configuration,
invalid or failed Source, access denial and unavailable Environment/device admission fail
closed in place, without automatic navigation to Setup. Its top Setup navigation preserves
the pinned revision. An unavailable Retry stays on Practice. Full reload restores preferences,
not readiness or GPU memory. Setup preparation enters the workspace; the separate Practice
Start command constructs an actual attempt through `PracticeExecutionOwner`. Live page
binding owns DeviceLease roots; Start borrows them and creates fresh attempt-owned resources.

## Practice Environment

The shared Practice layout keeps one stable `PracticeEnvironment` service across
Setup, Practice, Review and Retry. `environment/` owns infrastructure preparation,
readiness diagnostics and the score-blind `acoustic/model/acoustic-engine.ts`.
It owns no score, scope, evaluator, attempt, result or recording artifact.

```text
Setup Start Practice -> Source admission -> Qualification
                                               -> Warm environment (workspace lifetime)
                                               -> Session inference lease (fresh attempt Start)
```

Cold preparation verifies the OPFS/downloaded model identity, creates one Worker
and one ONNX WebGPU session, then executes a controlled finite smoke inference.
The smoke lease ends before READY and publishes no Practice evidence. Healthy
repeated Starts, End, natural completion, Review and Retry reuse that model/GPU
session. Engine states are EMPTY, PREPARING, READY_IDLE, LEASED, RETIRING, FAILED
and DISPOSED. Failures invalidate readiness and require explicit Setup preparation;
there is no provider or input fallback.

Worker protocol is LOAD, BEGIN_SESSION, INFER, END_SESSION, DISPOSE. Each lease
binds a fresh token and job sequence starting at zero. Old/no/wrong tokens and
out-of-order jobs fail closed. Only one lease may exist; retirement waits for old
inference to settle, suppresses its publication, ends that token, and only then
permits the next lease. Session disposal releases a lease, not the ONNX session.
Leaving the entire Practice layout disposes the environment, ONNX session and Worker.

## Practice Session

Every Start creates fresh identity, timebase, capture chronology, publication queue,
analysis runtime, evaluator and optional recorder. STEP and Continuous microphone
controllers acquire a prepared inference port before microphone capture; neither
loads models, requests signed access nor creates Workers. `SourceAnalysisRuntime`
knows only its session-local inference port. Session teardown releases capture,
analysis/recorder clones, AudioContexts, recorder and inference lease while retaining
the page Device Lease and healthy warm engine.
Natural completion and abandonment retain their distinct contracts below.

Persistent state consists only of user preferences and the verified OPFS
model asset. Readiness, warm engine, tempo/metronome/scope and current completion
are browser memory; capture, clocks, evaluation and recorder are session resources.
Practice Results/reports remain transient and are never persisted.

Live note feedback is a presentation preference, mutable during ACTIVE/PAUSED.
OFF removes live supported/unsupported decorations while retaining score, range
and playhead. Evaluation and natural Result production operate independently of
the feedback setting. ON/OFF does not restart a session or engine. Review always
shows completed feedback; Share Video always uses its clean-score contract.

## Session Planning

Canonical Practice Source supplies sourceId and the parsed artifact. The page creates
an immutable `PracticeExecutionIntent` from resolved configuration, committed scope,
tempo choice and metronome state. A composition-local `planPracticeSession` owns
sourceId/intent validation on the Source-admitted artifact and resolves scope and tempo into one immutable
`PracticeSessionPlan`. STEP and Continuous controllers consume that plan; pure runtimes
consume its narrow resolved projections. Live feedback is not execution intent.

The plan carries immutable `ResolvedMetronomePlan` musical timing and initial enabled state. Live enable/disable stays a runtime
command and preserves execution ownership, localSessionId and progression. Flag-only
candidate changes reuse the current resolved scope/tempo. Resources belong to the
readiness/device/application boundaries. The plan contains immutable resource
requirements/bindings; acquired objects and health state belong to those runtime owners.

Common local snapshots contain sourceId, resolved scope/tempo and current metronome
state. Natural Continuous completion creates Result7 from those executed resolved
values. See [session planning](practice-session-planning.md) for contracts and ownership.

## Domain Ownership

`src/lib/practice/kernel/` owns the pure, cross-mode artifact contract, canonical
scope, count-in, tempo, session timebase and common session identity/completion
metadata. It depends on neither mode, acoustic implementation nor browser resources.
Artifact validation and access stay in `artifact.ts`; scope and count-in policy have
their own modules. Renderer note IDs are projected by `score-view/cursor-scope.ts`.

Artifact schema3 has one canonical notation ownership graph and one canonical
Practice moment/physical-attack sequence. STEP and Continuous are projections, not
independent serialized target truths. A note owns its event reference, pianoKey,
render identity, measure/staff/voice and tie facts once. An event owns chronology.
Each moment owns groupId, onset/end, physical attacks and continuation references.
One onset/key attack retains every referenced unison notation identity across voices
and staves. Continuations retain notation but create neither STEP attacks nor
Continuous strikes. Rendering resolves the canonical notation records by reference.

Scope uses the canonical moment groupId. STEP projects attack/continuation key sets;
Continuous projects strike identity, performance time and render references from
those same attacks. Read-only UI views materialize render IDs from canonical notes;
they are not serialized target owners. Strict graph validation checks identities,
references, complete physical membership, chronology and endpoints without repair.
See [canonical moment artifact](practice-moment-artifact.md).

`step/domain/` owns piano-key evidence, exact target comparison, target progression and STEP snapshots.
`continuous/domain/` owns performance clock/timeline mapping, session composition
and Continuous snapshots. Its `evaluation/` separates immutable evidence,
source-blind assignment/finality and narrow target feedback. The evaluation
session composes these owners; live feedback contains settled target identities and
assignment states, while completed evaluation retains the full assignment. The two mode domains do not
depend on one another. Consumers import concrete owner modules directly.

The performance clock owns transport coordinates and accepts an established
`PracticeTimebase`, resolved scope and resolved tempo. `ContinuousPracticeSession`
owns session identity, input source, durable timestamps, runtime metadata, current
metronome state and session records.
Reading a session record does not drive a clock transition.

Continuous session accepts the domain-owned `ContinuousClockDrivenEvidencePort`.
MIDI options require its factory; microphone options exclude that factory.
`continuous/input/midi-evidence.ts`
implements MIDI observation identity, delivery-grace coverage and terminal coverage;
the application controller supplies it. Terminal evidence is published before the
evaluator completes. Acoustic publications enter through the separate validated
analysis-publication boundary.

Shared `midi/` infrastructure publishes physical NOTE_ON facts in session time;
it has no mode-domain dependency. The Continuous input adapter projects these facts
into `observeMidiAttack`; acoustic observations enter only through `publishAnalysis`.
Shared `metronome/` consumes resolved musical timing from `PracticeSessionPlan.metronomePlan`
and its own minimal live sync-point contract. `MetronomeRuntime` owns scheduling state;
`MetronomeAudioPort` separates browser audio side effects. The browser adapter borrows
microphone attempt AudioContext without closing it, or owns a MIDI metronome context
and closes it once. Optional audio faults stay nonfatal. Mode, meter and tempo are
immutable during an attempt; enable/disable is live. Continuous
application code projects clock snapshots into that contract. Neither shared
infrastructure imports STEP or Continuous domain code.

`PracticeExecutionOwner` is the composition lifecycle owner. The page supplies an
admitted candidate plan and narrow browser/admission ports through `usePracticeExecution`.
Explicit Start constructs exactly one selected STEP or Continuous controller. End,
Retry, release serialization and stale callback fencing belong to that owner.
Controllers retain mode-specific domain evaluation and processing pipelines.

Strict artifact parsing at the Practice Source projection is the score-level
correctness authority. Setup invokes it only from Start Practice, before qualification;
Practice invokes it defensively before plan/execution admission and stays in place on failure. Planners/controllers
consume admitted runtime values and do not perform full artifact validation.
The acoustic foundation remains score-blind. Static architecture checks enforce
these dependency and ownership boundaries.

## STEP_BY_STEP

STEP is paced learning, not a performance report. The shared schema3 artifact is
validated revision-wide before scope selection. StepPracticeRuntime owns progression;
StepPracticeController owns inputs, metronome, cancellation and resource cleanup.
There is no STEP Performance Clock or Pause/Resume lifecycle.

`StepPianoKeyEvidence` contains1..128 raw numeric attack keys, finite confidence and
same-session capture end. Admission checks ownership/state, capture time, confidence,
Array/nonempty/raw128, then own dense indices and the kernel piano-key predicate,
before Set+numeric-sort normalization, exact structural comparison and retention.
Raw129 rejects before indexed reads. Malformed evidence leaves ANALYZING/active
ownership retryable. Extra non-index properties are irrelevant; there is no complete
hostile-getter/proxy protection claim. Raw128 is not derived from the88-key domain.

Both sources compare all normalized observed attack keys with attack targets.
Equal cardinality and every equal member yields MATCH; subsets, supersets and other
sets yield MISMATCH. Continuation is excluded. Confidence is metadata, never a
verdict threshold. No target-aware source filtering or evidence loss is permitted.
The current snapshot is schema9/runtime `step-piano-key-learning-v12`.
Revision-wide artifact admission establishes the physical-key target contract;
STEP evidence admission uses the kernel piano-key predicate.

READY → CAPTURING → ANALYZING → POST_VERDICT owns exactly one attempt. Explicit rearm
commits MATCH once and completes at scope end; MISMATCH retains the answered target.
Skip remains a separate READY-only progression action. No attempt history, statistics
or learner report is fabricated. Completion offers Try Again and Section Practice.

MIDI owns a fixed first-NOTE_ON half-open H35 gesture, numeric wire identity and
score-blind21..108 Practice filtering. NOTE_OFF never adds evidence. Acoustic H50
assembly consumes validated immutable source observations and aggregates midiPitch,
sealing on processed physical coverage. Silence opens no attempt or synthetic verdict.
Native source/event time remains distinct from availability/knowledge time.

Eligibility is exclusive after the prior retirement boundary. Busy/stale input cannot
bind to a new target, regardless of callback order. Microphone rearm and input arm
share one physical boundary synchronously; no extra cooldown is added. Unfinished
capture is cancelled on input loss; POST_VERDICT truth is retained. Late worker/timer
callbacks cannot resurrect a retired owner. Analysis and infrastructure interventions
remain terminal and distinct; End releases resources through current ownership.
Natural completion wins over late failures and cleanup errors remain visible.
Borrowed microphone root tracks are not stopped by an attempt; owned clones,
capture, context and inference leases are released. STEP activation follows the
controller/page lifecycle.

See the [STEP owner README](../../apps/customer-web/src/lib/practice/step/README.md)
and [raw-work audit](practice-step-pitch-evidence-bounds.md).

## CONTINUOUS_PLAY

`ContinuousPracticeController` owns the Continuous application lifecycle. It creates
one `ContinuousPracticeSession` and composes input, metronome, optional recorder and
one completion transaction. React subscribes to snapshots and sends commands.

`PerformanceClockRuntime` derives performance time, musical beat and playhead from
the artifact, resolved scope, fixed tempo, Start and pause/resume transitions.
MIDI/acoustic evidence affects correctness and timing evaluation only. It cannot
move the playhead, seek, change BPM or alter scope.

Microphone Continuous uses one session-owned AudioContext for the injected
`LocalClock`, capture frame domain and metronome. Each live transition latches
`currentTime` once. Capture boundaries use
`round(contextTime * sampleRate) - workletOriginFrame`. Segment transforms add
local deltas to exact anchors. AudioContext continues running during Pause.

The capture bridge schedules stable BEGIN/PAUSE/TERMINAL boundaries. Pending count-in
and terminal boundaries are cancelled when Pause/Stop makes them stale. Applied
boundaries cannot be cancelled. Count-in and paused PCM supply context only and own
no performance evidence. Every Resume/Continue enters meter-aware Resume Count-In,
using countInContractAt at the paused musical beat. Clock snapshots distinguish INITIAL
and RESUME. Throughout Resume Count-In, performance time, musical beat, evaluation
frontier, playhead and recorder remain frozen at the pause coordinate. Count-in pulses
do not enter performance/recording time. The new acoustic BEGIN and resumed recording
segment start at countdown completion; countdown MIDI NOTE_ON is not evaluated.
Pause or a fault cancels countdown back to PAUSED; End abandons without a Result.
Resume begins a distinct source/performance segment.
Source ranges are half-open and source sample identity remains chronological.

The Device Lease owns the root microphone. Analysis and recorder use independent
attempt clones. Metronome borrows the attempt context. Controller cleanup releases
clones and closes the context while the page retains its root devices.

## Acoustic Foundation

`practice/acoustic/{model,source,runtime}` is score-blind. It consumes PCM and
source-domain analysis regions and publishes immutable physical observations.
Expected score enters only the product-domain evaluator. One capture stream uses
one model session; raw tensors remain inside the inference transaction.

Each `SourceAnalysisRuntime` publishes one immutable, ordered, exactly-once source-window
stream. Delivered job indices are contiguous from zero. Published region indices are
monotonic; each newly visible region starts at window zero. Region numbers may skip
when intervening analysis regions legitimately produced no publication, including
before the first published region. Inference is serialized and failure terminates
that stream. Publication, copied window, observation array and
observations are frozen. Owned source frontiers strictly advance across windows and
regions; source gaps are legal. Observations belong to their newly owned half-open
window, including the previous exclusive frontier as the next interval's lower bound.
The source-owned canonical identity binds domain, region, window, pitch and target
sample. Publication-local duplicates, replay, publication/job gaps, same-region window
gaps, mutated/forged identities
and old owned events fail closed. The shared source sequence validator retains only
the previous window summary and capture origin, never publication or event history.

The model is `practice-acoustic-robust-browser@v1`, delivered through
`/model-assets/practice-acoustic-robust-browser-v1/access`. The acoustic README
records its byte size, SHA256, decoder and resource bounds. Source adapters accept
44.1kHz and 48kHz. Window inputs require real context; missing PCM is not padded.
Input regions include overlapping context, while acoustic owned regions authorize
observation publication. Window width does not define assignment finalization.

Canonical hashing of the acoustic identity JSON proves that its declaration is stable;
it does not prove that declared path/bytes/SHA fingerprints still describe current
repository files. A Node-side recursive attestation test checks those source and FIR
assets separately: text uses UTF-8 with CRLF normalized to LF only, while binary
coefficients use exact raw bytes. Browser identity validation does not read or fetch
repository source. The core hash and source-adapter composite hashes bind the
selected implementation and asset attestations. Result schema7 retains the configured
acoustic identity values in its evidence provenance.

`practice/acoustic/continuous` projects source observations into performance time
and publishes `ContinuousEvidencePublication` through the session. Paused context
does not extend performance duration or evaluation coverage. At pause T coverage
remains below T. Natural completion drains real tail context and outstanding
analysis, then publishes empty exact-T coverage for the completed `[0,T)` domain.

## Continuous Evidence, Assignment and Target Feedback

### Timing coordinates and calibration

Session Time is the `PracticeTimebase` domain. Microphone Continuous establishes it
with `AudioContextPerformanceClock`; MIDI maps performance.now/native MIDI timestamps
through its timebase. Session Time includes initial count-in, pauses, resume count-in
and analysis delay. It is not an epoch timestamp.

Performance Time starts at zero at the resolved scope performance start and excludes
initial count-in, pauses and resume count-in. Expected strikes, observation event
positions, playhead, signed timing offsets and analyzed-through frontiers use it.
Source Time remains physical acoustic samples (`sourceEventSample`, source sample
rate/domain), independently of score or transport.

```text
MIDI native timestamp / acoustic source sample
                  ↓
       Session / source coordinate
                  ↓
       event → performance mapping
                  ↓
       observation.performanceTimeMs
                  ↓
          neutral assignment

Analysis / coverage / completion becomes known
                  ↓
       availabilitySessionTimeMs
```

Evidence position and evidence knowledge availability are orthogonal axes. Publication
`analyzedThroughPerformanceMs` and `availabilitySessionTimeMs` are each finite,
nonnegative and independently monotonic. No numeric inequality compares the two.
Completion similarly carries its performance terminal and session availability.
Finality is enabled by performance analysis coverage; `requiredAnalysisFrontierMs`
and `enablingAnalysisFrontierMs` remain performance coordinates, while
`finalizationSessionTimeMs` records when the enabling knowledge became available.
Retained finality must have required coverage no greater than enabling or unclamped
coverage. Completed retained enabling coverage cannot exceed the completion
Performance-Time terminal. Required coverage equals `Math.min(unclampedRequiredFrontierMs,
completion.performanceTimeMs)`, and `terminalClamp` is true if and only if the
unclamped requirement exceeds that completion Performance Time. Group finalization cannot precede
its child strikes in either Session Time or enabling performance frontier. Completion
session availability cannot precede any retained strike, group or unattributed
observation finalization. These causal checks compare coordinates only within their
own domain and reject corrupt artifacts without repair.
Completed assignment validation is current-schema only and checks exact retained
shapes, observation/provenance values and one-observation ownership. Matched evidence
must have the target key, exact timing offset and local assignment-window eligibility.
Every child strike shares its parent group's canonical onset. Each observation is
owned exactly once by an exact same-key strike match or an unattributed relation;
non-target evidence is never substituted into a target slot. This boundary never
reruns an optimizer or reassigns evidence. It validates caller data without repair,
coercion or mutation.
Live completion records availability when terminal coverage actually closes the
assignment, no earlier than either the completion request or accepted terminal evidence.

MIDI event position comes from the native MIDI timestamp, mapped through Session Time
to `performanceTimeMs`. Callback arrival does not change that event position.

Normal MIDI coverage for analysis frontier F matures at Performance Time F + 250ms
grace. `clock.sessionTimeAtReachedPerformance(deadline.duePerformanceTimeMs)` maps
that reached deadline through the established RUNNING segments to its canonical
Session Time, which becomes `availabilitySessionTimeMs`. This is the semantic
coverage deadline's knowledge availability, never a later heartbeat execution time,
refresh snapshot's `nowMs`, UI sampling time or `Date.now()`. The 250ms grace is a
coverage maturity policy, not a publication or polling cadence.

Performance Time freezes during PAUSED and RESUME count-in, so elapsed Session Time
alone cannot mature a coverage deadline. When RUNNING later reaches that deadline,
its mapped Session availability includes the preceding pause and resume-count-in
time.

After catching up reached deadlines, MIDI `SCOPE_COMPLETED` exact terminal coverage
uses the canonical natural terminal capture Session Time, not a late heartbeat's
sampling time. Generic `STOPPED_BY_USER` evaluation instead uses the actual stop
boundary's Session Time for terminal availability. Normal grace-deadline availability,
natural terminal availability and user-stop availability are distinct boundaries on
the same Session-Time knowledge-availability axis.

Source analysis uses `availabilityRuntimeMs` and injected
`nowAvailabilityRuntimeMs`; the score-blind runtime knows no product clock. The
`acoustic/continuous` projection declares this injected Continuous runtime clock to
be the established Session Time and publishes `availabilitySessionTimeMs`. Analysis
delay never shifts source events or their mapped performance positions.

`continuous/timing/timing-provenance.ts` records these mapping identities:
`MIDI_EVENT_TIMESTAMP_TO_PERFORMANCE_TIME_V1` and
`ACOUSTIC_SOURCE_EVENT_SAMPLE_TO_PERFORMANCE_TIME_V1`. Both declare
`CONTINUOUS_NO_INPUT_TIMING_CALIBRATION_V1` with `calibrationApplied: false`.
There is no offset, measured-zero claim, calibration profile/storage or learner UI.
Transport, target feedback, Review and score annotations do not apply timing
correction. Result evidence provenance retains the source-bound mapping/calibration
identity without turning it into a learner metric.

The independent numeric policies keep their semantic owners: STEP MIDI 35ms groups
one chord gesture; acoustic H50/50ms groups bounded evidence; Continuous ±250ms is
assignment eligibility; MIDI 250ms grace delays coverage publication. Equal numeric
values do not make these policies interchangeable or device-latency calibration.
Same-key cohort coverage has a derived 3W safety invariant: the direct cohort
extends at most 2W from its anchor, then requires W more coverage. W is the current
assignment window, not an independent frontier tuning parameter. Acoustic 170ms
future context remains model lookahead, never an event timestamp subtraction.
Model windows and decoder thresholds are defined by the acoustic model and decoder
contracts.

Non-zero input timing calibration requires empirical device/runtime qualification.
Browser API latency hints alone are insufficient; baseLatency/outputLatency and
matched-note timing medians do not establish physical input latency. Calibration
qualification must establish coherent source-specific event coordinates and safe
analyzed frontiers before source-blind assignment, including protection
against late evidence and premature finalization. The current timing contract
specifies calibrationApplied=false and applies no input timing offset.

A performance retains three distinct layers: immutable evidence truth,
source-blind assignment truth and source-bound evidence provenance.
MIDI publishes each physical NOTE_ON independently; its 250ms delivery grace is a
coverage-publication policy. Microphone observations describe decoder-qualified
acoustic evidence, not proof of physical key attacks.

MIDI coverage progression is explicit: session/clock snapshots and evaluation reads
never publish evidence or finalize assignment. The application heartbeat calls
`advanceToNow()` before sampling presentation; its frequency is not evidence policy.
The assignment finalizer exposes its next useful analysis frontier using the same
direct same-key target/claimant dependencies as live finalization. The score-blind MIDI
owner combines that need with pending NOTE_ON maturity. Frontier F becomes eligible
at Performance Time F + 250ms. Coincident needs produce one publication.

Progression catches up all reached deadlines in canonical order, publishing each
required frontier rather than the latest sampled performance position. Availability
uses the clock's established RUNNING segments to map the deadline to Session Time,
including initial count-in, pause and resume count-in gaps. Those gaps never mature
a Performance-Time deadline. Silence therefore advances finality without per-read
empty publications. Completion first catches up reached deadlines, then publishes
exact terminal coverage without waiting for another grace interval.

NOTE_ON eligibility uses native capture time and delivery Performance Time, before
allocating observation identity. Delivery strictly before capture + 250ms remains
eligible; at or after that maturity boundary it is late, whether or not a heartbeat
has already materialized coverage. This ordering makes delivery acceptance,
publication identity and finality availability independent of presentation cadence.

Publications carry immutable publication/observation identity, session domain,
source provenance, confidence, session availability and monotonic performance analyzed-through
coverage. Availability is not attack time. Exact replay is idempotent; mutated
identities and genuinely new evidence at or before declared coverage fail closed.
The evaluation session rejects observations whose source disagrees with its input:
MIDI sessions accept MIDI observations, and microphone sessions accept ACOUSTIC
observations.

### Source-blind assignment

Same-key assignment uses an inclusive +/-250ms eligibility window.
`CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5` defines three objectives:
maximize cardinality, minimize total absolute timing error, then choose the
lexicographically earliest chronological non-crossing pair sequence.

Targets sort by expected Performance Time, then canonical score order only
when time is identical, with strike identity as the final corruption-safe fallback.
Events sort by Performance Time, then observation identity only for identical times.
Different-onset target colors never depend on opaque target identity. At 1000/1300ms
with one event at 1150ms, the earlier unresolved target wins, regardless of IDs.
This FIFO convention is deterministic product policy, not learner-accuracy evidence.

The domain-specific same-key solver uses scalar suffix cardinality/cost tables
and chronological reconstruction, with O(targets * events) space/time per cohort.
No DP cell retains a growing pair list; costs use structured comparison, without
epsilon or artificial numeric weighting. Overlapping eligibility allows: targets
1000/1250ms with events 1100/1110ms both match, as do events 800/1100ms. Nearest
per-target greedy and midpoint clipping do not preserve these objectives.

W=250ms remains an unqualified algorithm-policy parameter. The common-radius
non-crossing proof works for any common radius. Solver correctness does not
establish learner timing tolerance or recognition accuracy.
Note duration / notation end is not an attack acceptance deadline. Learner/input
timing and physical-device behavior require separate qualification evidence.

Canonical chord strikes share one onset. Direct same-key cohorts are literal
interval neighbors within 2W, not recursively expanded graph components. A strike
waits for its direct cohort's latest expected onset plus W; the maximum additional
coverage is mathematically 3W. There are no independent group/residual timing
parameters. A group finalizes once all child strikes are finalized, with the maximum
of their required frontiers. Unattributed evidence waits only for its possible
same-key target claimants; unrelated pitches never extend a group's decision.

Raw strikes are PENDING, MATCHED, UNMATCHED or NOT_REACHED. MATCHED retains the
same-key observation and signed timing offset. UNMATCHED means no same-key
observation was allocated with healthy completed coverage. Groups carry strike
assignments and finality, without target substitution slots.

Every accepted observation is retained and has exactly one completed relation:
STRIKE_MATCH names its exact-key target, or UNATTRIBUTED has no target owner.
For target C4+D4 and observed C4+E4, C4 is MATCHED, D4 is UNMATCHED, C4's observation
is STRIKE_MATCH and E4 is UNATTRIBUTED. No D4-to-E4 ownership is invented. Completed
validation is strict current-shape only, checks local key/window/offset semantics,
exact ledger/owner agreement and finality causality without rerunning assignment.
Natural completion has no pending targets or unresolved same-key reservations.

### Continuous evaluation scale

Continuous retains all accepted evidence required by the completed result, including
provenance and extra/unattributed observations. Internal time/key indexes, explicit
unowned working sets and local ordered same-key matching restrict ordinary assignment
work to semantically relevant local data without discarding accepted evidence.
Receipts retain exact scalar/header identity and canonical observation IDs; replay
compares the retained observations exactly, without retaining duplicate full payload
strings or using collision-prone hashes. Permuted identical replay is idempotent;
mutated replay remains invalid. Frontier readiness selects work, then canonical
score chronology controls assignment, with identity only as an identical-time
fallback. Cohort matching preserves maximum cardinality, minimum total error and
canonical chronological non-crossing ties.

Incoming evidence, receipts and assignment changes are prepared together before
retaining or committing any publication, observation, frontier, ownership or
completion mutation. Correctness failures discard the plan and remain errors;
there is no capacity-specific degradation latch or input/start failure mapping.

Continuous evaluation retains all accepted evidence without an independent count,
length, memory-heuristic or environment-configured capacity ceiling. Workload/device
headroom for this retention requires measurement. Acoustic admission budgets belong
to their resource-policy owners and require separate qualification. Resource handling
must fail closed rather than silently truncate accepted evaluation truth.

The research-only `npm run benchmark:practice-evaluation-scale` runs the real
finalizer at 100/500/1,000/5,000 strikes with incremental publications, repeated
pitches, chords, exact matches and non-target/unattributed evidence. These workloads are
engineering characterization, not product capacity limits. JSON reports default
to ignored `artifacts/practice-evaluation-scale/`; `-- --output "<path>"` selects a
local output. Wall-clock is local engineering evidence, not a qualification
threshold, CI timing assertion or learner metric. Pathological dense graphs can
still require many legal edges; this does not justify inventing a ceiling here.

The benchmark characterizes Continuous assignment work. STEP multi-hour retention
and Continuous recording chunk growth require separate workload measurements.

### Canonical target truth

Continuous has one source-blind target state vocabulary: PENDING, MATCHED,
UNMATCHED and NOT_REACHED. There is no persisted interpretation tree or group
performance verdict. Groups organize score targets and assignment/finality; they do
not classify learner outcomes.

MATCHED means the current assignment policy found a unique accepted observation
with the exact target key inside its legal time window. UNMATCHED means healthy
completed assignment coverage found no matching accepted observation. Neither is
an absolute claim about the physical world.

For MIDI, accepted observations are physical NOTE_ON evidence. For microphone,
accepted observations are decoder-qualified acoustic evidence: UNMATCHED means
healthy completed acoustic analysis did not detect matching target evidence. It
does not prove the learner physically failed to play the note. No second acoustic
confidence threshold or source-specific learner state tree is applied. Source
capabilities remain explicit in inputSource and evidence provenance.

For a C4+D4 target, both sources produce the same assignment states and colors:

| Accepted evidence | C4 target | D4 target | Target colors |
| --- | --- | --- | --- |
| silence | UNMATCHED | UNMATCHED | red / red |
| C4 + E4 | MATCHED | UNMATCHED | green / red |
| C4 only | MATCHED | UNMATCHED | green / red |
| C4 + D4 | MATCHED | MATCHED | green / green |

E4 in the second row remains UNATTRIBUTED; the third row contains no E4 fact.
PENDING and NOT_REACHED carry no correctness colors. UNAVAILABLE means trustworthy
analysis could not complete and never fabricates negative target colors. User abandonment still
produces no learner Result. UNAVAILABLE also covers an admitted Continuous microphone
attempt whose analysis became unavailable under the explicit Analysis Failure
Intervention contract below.

### Live feedback and Review

Continuous Review is replay-first, not a statistics dashboard. No learner-facing
aggregate performance metrics artifact exists. Review keeps synchronized replay,
score/playhead, completed annotations, useful metadata and recording/save/share
and retry/back actions; it does not display outcome/extra counts, percentages,
grades or scores.

Live Practice and completed Review share one target-feedback contract and annotation
mapper. MATCHED maps to supported green; UNMATCHED maps to unsupported red. PENDING,
NOT_REACHED and unavailable analysis produce no fabricated correctness colors.
Score decorations are supported/unsupported only.

Target feedback contains exactly a flat targets list; each
entry contains strikeId, renderNoteIds and MATCHED or UNMATCHED. There is no groupId
or inputSource because color consumers need neither. Assignment policy identity is
retained by completed evaluation/Result, never by the presentation DTO. The finalizer's targetStates()
read projects only strikeId, renderNoteIds and source-blind strike state, without
copying evidence history. Completed Review projects its assignment into the same
narrow feedback at the domain boundary. Score-view consumes no broad assignment,
match observation, provenance, ownership, finality or unattributed payload. Full
snapshots remain available only for completion, validation and focused diagnostics.

Completed evaluation retains all accepted observations, exact matches, unattributed
facts, ownership, target states, coordinates and provenance. No evidence is dropped,
reconstructed or duplicated into a second interpretation tree, and there is no
second offline assignment pass.
Natural SCOPE_COMPLETED enters application FINALIZING until tail analysis and recording
finish. Completion projects the same ledger and drains unfinished work without a
second evaluation pass. End during count-in discards the session without a result.

Terminal analysis failure with healthy infrastructure stops analysis resources and
pauses canonical performance, metronome and active recording for explicit learner
choice. Only accepted Continue without analysis resumes an intervention-owned pause;
pre-existing user pause stays paused. Preparation failure never starts transport. Temporary required-input interruption pauses Continuous through its
canonical resource intervention; hard required-input loss offers End only. Listeners are
detached before intentional cleanup. Cleanup failures remain explicit application errors; each
owned release is attempted once. Product errors are localized; bounded diagnostics
retain causal metadata separately from observations and user recordings.

## Continuous Result Artifact

`result/continuous-performance-result.ts` owns `ContinuousPerformanceResult`, schema
7: local session and score/revision/artifact identities, resolved scope, tempo plan,
input source, active performance duration, completed evaluation, evidence
provenance and ISO UTC completion time. The result is pure, deeply immutable and
JSON-serializable. It contains no recording or browser-media resource. STEP creates
no result artifact, metrics or performance report.

The completion transaction creates the result from the canonical artifact and
resolved scope. COMPLETE evaluation has exactly status, inputSource, assignmentPolicyId and
assignment. UNAVAILABLE has exactly status, inputSource, assignmentPolicyId and
reason, without inventing empty analysis.
Validation rejects mismatched session/source identities, corrupt assignment and
unsupported provenance. It validates exact artifact fields without repair or coercion.
JSON round-trip preserves these semantic checks.
Both Result creation and parsed Result validation require SCOPE_COMPLETED for a
COMPLETE evaluation. Generic assignment/evaluation may still retain STOPPED_BY_USER
for internal diagnostics; that does not make it eligible for a learner Result.

Result validation accepts the exact schema7 fields and configured provenance.
Unknown fields and unsupported schema/policy identities fail closed.
A score revision mismatch does not alter retained evaluation, input, scope, tempo
or active duration. Score annotations, playhead and share-score rendering require
confirmed artifact identity independently of recording replay.

## Evaluation / Evidence Provenance

Completed evaluation and diagnostic full snapshots retain assignmentPolicyId.
`CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5` covers same-key
+/-250ms eligibility, maximum cardinality then minimum absolute timing error,
chronological non-crossing ties, exact match/unattributed ownership, direct-cohort target frontiers,
child-dependent group finality and terminal clamps. Finalization availability uses
Session Time; expected/event/frontier positions use Performance Time. There is no
independent interpretation algorithm or interpretation policy identity. Validation
checks exact assignment truth and source consistency without repair or reassignment.

`MIDI_PIANO_KEY_SESSION_TIME_WITH_250MS_COVERAGE_GRACE_V3` records physical NOTE_ON
capture in Session Time, one observation per NOTE_ON, a 250ms coverage-publication
grace, Session-Time availability and exact terminal coverage. The MIDI evidence owner
supplies this identity.

Microphone results retain the public canonical acoustic analysis descriptor:
acoustic identity name/core SHA-256, model SHA-256 and authoritative decoder-source
SHA-256. They also retain the actual session AudioContext source sample rate and
that rate's source-adapter SHA-256. The 44.1kHz and 48kHz adapters have distinct
identities. This session-level provenance is present even for silence and unavailable
analysis; it is not inferred from observations or duplicated onto every observation.
Confidence remains evidence metadata without another uncalibrated threshold.

## Recording Artifact

`recording/` owns media, recorder resource lifecycle, replay descriptors and
media-to-performance synchronization. `PerformanceRecording` is a discriminated
NOT_RECORDED / UNAVAILABLE / READY artifact. Only READY carries AUDIO/VIDEO kind,
Blob, MIME, media duration and an immutable recording timebase. Selecting AUDIO or
VIDEO requires successful recording admission before transport/count-in begins.
`PerformanceRecorder.prepare()` resolves only for admitted recording or OFF; missing
or dead required tracks, permission/device loss, unsupported recorder/MIME and
initialization failure reject with stable recording preparation codes. Admission
is rechecked immediately before transport starts. Failure releases this Start's
owned resources and inference lease, preserves recording intent and remains an
Attempt admission failure, without invalidating Environment. It creates no Result, dialog or recording
artifact, and does not classify recording faults as acoustic-analysis faults.
Setup success does not promise immutable permissions; Device Lease binding acquires
roots and recorder admission checks its fresh attempt clones. Start never acquires
browser devices or repeats cold model preparation.

Post-start recording faults are actively published once per unresolved incident by
`PerformanceRecorder`, independently of input and acoustic-analysis errors. The
Continuous controller pauses its canonical transport, metronome and evidence
chronology and exposes a dedicated recording intervention. Performance time and
finality cannot advance beyond that pause boundary while the user decides.

A temporary muted recording track is recoverable only while every required track
remains live, becomes unmuted, and the same MediaRecorder remains usable. DeviceLease physical-source facts and owned-clone/MediaRecorder events update
recorder continuity passively. There is no manual
Check Device action. Recovery only exposes Continue; it never resumes automatically.
Ended tracks, recorder errors, pause/resume/start failures and unusable pipelines
allow explicit continuation without recording only when performance is safe; otherwise End is required. No new recorder or stream
is spliced into the current artifact.

Resource impact is explicit: RECORDING_ONLY, INPUT_REQUIRED or INPUT_AND_RECORDING.
A recorder-owned clone fault with healthy input, or recording loss with healthy MIDI,
can offer Continue without recording while interruption is unresolved. Recovered
recording offers only Resume or End, preserving the now-recoverable intent. Root microphone mute and temporary AudioContext
interruption pause canonical transport and wait for the same input/capture pipeline to
recover. Continuous capture retains its graph across temporary
context suspension; closure or invalid chronology still invalidates it. STEP temporary
root mute cancels unfinished input, preserves target/progress and automatically returns
to waiting on same-root recovery. Its recovery commits a fresh physical capture
watermark before rearming, excluding delayed or partial evidence. STEP terminal
root/context/capture failure instead retains the active session and target behind its
End-only infrastructure intervention. Unusable resources are released immediately;
only End or page teardown ends domain/application truth. The controller never stops
or reacquires the borrowed root. End retires the STEP attempt and returns READY; the
next Start uses current Source, Environment, DeviceLease and selected-capability
admission. Past intervention state is not a readiness authority. Returning to Setup
has no environment side effects; explicit Start Practice performs fresh Source admission and qualification.
Terminal analysis failure has its separate End-only intervention. Context/capture/analysis
failure remains owned by the Attempt or engine, without generic Environment invalidation.
Continuous required-input root ended, context closure and invalid capture offer End only. Required
input loss never offers recording-only degradation. Shared-source callbacks converge
on one intervention, with input-required impact taking priority and one canonical pause.
MIDI disconnection follows its pause/reconnect contract and cannot accept
recording-only degradation while input is unavailable.

Continuous microphone terminal **analysis** failure after admission has an independent
`ContinuousAnalysisIntervention`; it is not a resource/input/recording fault. Worker
crash, terminal analysis runtime failure and analysis backpressure immediately remove
live target feedback, pause canonical performance/count-in, metronome and active
recording once, and release acoustic capture/runtime/inference. The failed acoustic
pipeline is never asked to acknowledge a PAUSE boundary. Already user-paused attempts
remain paused without duplicate media/metronome actions. Preparation/model/device
admission failures remain start failures; physical source loss, invalid capture
infrastructure, AudioContext interruption and recording faults retain resource ownership.
Analysis failure is neither a timing mismatch nor a learner mistake.

The blocking Continuous analysis dialog exposes only explicit **Continue without
analysis** and **End**. Continue waits for analysis release, permanently disables
analysis for the attempt, leaves live target feedback null and preserves the same
session, performance clock and healthy recording. It resumes through normal Resume
Count-In only when the intervention caused the pause; an existing user pause needs
an explicit later Resume. Accepted degradation is a quiet valid performance, not an
input/start ERROR. No worker retry or publication can revive analysis. Completed
natural evaluation has the exact UNAVAILABLE shape with reason
`CONTINUOUS_ANALYSIS_UNAVAILABLE`, never partial COMPLETE truth. Result schema7
binds the configured assignment and evidence provenance. Healthy media finalizes normally;
Review retains replay/save/share and its unavailable notice without target colors.

Acoustic analysis release neither closes the controller AudioContext nor stops the
borrowed root stream, metronome or recorder. Analysis-source health consumption is
irreversibly released with analysis; DeviceLease continues observing retained physical
roots. AudioContext health observation stays active
because that context still owns canonical performance time. Recording track health
continues to belong to the recorder. No failure dialog offers Restart or an alias.
Normal healthy completion Try Again and same-resource automatic recovery keep their
distinct ownership. Explicit requalification belongs to Setup alone. End discards
without a Result or completion callback. Final cleanup still releases remaining
attempt resources exactly once.

Analysis and resource incidents are retained separately. The analysis dialog has
presentation priority; after its explicit Continue, any unresolved resource incident
keeps performance paused and becomes the visible resource dialog. Clearing either
incident cannot bypass the other or cause a second canonical pause. A terminal
analysis failure during an already natural FINALIZING tail creates no intervention:
finish healthy recording and natural completion with unavailable evaluation.

Continue without recording accepts loss for this attempt, preserves the original fault
reason and persistent recording preference, then resumes only an intervention-owned
pause. A pre-existing user pause stays paused. Explicit Continue after passive recovery
enters Resume Count-In with the original healthy pipeline and frozen paused performance
time. Required-input WAITING/hard faults offer only End; same-pipeline recovered faults
offer Resume/End; recording-only unresolved faults offer Continue without recording/End.
Failure cleanup is not session end: the live owner and position remain behind the
blocking dialog until explicit End or existing page-unmount disposal. Navigation
needs no extra beforeunload state machine, never creates a Result, and fences stale
callbacks. End abandons without any result. A latched natural completion wins late callbacks.

UNAVAILABLE represents explicitly accepted runtime recording loss, or media that could
not finish reliably after natural completion was already latched. Finalization failure
cannot reopen transport or create a late intervention. A known preparation failure
cannot be represented as an UNAVAILABLE completion artifact. Media duration is distinct
from the result's active performance duration; recording is not a JSON result contract.

The recorder can build segments mutably, but finalized timebase/segments are copied
and frozen. READY validation requires finite nonnegative coordinates, ordered
non-overlapping performance segments, a media timeline starting at zero with no
unexplained gaps, and nominal duration matching the final media end. The
container rounding tolerance is one millisecond; zero-duration boundaries are valid.
Replay preserves pause/resume mapping, actual decoded-duration scaling, gap-to-null
behavior and bounds clamping.

Recording OFF acquires no media. Microphone+AUDIO borrows a clone of the session
stream; MIDI+AUDIO owns a separate microphone acquisition. VIDEO uses camera video
and the appropriate audio clone. Each owner releases only its own resources.

Saved Performance Take archives AUDIO/VIDEO media with source snapshot identity,
scope, tempo and recording timebase. It does not persist Practice assignment,
derived target summaries, metrics or implementation provenance. Review Save Recording is an
explicit user action that reads only a READY recording and archive metadata.
Completion, Review mount and Review exit never create a PerformanceTake.

## Transient Completion Handoff

`continuous/completion.ts` composes `{ result, recording }` without flattening either
artifact. The controller terminates transport, freezes recording, drains acoustic
tail work, finalizes evaluation/media, creates the result and completes resource
cleanup before publishing the atomic completion and notifying completion listeners.
The store validates both artifacts and publishes neither half independently.

Analysis-unavailable can coexist with READY recording; complete evaluation
can coexist with UNAVAILABLE recording. Neither failure invents or discards the other
artifact's truth. The handoff is transient application state, not durable persistence.

The cross-mode Practice composition owner invalidates an existing completion on the
explicit creation of a new session owner, including a STEP session. Ordinary renders
and Review subscription do not clear it. STEP itself imports neither result/recording
contexts nor the Continuous completion store.

## Natural Completion and Abandonment

SCOPE_COMPLETED is the only product completion. STEP reaches it through MATCH or
Skip progression to the full-piece or selected-section terminal. Continuous reaches
it through its transport. Only this terminal state calls onNaturalCompletion and
opens the completion dialog. STEP offers Try Again and section adjustment, without
report navigation. Continuous additionally offers View Report.

STOPPED_BY_USER is abandonment. End calls abandon(), cancels pending work and
releases attempt input bindings, metronome, inference lease, capture/recording clones
and AudioContext ownership. Page Device Lease roots and the warm Environment remain. It discards
unfinished session state and recording chunks without draining the acoustic tail,
finalizing a recording or creating result/completion handoff. No dialog or
report appears. The presentation returns to its pre-start ready state; preferences
may remain, but the next explicit Start creates fresh session/resource ownership.
This applies during count-in, running and pause. A formally latched SCOPE_COMPLETED
wins a later End; End before that latch wins over subsequent timer/publication work.

## Ephemeral Practice Report

Continuous Practice Reports are browser-local products of the most recent natural
completion. The in-memory completion store and current Review page retain the result;
new session start invalidates the handoff. No localStorage, sessionStorage, IndexedDB,
backend result API, database or serialized URL persists it. Reload or reopen without
that handoff shows the temporary-review-expired state. Saved PerformanceTake media
never reconstructs a Practice Report.

Save Recording persists media only through an explicit user action. It does not
persist evaluation, metrics or provenance, and does not extend the report lifetime.
My Performances is a saved media archive with playback/download/share actions,
without learner report statistics or saved learner-report navigation.

## PerformanceTake Upload Reservation

```text
completed local recording -> immutable upload reservation -> direct binary upload
                         -> finalize(reservationId) -> durable PerformanceTake
```

`POST /performance-takes/upload-reservations` captures client_request_id, source,
media, scope, tempo plan and recording timebase once. Source contains score/revision/
artifact identity; media contains kind, canonical MIME, byte size and duration. The
reservation pins the exact Practice Source snapshot and score title. Client-request
idempotency belongs to this boundary: equal normalized metadata returns the same
reservation/take identities; different metadata conflicts. RESERVED replay can refresh
the signed upload target. FINALIZING replay provides state, and COMPLETED replay returns
the saved Take. The nested upload target is an ephemeral URL/method/headers/expiry capability.

`POST /performance-takes/upload-reservations/{reservation_id}/finalize` has no body.
It consumes persisted reservation metadata and the pinned source. Live score deletion,
access changes or head-revision changes do not invalidate an admitted reservation.
`DELETE /performance-takes/upload-reservations/{reservation_id}` cancels a pending
reservation. Both routes use the user-scoped public upload UUID, independently of the
backend-internal `storage_reservation_id` quota handle. Object keys remain server-owned.

Reservation states are RESERVED, FINALIZING, COMPLETED, CANCELLED and EXPIRED.
A unique, non-null Take foreign key establishes one reservation to at most one Take.
The Take owns its durable media/metadata snapshot and source reference. Reservation
completion releases its temporary source retention. Playback/listing read the Take's
metadata directly. The reservation is the sole owner of client_request_id.

Finalization verifies staging existence, size, MIME/container and full SHA-256, copies
to a token-owned candidate, and verifies candidate size and SHA-256 equality. A finite
finalizing lease guards concurrent execution; expired takeover records the prior
candidate as an orphan. Unknown-outcome grace, reference-aware orphan deletion, late
staging cleanup and database-disconnect recovery preserve safe retries. Take creation,
reservation completion and quota commit are one transaction. Cancellation/expiry
release the internal quota hold. Finalize retry returns the same Take and commits no
additional quota. Final object ownership and immutable metadata do not depend on a
second client payload.

## Clean Share-Video Score

Review annotations remain ephemeral presentation of result.evaluation, with the
same supported/green and unsupported/red targets as live Practice. Share Video contains a clean musical score and its
own playback cursor, never report annotations. Snapshot preparation strips report
classes and existing active/playhead decorations from the cloned SVG only. Live
Review annotations remain intact. Current recordings and saved takes share this
clean-score contract; ShareVideoSession contains score/scope/tempo/media/timebase,
without evaluation or metrics.

## Score View, Review and Sharing Ownership

`score-view/` owns the Practice Verovio adapter, render identity, DOM render-ID
lookup, cursor geometry, viewport scrolling, range overlay and evaluation note
decorations. `dom.ts` resolves exact backend-prepared IDs without remapping;
`decorations.ts` owns class/data-attribute identity. Only evaluation-annotations.ts
consumes evaluation types, as a source-aware presentation projection. Score-view
primitives do not own lifecycle, assignment, metrics, recording or persistence.

PracticeScoreViewer composes these primitives and owns React effects, observer
subscriptions and animation-frame cancellation. Range geometry and DOM mutation
belong to range-overlay.ts. STEP and Continuous retain distinct playhead controllers
with their respective group and beat/scope input contracts. Rendering options,
cursor dimensions, staff mapping, colors and scroll thresholds are owned by the
score-view primitives.

`review/` consumes the current transient completion. review-score-state.ts gates
annotations, playhead and share-score rendering on exact score/revision/artifact
identity and a valid cursor scope. Missing/mismatched score content does not change
retained evaluation, tempo, input, duration or scope metadata. review-replay.ts
projects READY media and delegates synchronization to the recording timebase;
review-view-model.ts projects duration, tempo, scope and input-source metadata only.
The route owns queries, subscriptions, save-recording mutation, navigation, leave
confirmation and ShareVideoStudio state. Pure review modules do not access network
or storage. Save Recording remains an explicit media-only action.

`sharing/video/session.ts` defines a source-neutral score/scope/tempo/video/timebase
contract. current-completion-adapter.ts accepts only the necessary completion
metadata and media; saved-take-adapter.ts alone knows the backend PerformanceTake
entity and parses its archived scope/tempo/timebase. Both produce the same session
for preview, rendering and export, without a downstream source switch. Sharing
imports no result, evaluation, review or Practice capture owner. Its output recorder
belongs to the export pipeline. Floating-score styling is share-template policy.

Share score snapshots consume canonical decoration constants and remove report
classes and existing active/playhead nodes from the frozen clone only. Live Review
annotations remain untouched; export inserts only its own playback cursor. Sharing
retains 30fps, MIME preference, geometry, audio extraction, frame prefetch and abort
behavior. No presentation context is imported by kernel, STEP/Continuous domain,
acoustic, result or recording owners. Concrete module imports define these boundaries
without aggregate barrels or forwarding paths.

## Meter, Pitch and Tempo Admission

Practice requires an explicit valid initial MusicXML meter. The canonical meter
timeline is nonempty and its first segment starts at beat 0. Numerator and denominator
are positive integers; measure duration is positive and count-in pulses are nonnegative
integers. Later measures may omit time signatures and inherit the established meter;
explicit meter changes remain supported. Missing, malformed or unsupported unmetered
notation fails with INVALID_SCORE (`practice_score_invalid`). Source construction owns
that admission; transport parsers defend the same contract, and count-in/session/metronome
layers consume admitted timing without synthesizing meter.

Key signature is not Practice admission data: physical piano keys own pitch identity.
A valid metered score without a key signature is Practice-valid. Explicit tempo is
optional: SCORE selection uses PRODUCT_DEFAULT 80 BPM when no tempo is present, or
before the first explicit MUSICXML tempo. Continuous PerformanceClock owns count-in
derived from the active admitted meter; metronome mirrors its transport sync point.
STEP has no count-in and uses admitted meter for target pulse grid and accents.
