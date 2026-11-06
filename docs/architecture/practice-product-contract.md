# Practice Product Contract

## Revision-Wide Score Admission

Practice-ready validity belongs to the entire pinned score revision. The only current
artifact is schemaVersion 1 with integer PracticePianoKey21..108. FULL/Section and STEP/Continuous
consume that same valid artifact; Bundle or scope never repairs an invalid revision.
Setup requests it through the generated artifact structural decoder in Bundle admission only when Start Practice is pressed,
before resource acquisition. Invalid Practice Bundle disables attempt/session
resources and shows an in-place score-unavailable state. Physical health remains binding-owned. See the
[canonical contract](practice-piano-key-contract.md) for owners, error codes and versions.

## Execution and Inputs

Practice execution is browser-local. The backend Practice Bundle service authorizes
one revision and resolves one verified READY durable PracticeBundle containing schemaVersion 1 artifact and
prepared notation representations. One `/bundle` request returns the revision `binding`, the
artifact and prepared-MusicXML notation. Setup Start Practice admits this complete
representation once. PreparedPractice owns it for browser-local execution; Practice
and Review do not re-read Bundle or Score capability. Notation is a presentation input,
not an evaluation input. [Practice Bundle](practice-bundle.md) owns server construction,
verification and retention by its live ScoreRevision only.
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
session identity, inference, evaluation, Review and VideoExport. The preference
persists with the profile and defaults to OFF.

## Preparation, Resource Binding and Attempt Lifetimes

Setup is the unconditional entry from Score Detail. Only its explicit Start practice
(开始练习) command admits the fresh pinned Bundle, derives the resource plan, acquires
live physical roots, validates those same roots and atomically commits memory-only
PreparedPractice. Failure stays on Setup and releases the transaction's resources.
Selectors are locked while the command runs; stale completion cannot navigate.

Setup does not probe and release physical roots before Practice.
The explicit Setup command acquires the live roots that the admitted Practice execution will actually borrow.
Successful preparation does not create a persistent readiness flag.
It creates a retained resource binding plus exact Bundle admission.

Practice uses the admitted representation and verifies URL identity locally. Direct
entry or full reload has no retained
admission and shows Setup required, with no Bundle fallback or physical acquisition.
User navigation back to Setup retains the pinned revision and releases the binding.
Review also releases physical resources; its Retry opens Setup for a fresh command.
Candidate scope, tempo, metronome and live-feedback choices remain workspace-local.

`PracticeResourceBinding` owns one retained microphone/camera/MIDIAccess acquisition,
physical-health interpretation and exactly-once release. Practice and attempts borrow
its objects. Attempt End, natural completion and same-page Retry retain the same roots.
Entering Setup, Review, leaving the Practice flow or replacing resource configuration
releases them. No physical fault triggers automatic reacquisition.
Physical roots may fail after successful preparation; such a failure is an event on the same retained binding, not a second acquisition failure.

Physical HEALTHY/INTERRUPTED/LOST facts drive read-only status icons and mode-owned
interventions. Permission/acquisition errors remain typed facts, without raw browser
text. Popovers have no reconnect command. Same-root unmute/MIDI reconnect may recover;
hard replacement needs a new explicit Setup command. AudioContext, capture, worker,
inference and recorder errors are pipeline facts and never close retained roots or
convert healthy physical resources into LOST.

The workspace Environment owns acoustic model preparation, a warm Worker/ONNX engine
and inference leases. Acoustic validation borrows the retained input microphone with
a temporary processing pipeline. Recording validation uses clones of retained tracks,
releasing only those clones. Attempts create fresh contexts, capture pipelines,
recording clones, inference leases, metronomes and timebases. Cleanup releases those
attempt resources without stopping borrowed roots.

Both modes require explicit Practice Start. READY has no attempt controller. STEP has
no count-in; Continuous owns canonical count-in/transport. End before formal scope
completion returns READY; a formally latched natural completion wins later End. Natural
completion offers explicit Try Again on the same binding when current admission permits.
Metronome remains live; scope/range/tempo are locked during an active attempt. Recording
indicators appear only after actual recorder start and freeze with paused transport.

See [session planning](practice-session-planning.md#setup-preparation-and-retained-admission)
for transaction, handoff and resource lifetimes, and its
[resource matrix](practice-session-planning.md#resource-planning-and-lifetimes).

## Failure Ownership

External failures are normalized once by browser, media, worker and Bundle adapters
into closed typed causal facts. STEP and Continuous application policies project those
facts into their own stable error codes and interventions. Physical root health remains
ResourceBinding-owned; context/capture/inference/recorder failures describe pipeline health.
Domain invariants fail closed under their domain owners. Presentation consumes stable
application codes; raw causes and text are diagnostic only. Cleanup failures remain
explicit and block execution replacement. See [failure boundaries](practice-failures.md).

## Setup Admission

Setup mounts without Bundle admission or device acquisition. It has Back to score
navigation, configuration controls and one Start practice CTA. A fresh Bundle request
and strict parse precede resource acquisition and same-root preflight. Deterministic
invalid Score blocks that revision; load/capability/preflight failure stays retryable
through the same CTA. No failure automatically routes Practice to Setup.

`PreparedPractice` binds exact bound Bundle provenance to mode/input/recording and its live
binding. It is not persisted. Scope/tempo/metronome/live-feedback changes do not replace
that binding. Practice starts attempts only with matching admission, verified exact
Bundle, healthy roots, valid selection/plan and an available acoustic engine when needed.

## Practice Environment

The shared Practice layout keeps one stable `PracticeEnvironment` service across
Setup, Practice, Review and Retry. `environment/` owns infrastructure preparation,
model progress and the score-blind `acoustic/model/acoustic-engine.ts`.
It owns no score, scope, evaluator, attempt, result or recording artifact.

```text
Setup Start Practice -> Bundle admission -> Retained-root validation
                                               -> Warm environment (workspace lifetime)
                                               -> Session inference lease (fresh attempt Start)
```

Cold preparation verifies the OPFS/downloaded model identity, creates one Worker
and one ONNX WebGPU session, then executes a controlled finite smoke inference.
The smoke lease ends before preparation commit and publishes no Practice evidence. Healthy
repeated Starts, End, natural completion, Review and Retry reuse that model/GPU
session. Engine states are EMPTY, PREPARING, READY_IDLE, LEASED, RETIRING, FAILED
and DISPOSED. A FAILED engine denies new inference acquisition; explicit Setup validation can prepare another engine;
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
the page Resource Binding and healthy warm engine.
Natural completion and abandonment retain their distinct contracts below.

Persistent state consists only of user preferences and the verified OPFS
model asset. Readiness, warm engine, tempo/metronome/scope and current completion
are browser memory; capture, clocks, evaluation and recorder are session resources.
Practice Results/reports remain transient and are never persisted.

Live note feedback is a presentation preference, mutable during ACTIVE/PAUSED.
OFF removes live supported/unsupported decorations while retaining score, range
and playhead. Evaluation and natural Result production operate independently of
the feedback setting. ON/OFF does not restart a session or engine. Review always
shows completed feedback; VideoExport always uses its clean-score contract.

## Session Planning

AdmittedPracticeBundle supplies bundleId, the parsed artifact and rendering MusicXML.
`PracticeIntent` contains only user choices: mode, input source, recording mode,
scope, tempo selection and metronome enabled. STEP recording is OFF.

The pure `planPractice(bundle, intent)` function produces an immutable `PracticePlan`.
It freezes its own projections and reuses the Bundle-admitted immutable artifact
reference without mutating or cloning it.
Its `bundle` projection contains the revision binding and artifact, without MusicXML. It owns mode,
resolved scope/tempo/metronome plans, immutable resource requirements and Continuous
Count-In policy. Input and recording truth are owned by the resource plan. A candidate
plan is pre-Start data; `executedPlan` is available only after explicit Start and stays
pinned during preparation, execution and completed presentation.

Start constructs one mode-specific `StepPracticeSession` or `ContinuousPracticeSession`.
Their common snapshot contract contains localSessionId, the exact executed plan,
completionReason and created/updated timestamps. STEP adds target/attempt state;
Continuous adds performance state. Runtime metronome toggles belong to those states.
Natural Continuous completion creates its transient Result from the completed session snapshot.

## Domain Ownership

`src/lib/practice/score/` owns admitted artifact facts, exact score ticks, piano keys
and meter facts. `planning/` owns intent and pure scope, tempo, resource, metronome and
Count-In resolution. `session/` owns local execution identity and runtime time-domain
mapping. Score depends on neither planning nor session; planning depends on score;
session references planning; mode domains consume these packages and remain separate.
Physical resources and health belong to retained binding/application owners.
Renderer note IDs are projected by `score-view/cursor-scope.ts`.

Artifact schemaVersion 1 has one canonical notation ownership graph and one canonical
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
they are not serialized target owners. Backend semantic graph validation checks identities,
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
owns local session identity, its ContinuousPracticePlan, durable timestamps, current
metronome state and session records.
Reading a session record does not drive a clock transition.

Continuous session accepts the domain-owned `ContinuousClockDrivenEvidencePort`.
A MIDI plan requires its factory; a microphone plan rejects that factory.
`continuous/input/midi-evidence.ts`
implements MIDI observation identity, delivery-grace coverage and terminal coverage;
the application controller supplies it. Terminal evidence is published before the
evaluator completes. Acoustic publications enter through the separate validated
analysis-publication boundary.

Shared `midi/` infrastructure publishes physical NOTE_ON facts in session time;
it has no mode-domain dependency. The Continuous input adapter projects these facts
into `observeMidiAttack`; acoustic observations enter only through `publishAnalysis`.
Shared `metronome/` consumes resolved musical timing from `PracticePlan.metronomePlan`
and its own minimal live sync-point contract. `MetronomeRuntime` owns scheduling state;
`MetronomeAudioPort` separates browser audio side effects. The browser adapter borrows
microphone attempt AudioContext without closing it, or owns a MIDI metronome context
and closes it once. Optional audio faults stay nonfatal. Mode, meter and tempo are
immutable during an attempt; enable/disable is live. Continuous
application code projects clock snapshots into that contract. Neither shared
infrastructure imports STEP or Continuous domain code.

`PracticeExecutionActor` owns exactly one explicit execution lifecycle. The page
supplies an admitted candidate plan and narrow ports through `usePracticeExecution`.
A pure state machine owns READY, STARTING, RUNNING, COMPLETED, RELEASING, ERROR and
DISPOSED. Start captures one immutable PracticePlan and constructs a selected leaf
controller; that controller creates the mode-specific PracticeSession from the plan.
Controller observations and async outcomes enter as executionId-scoped events.
Stale events cannot replace an accepted execution. Public views project accepted
state and leaf observations without accessing a controller.

End fences ordinary observations immediately and detaches before graceful leaf
retirement. RELEASING records END/REPLACEMENT/RETRY/DISPOSE and RETIRING/DISPOSING.
Only END retirement accepts a matching formal SCOPE_COMPLETED event while waiting
for leaf abandon and late preparation. Retirement settlement with accepted completion
publishes COMPLETED once and retains its media owner; it does not hard-dispose that
completion. Without natural completion, disposal finishes before READY. Route teardown
and composition/admission replacement hard-dispose and reject late completion.
Temporary Start-readiness changes do not replace an accepted Bundle or execution.
All retirement, disposal and late preparation work must settle before another controller can be
constructed. Release failure blocks Start. Retry is accepted only after natural
completion and reuses the exact executed plan after release; it requires current
admission and matching composition. Composition replacement releases without auto-start.
Natural completion publishes once after COMPLETED, with an atomic Continuous payload.
Controllers retain their mode-specific domain evaluation and processing pipelines.

Strict artifact parsing at the Practice Bundle projection is the score-level
correctness authority. Setup invokes it only from Start Practice, before qualification;
Practice invokes it defensively before plan/execution admission and stays in place on failure. Planners/controllers
consume admitted runtime values and do not perform full artifact validation.
The acoustic foundation remains score-blind. Static architecture checks enforce
these dependency and ownership boundaries.

## STEP_BY_STEP

STEP is paced learning, not a performance report. The shared schemaVersion 1 artifact is
validated revision-wide before scope selection. StepPracticeSession owns progression;
StepPracticeController owns inputs, metronome, cancellation and resource cleanup.
There is no STEP Performance Clock or Pause/Resume lifecycle.

`StepPianoKeyEvidence` contains1..128 raw numeric attack keys, finite confidence and
same-session capture end. Admission checks ownership/state, capture time, confidence,
Array/nonempty/raw128, then own dense indices and the score piano-key predicate,
before Set+numeric-sort normalization, exact structural comparison and retention.
Raw129 rejects before indexed reads. Malformed evidence leaves ANALYZING/active
ownership retryable. Extra non-index properties are irrelevant; there is no complete
hostile-getter/proxy protection claim. Raw128 is not derived from the88-key domain.

Both sources compare all normalized observed attack keys with attack targets.
Equal cardinality and every equal member yields MATCH; subsets, supersets and other
sets yield MISMATCH. Continuation is excluded. Confidence is metadata, never a
verdict threshold. No target-aware source filtering or evidence loss is permitted.
Revision-wide artifact admission establishes the physical-key target contract;
STEP evidence admission uses the score piano-key predicate.

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

`ContinuousPracticeController` is the browser effect host. Its pure
`ContinuousControlState` machine is the sole controller-level lifecycle and
intervention authority. Commands, browser callbacks and asynchronous outcomes enter
one event mailbox. Each transition publishes accepted state and runs explicit
effects; callbacks raised inside an AudioContext clock transaction wait in that
mailbox until the transaction returns.

PerformanceClock, ContinuousPracticeSession, analysis input and PerformanceRecorder
remain independent owners. The machine consumes their immutable observations and
coordinates preparation, transport, analysis release, recording retirement and
cleanup. Browser handles and memoized operations carry resources, not lifecycle
truth. Snapshot reads project accepted state and non-advancing leaf observations;
only explicit refresh or a formal domain transition advances semantic deadlines.

Analysis and resource incidents remain separate facts with one shared pause owner:
NONE, USER or INTERVENTION. Clearing an incident cannot resume while another blocker
remains. User-owned pauses require an explicit Resume. Analysis degradation during
active execution permanently disables inference only after explicit learner choice;
during natural finalization it makes evaluation unavailable without opening a dialog.
Recording and evaluation availability remain independent.

A formal SCOPE_COMPLETED observation enters one FINALIZING workflow and wins later
End commands. End before that latch abandons without advancing time. Finalization
freezes recording, drains enabled analysis, finalizes media and materializes the
atomic completion, then awaits attempt-resource cleanup before publishing COMPLETE.
Operation-scoped outcomes cannot revive an abandoned, failed or disposed attempt.
React subscribes to snapshots and sends commands.

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

The Resource Binding owns the root microphone. Analysis and recorder use independent
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
`/model-assets/practice-acoustic/access`. The acoustic README
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
selected implementation and asset attestations. Acoustic model and source-adapter
identities belong to their evidence owners and qualification tests.

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

MIDI maps captured event timestamps through Session Time into Performance Time.
Acoustic evidence maps physical source samples through the active performance
segment. Neither mapping applies a measured hardware offset or shifts events by
analysis availability. Transport, target feedback, Review and score annotations
consume these uncorrected event coordinates.

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
bundle provenance, confidence, session availability and monotonic performance analyzed-through
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
score/playhead, completed annotations, useful metadata and recording/save/export
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

## Transient Continuous Result

`ContinuousPerformanceResult` is an immutable in-memory value produced only by
natural completion. It contains `{ session, evaluation }`. The completed session
projection requires SCOPE_COMPLETED, lifecycle ENDED and performance ENDED. Its
exact executed PracticePlan owns binding, artifact, scope, tempo and input facts;
its performance snapshot owns active elapsed time. Session updatedAtMs supplies
completion metadata time. Result construction freezes its own session/performance
shells and preserves exact Plan, Artifact and completed Evaluation references.

The factory validates evaluation input/session identity and COMPLETE assignment
coverage of exactly the canonical scoped attacks. Generic assignment/evaluation
can represent STOPPED_BY_USER for diagnostics; it does not qualify for a natural
Result. UNAVAILABLE evaluation remains independent of recording availability.

Result is not a serialized or versioned contract. Review receives the typed atomic
`ContinuousPracticeCompletion { result, recording }` handoff in browser memory.
Recording remains a separate media artifact. STEP creates no report Result.

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

The acoustic model owner defines the analysis name/core SHA-256, model SHA-256
and authoritative decoder-source SHA-256. Source-adapter identities distinguish
44.1kHz and 48kHz realization. These identities support model loading, integrity
and characterization; transient Results do not copy them. Observation provenance
retains the actual source-domain event coordinates used for evaluation.
Confidence remains evidence metadata without another uncalibrated threshold.

## Recording Artifact

`recording/` owns recording semantics, recorder resource lifecycle, replay descriptors and
media-to-performance synchronization. `PerformanceRecording` is a discriminated
NOT_RECORDED / UNAVAILABLE / READY artifact. Only READY carries AUDIO/VIDEO kind,
LocalMediaAsset, MIME and an immutable recording timebase. Selecting AUDIO or
VIDEO requires successful recording admission before transport/count-in begins.
`PerformanceRecorder.prepare()` resolves only for admitted recording or OFF; missing
or dead required tracks, permission/device loss, unsupported recorder/MIME, unavailable
OPFS/Web Locks and storage initialization failure reject with stable recording preparation codes. Admission
is rechecked immediately before transport starts. Failure releases this Start's
owned resources and inference lease, preserves recording intent and remains an
Attempt admission failure, without invalidating Environment. It creates no Result, dialog or recording
artifact, and does not classify recording faults as acoustic-analysis faults.
Setup owns the retained physical roots and probes writable OPFS; recorder admission
checks fresh attempt clones and its new sink. Start never acquires
browser devices or repeats cold model preparation.

Post-start recording faults are actively published once per unresolved incident by
`PerformanceRecorder`, independently of input and acoustic-analysis errors. The
Continuous controller pauses its canonical transport, metronome and evidence
chronology and exposes a dedicated recording intervention. Performance time and
finality cannot advance beyond that pause boundary while the user decides.

A temporary muted recording track is recoverable only while every required track
remains live, becomes unmuted, and the same MediaRecorder remains usable. ResourceBinding physical-source facts and owned-clone/MediaRecorder events update
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
next Start uses the matching retained admission, exact bound Bundle, binding health and engine lifecycle.
Returning to Setup releases the binding; explicit Start Practice admits fresh Bundle and live roots.
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
`CONTINUOUS_ANALYSIS_UNAVAILABLE`, never partial COMPLETE truth. The Result retains
the completed evaluation. Healthy media finalizes normally;
Review retains replay/save/export and its unavailable notice without target colors.

Acoustic analysis release neither closes the controller AudioContext nor stops the
borrowed root stream, metronome or recorder. Analysis-source health consumption is
irreversibly released with analysis; ResourceBinding continues observing retained physical
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
from the completed session's active performance duration; recording owns its media separately.

RecordingTimebase uses integer microseconds and is the sole nominal Capture duration
owner through `nominalMediaDurationUs`. All coordinates are nonnegative JavaScript-safe
integers. A published timebase has at least one positive-duration active segment and
positive nominal duration. The first media coordinate is zero, media segments are
exactly contiguous, performance segments do not overlap, and each segment's media
duration equals its performance duration. Pause gaps exist only on the performance
axis. Nominal duration exactly equals the final media endpoint; extra fields are rejected.

The recorder's mutable builder quantizes runtime milliseconds once to the nearest
microsecond, with ties upward, and uses integer arithmetic thereafter. Zero-duration
intervals do not form segments. A builder without a positive segment cannot publish
READY. Finalized coordinate projections are copied and frozen.

Actual decoded media duration is a runtime observation. Replay maps browser time to
integer microseconds, scales actual to nominal coordinates using exact BigInt products
and nearest-integer division with ties upward, then maps through the active segments.
A shared media boundary selects the preceding performance endpoint. Presentation and
score-tempo integration convert the resulting performance microseconds to milliseconds.
The actual container duration never changes the durable timebase. The shared executable
contract is `contracts/practice/recording-timebase-cases.json`, consumed by Python and
TypeScript tests.

Recording OFF acquires no media. Microphone+AUDIO borrows a clone of the session
stream; MIDI+AUDIO borrows a clone of the retained recording-microphone root. VIDEO uses camera video
and the appropriate audio clone. Each owner releases only its own resources.

Saved Performance Take archives AUDIO/VIDEO media with durable binding provenance,
scope, tempo and recording timebase. It does not persist Practice assignment,
derived target summaries, metrics or implementation provenance. Review Save Recording is an
explicit user action that reads only a READY recording and archive metadata.
Completion, Review mount and Review exit never create a PerformanceTake.

## Transient Completion Handoff

`continuous/completion.ts` composes `{ result, recording }` without flattening either
artifact. The controller terminates transport, freezes recording, drains acoustic
tail work, finalizes evaluation/media, creates the result and completes
input/recorder cleanup while retaining sealed media before publishing the atomic completion and notifying completion listeners.
PracticeExecutionActor exposes that exact payload only for the current completed
Continuous attempt; STEP exposes no Continuous completion.

Analysis-unavailable can coexist with READY recording; complete evaluation
can coexist with UNAVAILABLE recording. Neither failure invents or discards the other
artifact's truth. The handoff is transient application state, not durable persistence.

End, Retry and new attempt execution remove the old completion from the execution
view. View Review is an explicit workspace transition: it validates completion/Bundle
identity, retains `{ result, recording, musicXml }` as one TransientReviewSession,
and releases the prepared physical binding before navigation. Try Again creates no
Review handoff. Artifact remains owned by the executed Plan; notation and owned media
are reused without byte copies.

## Natural Completion and Abandonment

SCOPE_COMPLETED is the only product completion. STEP reaches it through MATCH or
Skip progression to the full-piece or selected-section terminal. Continuous reaches
it through its transport. Only this terminal state calls onNaturalCompletion and
opens the completion dialog. STEP offers Try Again and section adjustment, without
report navigation. Continuous additionally offers View Report.

STOPPED_BY_USER is abandonment. End calls abandon(), cancels pending work and
releases attempt input bindings, metronome, inference lease, capture/recording clones
and AudioContext ownership. Page Resource Binding roots and the warm Environment remain. It discards
unfinished session state and retires unsealed Capture storage without draining the acoustic tail,
finalizing a recording or creating result/completion handoff. No dialog or
report appears. The presentation returns to its pre-start ready state; preferences
may remain, but the next explicit Start creates fresh session/resource ownership.
This applies during count-in, running and pause. A formally latched SCOPE_COMPLETED
wins a later End; End before that latch wins over subsequent timer/publication work.

## Ephemeral Practice Report

Continuous Practice Reports are browser-local products of an explicitly handed-off
natural completion. The workspace owns the transient ReviewSession. Review and its
current local composite/export require no Bundle read, cache entry or current Score
access. Score/Revision deletion blocks future admission but does not revoke the
admitted browser flow. Explicit exit, Setup/Practice route entry and provider disposal
end the handoff. No localStorage, sessionStorage, IndexedDB, backend result API,
database or serialized URL persists it. Direct visit/reload shows expired Review and
performs no Bundle recovery. Saved media does not reconstruct a Practice Report.

Save Recording persists media only through an explicit user action. It does not
persist evaluation, metrics or provenance, and does not extend the report lifetime.
My Performances is a saved media archive with playback/download/video-export actions,
without learner report statistics or saved learner-report navigation.

## PerformanceTake Upload Reservation

```text
completed local recording -> immutable upload reservation -> direct binary upload
                         -> finalize(reservationId) -> durable PerformanceTake
```

`POST /performance-takes/upload-reservations` captures client_request_id, practice_binding,
media, scope selection, tempo selection and recording timebase once. Practice binding contains
score_id, revision_id and bundle_id; media contains kind, canonical MIME and byte size. The
reservation snapshots exact bundle provenance and score title under live save authorization.
Clients submit FULL or RANGE group IDs and SCORE or CUSTOM_FIXED_BPM selection;
the server derives durable scope ticks, tempo segments and their shared score timebase
from that exact bound Bundle. Response metadata describes intent/evidence; `score_timebase`,
`resolved_scope` and `resolved_tempo_plan` describe the accepted coordinate snapshot.
Before upload and before saved success, the browser verifies agreement with its
executed Result session Plan and its artifact's `ticksPerQuarter`. Plan mismatch fails closed;
a new RESERVED mismatch is cancelled best-effort without media upload.
Client-request
idempotency belongs to this boundary: equal normalized metadata returns the same
reservation/take identities; different metadata conflicts. RESERVED replay can refresh
the signed upload target. FINALIZING replay provides state, and COMPLETED replay returns
the saved Take. The nested upload target is an ephemeral URL/method/headers/expiry capability.

`POST /performance-takes/upload-reservations/{reservation_id}/finalize` has no body.
It copies the persisted score timebase, canonical scope/tempo and recording evidence
without Bundle reads or replanning. Live score deletion,
access changes or head-revision changes do not invalidate an admitted reservation.
`DELETE /performance-takes/upload-reservations/{reservation_id}` cancels a pending
RESERVED reservation; CANCELLED cancellation is idempotent. FINALIZING, COMPLETED
and EXPIRED cannot report successful cancellation. Both routes use the user-scoped public upload UUID, independently of the
backend-internal `storage_reservation_id` quota handle. Object keys remain server-owned.

UploadReservation is a persisted lifecycle aggregate. Its states are RESERVED,
FINALIZING, COMPLETED, CANCELLED and EXPIRED.
[Reservation architecture](performance-take-reservations.md) defines lifecycle,
persistence, cleanup and object ownership.
A unique, non-null Take foreign key establishes one reservation to at most one Take.
The Take owns raw durable media and immutable provenance snapshots, never PracticeBundle.
A committed reservation is self-contained even after Bundle GC. Playback/listing read the Take's
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

## Clean Video Export Score

VideoExport is a browser-local composition/download capability. Its transient output
is downloaded to the user's device. It owns no durable server asset and grants no
sharing access. PerformanceTake owns the raw recording; Guest Preview is a separate
authorization domain. Saved exports use `/my-performances/{takeId}/video-export`.

Review annotations remain ephemeral presentation of result.evaluation, with the
same supported/green and unsupported/red targets as live Practice. VideoExport contains a clean musical score and its
own playback cursor, never report annotations. Snapshot preparation strips report
classes and existing active/playhead decorations from the cloned SVG only. Live
Review annotations remain intact. Current recordings and saved takes share this
clean-score contract; VideoExportSession contains score/scope/tempo/media/timebase,
without evaluation or metrics.

## Score View, Review and VideoExport Ownership

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

`review/` consumes the workspace TransientReviewSession. Its constructor guarantees
atomic binding/result/artifact identity and complete notation. review-score-state.ts
projects cursor scope; Verovio owns rendering failures. review-replay.ts delegates
synchronization to recording timebase; review-view-model.ts projects result metadata.
The route owns save-recording mutation, navigation, leave confirmation and
VideoExportStudio state, with no Bundle query or subscription. Save Recording remains
an explicit server operation and new save admission requires live revision-binding authorization.

`video-export/session.ts` defines a neutral score/scope/tempo/video/timebase contract.
The current-completion adapter consumes the transient handoff; the saved-Take adapter
parses backend archive metadata and its reauthorized Bundle. Both provide the same
session to source-neutral preview/render/export consumers. The current adapter's
Review input is type-only; downstream render/export owns no result/evaluation/Practice
capture lifecycle. The output recorder belongs to export. Floating-score styling is
video-export presentation policy.

VideoExport score snapshots consume canonical decoration constants and remove report
classes and existing active/playhead nodes from the frozen clone only. Live Review
annotations remain untouched; export inserts only its own playback cursor. Sharing
retains 30fps, MIME preference, geometry, audio extraction, frame prefetch and abort
behavior. No presentation context is imported by score, planning, session, STEP/Continuous domain,
acoustic, result or recording owners. Concrete module imports define these boundaries
without aggregate barrels or forwarding paths.

## Meter, Pitch and Tempo Admission

Practice requires an explicit valid initial meter and supports inherited meter and
meter changes. Missing, malformed or unsupported unmetered notation is INVALID_SCORE.
A key signature is not required. Explicit tempo is optional: SCORE selection uses
PRODUCT_DEFAULT 80 quarter-note BPM before any explicit MUSICXML tempo. The detailed score
admission and timing contract belongs to the [Practice score compiler](practice-score-compiler.md).
Continuous PerformanceClock owns count-in: the current policy gives 3/4 three beats
and three pulses, 6/8 three beats and six pulses, and 2/2 four beats and two pulses.
These are execution policies defined by [session planning](practice-session-planning.md).
STEP has no count-in.

## Exact Practice Binding Provenance

Continuous Result references its completed session and executed Plan bundle projection.
Review validates the exact admitted binding and artifact reference. Save submits
`practice_binding: {score_id, revision_id, bundle_id}` from that executed Plan.
A Take stores immutable Bundle/Score/Revision/artifact provenance without retaining Bundle.
Saved score export reauthorizes the revision binding and verifies exact Bundle/artifact
identity; raw playback and download remain independent of revision lifetime.
The [Practice Bundle contract](practice-bundle.md) defines identity, authorization and retention.
VideoExport sessionId identifies the local derivative composition independently of bundleId.

## Capture and archive media contract

Capture is raw browser recording, incrementally written through RecordingSink to OPFS.
READY capture has an archiveable media kind and
container: VIDEO WebM/MP4, or AUDIO WebM/MP4/Ogg/WAV/x-WAV. The recording media policy
owns normalization, Video Capture preferences and raw-download extensions.
MediaRecorder's actual MIME is authoritative; unsupported output cannot become READY.

PerformanceTake archives the exact Capture bytes without transcoding. Original
media download returns those raw bytes. VideoExport composes a separate browser-local
score/video derivative using its own output format policy; PerformanceTake does not
archive that composed output.

## Local Performance Media Storage and Ownership

`practice/media/` owns shared browser-local byte lifetime and storage.
`local-media-asset.ts` owns immutable bytes and reference-counted asset references;
`opfs-media-file.ts` owns sequential file writes, exact byte accounting, seal/abort,
per-file Web Locks, orphan recovery and final-owner deletion. `download-local-media.ts`
owns the temporary download lease and object URL. `media/performance-take/materialize.ts`
streams authorized durable media into disposable local assets. The media core is
transport-free; only the PerformanceTake materialization subpackage consumes HTTP.
Neither depends on Practice product domains.

Recording owns Capture semantics and its RecordingSink port. The OPFS recording
adapter maps media-storage admission errors into RecordingFailure. PerformanceTake
owns durable archive semantics; VideoExport owns derivative composition. These
consumers depend on shared media and do not own its generic byte infrastructure.

All locally materialized performance media uses `LocalMediaAsset`: one handle owns
one reference, its Blob view and its byte size. Retain returns an independently
releasable handle. Release is idempotent, and the final reference retires the backing
storage once. A retired handle cannot acquire another reference. MIME belongs to the
recording or Take metadata. Replay, raw download and VideoExport consume the same
media contract regardless of source.

Production Capture requires OPFS and Web Locks. Selected AUDIO/VIDEO preparation
probes MediaRecorder and opens, writes, seals and removes a small temporary file.
Recording OFF requires neither API. There is no runtime memory or alternate-storage
fallback. RecordingSink serializes Blob writes in MediaRecorder event order without
materializing their bytes into JavaScript arrays. Musical timebase and pause/resume
mapping are independent of storage latency; disk backpressure does not pause music.

Finalization keeps requestData/stop ordering, then drains all writes and seals the
file before READY. The raw file snapshot is a file-backed Blob view with actual
MediaRecorder MIME metadata, not a full-file read into heap. Sink byte accounting
matches the final Blob size. Empty capture, stop timeout, unsupported MIME, accepted
recording loss and failed writes cannot publish READY media. Untransferred storage
is aborted and removed by awaited recorder/controller cleanup.

The controller owns the first sealed-media reference. Successful completion keeps
that owner beyond recorder/input cleanup. Review handoff validates identity before
retaining a separate owner and never copies media bytes. Controller retirement
releases its completion owner; clearing, replacing or leaving Review releases the
Review owner. Save, original raw download and current-completion VideoExport retain
independent temporary leases and release in finally. Original download revokes its
object URL before release. Replay holds its own lease until its element URL is revoked.
VideoExportStudio holds one operation lease for both current and saved sessions,
including cancellation and route exit. The last owner removes the OPFS file.

Preparation storage failures are recording preparation facts. Active write failure
is a recording-only RESTART_REQUIRED intervention; Continue without recording retires
its storage before continuing. Active sink cleanup failure uses RESOURCE_CLEANUP_FAILED.
Deletion failure after publication is reported through client observability without
retroactively failing a completed performance; the orphan remains recoverable.

The dedicated `noteverse-practice-captures` namespace uses random UUID identities.
A per-capture Web Lock spans file creation, recording and all sealed-media references.
Each later capture initialization reclaims files only when an exclusive ifAvailable
lock succeeds. Other tabs' live captures are protected; crashed owners lose their
locks and their files become reclaimable. No age heuristic or cross-namespace sweep
is used. OPFS is temporary storage, not Review recovery: reload still expires Review.

Saved Take score-video export streams its authenticated HTTP response directly into
temporary OPFS, writing each chunk before reading the next. It never buffers the whole
source media in JavaScript heap. Content-Length, when present, must agree with durable
Take size; the final written byte count must match that size, and response MIME must
be compatible with Take metadata. There is no arbitrary frontend saved-media size ceiling.
Missing streaming/OPFS support fails local materialization without a memory fallback.

Downloaded bytes use the separate `noteverse-performance-take-media` namespace and
per-file lifetime locks. Last release removes a completed file; abort or failure removes
partial bytes. Initialization reclaims unlocked orphans while preserving other tabs'
held files. The page owns one downloaded handle and releases stale results immediately.
Take remains durable authority; temporary local media is neither a cache nor a
cross-reload session. Ordinary server playback URLs retain their independent contract.

Archive remains explicit Review Save of raw Capture bytes into PerformanceTake.
VideoExport source media is a LocalMediaAsset retained by Studio for the whole
export operation. Encoded output chunks are incrementally appended in MediaRecorder
event order to `noteverse-video-export-output`, using a finite 1000ms timeslice.
The operation never retains the complete encoded output in a JS chunk array.
Stop drains all accepted writes before seal. The shared OPFS primitive validates
exact byte accounting; seal uses the selected recorder MIME. Empty output fails closed.

VideoExport returns `{ media: LocalMediaAsset, mimeType, durationMs }` for a new
file-backed derivative. The caller owns that reference until download handoff is
complete. Studio calls downloadLocalMedia, which retains its own download lease,
then releases the result owner in finally, independently from its input-media lease.
Cancellation, encoding/write failure and unpublished sealed output retire their
partial or final storage before failure returns. Missing OPFS/Web Locks/writer
support fails unavailable without a memory fallback.

Output files use per-file lifetime Web Locks and the shared orphan/sidecar recovery
mechanism. Final-owner release removes the output file; later initialization may
reclaim unlocked crash orphans while protecting another tab's active output.
These files are temporary browser-generated derivatives, not PerformanceTake
persistence, an offline cache or reload-recoverable export state.
No Capture bytes are streamed to the server while the user plays.

Explicit tempo interpretation and the cross-runtime missing-tempo policy belong to
[Score tempo semantics](score-tempo.md).
