# Practice Product Contract

## Execution and Inputs

Practice execution is browser-local. The backend provides canonical score, source
and `PracticeScoreArtifact` data, plus immutable model assets. Once the required
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
configuration. Idle not-ready entry returns to Setup; an active recording intervention
keeps the current attempt in Practice while the user decides. STEP settings contains configuration navigation only. Continuous Live Feedback uses a labelled, keyboard-accessible Switch in Practice,
not Setup. It only changes current score feedback visibility: readiness, session identity,
inference, evaluation, Review and Share Video remain unchanged. The preference persists
with the profile and defaults to OFF.

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
all root-track disposal. Required device health is represented by compact status
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
`practiceDeviceRequirements`. Microphone icons keep the same glyph: healthy is green,
unavailable/interrupted is red, with localized accessible labels. Required camera and
MIDI resources use the same compact pattern. Popovers are informational only: resource,
health and issue facts, without commands or access to device/platform/session owners.

Explicit device/permission requalification belongs exclusively to Practice Setup:
The single Prepare practice action calls `workspace.requalify()`, which invokes
`PracticeEnvironment.requalify(requirements)`. Every click runs fresh browser/device
requirement probes even when previous evidence is READY. There is no READY shortcut or
Continue-to-practice action on Setup. `workspace.ready` is live Practice admission
evidence, not a command to skip Setup qualification.

A stable, quiet Practice setup navigation is always available. Both that navigation
and Settings → Setup only close the Settings sheet and push the exact pinned revision
URL. Navigation has no device/environment side effects: no acquisition, qualification,
invalidation, restart or synthetic failure reason. Active attempts end through normal
page unmount/disposal. Direct/alternate Setup entry follows the same fresh Prepare rule.

Explicit requalification moves normally to CHECKING and then READY, or BLOCKED only
when that qualification transaction actually fails. Entering Setup is not a failure.
A healthy READY_IDLE acoustic engine/model/worker stays warm: fresh external probes do
not recreate the engine, request model access, download or load the model again. A
FAILED/DISPOSED engine is replaced and prepared through the same existing transaction.
No second preparation lifecycle or idempotent compatibility wrapper exists.

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

Natural same-resource recovery remains distinct. Microphone mute/unmute observes the
same root and preserves existing recovery semantics. Existing MIDIAccess statechange may
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
ready, Try Again returns to Setup requalification instead. There is no in-place root
replacement or multi-segment recording.

Leaving the exact Practice page for Setup, Review, Score or another route immediately
stops its root microphone/camera tracks and detaches MIDI/device listeners. Same-page
End retains these devices and their browser privacy indicators. Review Retry opens
a new Device Lease. Leaving the entire Practice layout also closes the Environment.

Each Attempt has a fresh localSessionId, PracticeTimebase/source domain, AudioContext,
capture chronology, inference token, evaluator/ledger, recorder and recording timebase.
Attempt cleanup releases its capture, context, inference lease, recorder clones and
listeners. A new attempt is not a new environment setup: Start, Try Again, Restart
and Review Retry never repeat readiness probes, model access, model download or ONNX
creation. One healthy workspace loads the model/ONNX session once. Try Again and
Restart bind and start automatically, without a second Start click.

Practice has no ready prose or global startup banner. Continuous Start alone shows a
compact disabled busy state. Normal Continuous running has no status prose. Count-in,
Pause, intervention and errors remain visible; STEP retains its teaching instructions.
Settings links back to Setup, without inline mode/input/recording editors.
Continuous settings also contains the presentation-only Live Feedback Switch.

STEP first entry auto-arms after devices and score/scope/tempo are available. There is
no initial Start or performance/recording timer. Ordinary healthy End discards the
attempt and waits for Continue practice; Try Again starts a fresh attempt directly. Scope/tempo edits
are blocked only during CAPTURING/ANALYZING; waiting and POST_VERDICT edits rebind a
fresh attempt on the same Device Lease. Metronome toggling does not rebuild devices.

A recording indicator is shown only after an AUDIO/VIDEO recorder actually starts:
a red dot and recording elapsed time. STEP and Continuous OFF show no timer. Pause,
Resume Count-In and interventions freeze recording duration; explicit continuation
without recording removes the indicator.

Bounded engineering-only diagnostics distinguish deviceLeaseOpen from per-attempt
waitPreviousRelease, acquireInferenceLease, audioContextResume, firLoad, captureConnect,
acousticPreroll, midiBind and recorderAdmission. They never enter Result, metrics,
PerformanceTake or backend data and have no learner-facing debug UI.

## Practice Readiness

`readiness/` derives requirements purely from the complete configuration. Live
readiness is UNCONFIGURED, CHECKING, READY or BLOCKED, with component diagnostics
and download progress. Its fingerprint represents the effective requirement set,
so equivalent configurations may use the same live admission evidence. This never
skips explicit Setup requalification; unrelated presentation changes do not invalidate
the evidence. Readiness is never persisted.

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
microphone audio; camera acquisition is video-only. Recorder probes use the same
MIME strategy as the session recorder, construct and start/stop a real recorder,
and discard all probe data. Probe tracks, worklets and AudioContexts are released.
VIDEO/AUDIO/MIDI failures keep the selected intent and block Start; no fallback
changes the configuration. Technical reason codes are available behind details.

`/practice/setup` owns explicit preparation. Practice entry redirects there until
the selected requirements are satisfied, preserving revision identity. Practice settings
only link back to Setup to change mode, input or recording; no inline selector or
standalone Prepare patch is present. Full reload restores preferences, not readiness or GPU memory.
Setup success does not promise immutable permissions. Practice page binding acquires live
devices and fails closed on device/permission loss without cold model bootstrap. Start
only binds fresh attempt-owned resources to the admitted Device Lease.

## Practice Environment

The shared Practice layout keeps one stable `PracticeEnvironment` service across
Setup, Practice, Review and Retry. `environment/` owns infrastructure preparation,
readiness diagnostics and the score-blind `acoustic/model/acoustic-engine.ts`.
It owns no score, scope, evaluator, attempt, result or recording artifact.

```text
Preferences -> Readiness gate -> Warm environment -> Session inference lease
                                  |                       |
                           workspace lifetime       fresh every Start
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

Persistent state consists only of user preferences and the existing verified OPFS
model asset. Readiness, warm engine, tempo/metronome/scope and current completion
are browser memory; capture, clocks, evaluation and recorder are session resources.
Practice Results/reports remain transient and are never persisted.

Live note feedback is a presentation preference, mutable during ACTIVE/PAUSED.
OFF removes live supported/unsupported decorations while retaining score, range
and playhead. Evaluation and natural Result production
continue unchanged. ON/OFF does not restart a session or engine. Review always
shows completed feedback; Share Video always uses its clean-score contract.

## Domain Ownership

`src/lib/practice/kernel/` owns the pure, cross-mode artifact contract, canonical
scope, count-in, tempo, session timebase and common session identity/completion
metadata. It depends on neither mode, acoustic implementation nor browser resources.
Artifact validation and access stay in `artifact.ts`; scope and count-in policy have
their own modules. Renderer note IDs are projected by `score-view/cursor-scope.ts`.

Practice targets represent physical piano strikes, not notation multiplicity. At one
onset each physical pitch has exactly one strike target and one attack target, and
the unique target pitches equal the group's unique pitch set. Same-pitch notation
across voices/staves is aggregated under that target, retaining every note identity,
render identity and voice/staff metadata for rendering and annotations. Each target
has nonempty, same-pitch notation and an exact render-ID aggregate; strike targets
partition the group's flat expected notes by `expectedNoteId` without missing or
duplicate ownership. Nested notation render identities must be nonempty and unique
before aggregate comparison. Group render IDs exactly represent its expected notes;
step render IDs exactly represent all attack and continuation notes. `stepNoteId`
is nonempty and unique across the entire step, including continuation. Different
notation notes never share a render identity or semantic note identity. Frontend
artifact and backend source/catalog boundaries reject
malformed duplicate physical targets or inconsistent notation without repair.
Continuation is separate: a tied C4 continuation may coexist with a new C4 attack
in another voice. Artifact schema remains 1; valid generator output and identity do
not change. STEP pitch-set comparison and Continuous strike projection consume this
shared physical contract without redefining multiplicity.

`step/domain/` owns pitch evidence, exact target comparison, target progression and STEP snapshots.
`continuous/domain/` owns performance clock/timeline mapping, session composition
and Continuous snapshots. Its `evaluation/` separates immutable evidence,
source-blind assignment/finality and narrow target feedback. The evaluation
session composes these owners; live feedback contains settled target identities and
assignment states, while completed evaluation retains the full assignment. The two mode domains do not
depend on one another. Consumers import concrete owner modules directly.

The performance clock owns transport coordinates and accepts an established
`PracticeTimebase`. `ContinuousPracticeSession` owns session identity, input source,
durable timestamps, runtime metadata, metronome selection and session records.
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
Shared `metronome/` consumes its own minimal sync-point contract. Continuous
application code projects clock snapshots into that contract. Neither shared
infrastructure imports STEP or Continuous domain code.

Application controllers compose domains, browser inputs and owned resources.
Hooks/pages render snapshots and send commands. The acoustic foundation remains
score-blind; only its Continuous projection references the evaluator's publication
type contract. Static architecture tests scan production imports and dependency
cycles to enforce these boundaries.

## STEP_BY_STEP

STEP is a paced learning/recognition mode, not a performance-report mode.
`StepPracticeController` owns input resources, metronome, cancellation and cleanup.
React subscribes to snapshots and sends commands. STEP has no performance clock
or Pause/Resume lifecycle. Elapsed presentation time does not drive progression.

`StepPracticeRuntime` owns one target and one bounded attempt:

```text
READY -> CAPTURING -> ANALYZING -> POST_VERDICT -> READY / scope completion
```

Input owners publish score-blind `StepPitchEvidence`: 1–128 canonical pitch entries,
finite confidence in `[0,1]`, and a same-session capture end at or after attempt
start. Silence opens no attempt and produces no synthetic outcome or timeout.
Confidence remains evidence metadata, without a secondary confidence threshold.

Both MIDI and microphone compare normalized observed attack pitches with normalized
expected attack pitches. Exact equality yields MATCH. Every other nonempty evidence
set yields MISMATCH, including subsets, supersets and unrelated pitches. Continuation
pitches are excluded. The immutable record retains all evidence and either MATCH or
MISMATCH; runtime schema 8 (`step-exact-pitch-learning-v9`) defines this contract.
Equality compares normalized cardinality and each string directly. Delimiter-containing
artifact pitches remain opaque single members: `C4\u001fE4` is not the two-member
set C4/E4. This v9 verdict correction preserves artifact/evidence admission and
Set+sort normalization; schema8 retains the existing session/record shape.

POST_VERDICT holds only the current pending result. Explicit rearm clears it:
MATCH advances exactly once; MISMATCH remains on the same target. Skip is a separate
READY-only progression action. No full attempt/skip history, attempt counts,
accuracy statistics or learner performance report belongs to STEP. Its performance
evaluation is always null. Completion offers Try Again and Section Practice / Adjust
Section. Review navigation belongs to Continuous performance; STEP completion
cannot supply a report action.

Microphone READY instructions ask the learner to play the highlighted target and
wait for the result before playing again. CAPTURING/ANALYZING asks them to wait while
the answer is checked. These states reflect actual published evidence, without a
physical-onset busy detector. MIDI uses shorter input instructions. MISMATCH copy
says “Not matched yet. Try again.” rather than claiming wrong or extra physical notes.

Attempt identity binds session, step, target generation, input source and capture
start. Input eligibility is exclusive: `attemptStart > inputEligibleAfter`.
Readiness, reconnection, Skip and rearm maintain a finite, same-session, monotonic
boundary. One active attempt is allowed; busy input is discarded. Late publications
cannot become a new target's input.

MIDI input owns a first-NOTE_ON-anchored, half-open 35ms gesture. It closes the whole
gesture before evaluation. Native event timestamps pass through `PracticeTimebase`;
callback arrival time is not attack time. Velocity-zero NOTE_ON is NOTE_OFF. Held
notes require a new NOTE_ON for a repeated target.

Microphone input composes the shared acoustic foundation with a score-blind H50
attempt assembler. H50 groups source observations within one 50ms gesture and seals
it using processed source coverage. Physical capture chronology supplies retirement
boundaries independently of analysis progress. After a verdict, domain rearm and
input arm run synchronously at that physical boundary. Skip blocks the idle
assembler, changes the target and rearms at the same boundary.

STEP retains only active H50 observations, one bounded source-publication chronology
summary and the physical retirement/processed watermarks. It has no session-long
observation identity/fingerprint ledger or historical identity limit. H50 remains
anchor-inclusive and right-edge-exclusive, and cannot seal across a source-region gap.
The persistent microphone, inference lease, capture graph and source runtime are
not restarted per target.

Physical input captured while an answer is busy is retired, never queued or deferred
to the next target. The physical frontier may be ahead of the analysis frontier;
domain rearm followed synchronously by microphone arm shares that capture watermark.
Only a source event strictly after it can open another attempt, including when a
publication arrives late. Retirement prevents already captured or delayed evidence
from crossing attempt boundaries. It does not assert that future acoustic observations
after the watermark represent a fresh physical key attack. Sustain/resonance may
require evidence-based onset/activity/release policy; no cooldown or silence gate
is part of this contract.

Newly owned analysis may arrive behind the physical retirement watermark and is
discarded without queuing. An event behind an already owned analysis frontier is
instead a source-contract violation and fails closed, even while input is BLOCKED.
Exactly-once source delivery plus strict physical eligibility prevents one retired
gesture from satisfying consecutive identical targets without retaining its IDs.


The Device Lease owns the microphone root; the controller borrows it and owns the
attempt AudioContext. The input owns its analysis clone, capture bridge, assembler and
source-analysis graph. Abandon/dispose await attempt resource release; restart constructs a fresh controller after
cleanup. MIDI disconnection cancels unfinished input and retains the same target
and MIDIAccess owner; reconnection establishes a fresh eligibility boundary.
An admitted ACTIVE STEP microphone terminal infrastructure failure latches the
application-only `StepInfrastructureIntervention = { kind: 'TERMINAL_INFRASTRUCTURE_FAILURE' }`.
Root track loss, terminal AudioContext interruption/closure, capture failure and invalid
source mapping/chronology stop input and immediately release unusable attempt resources.
Controller/domain stay ACTIVE with unchanged session, current target and progress,
input unavailable and completionReason null, behind an End-only blocking dialog.
The separate analysis and infrastructure interventions are mutually exclusive: the
first terminal owner is latched before cleanup and cannot be replaced by later callbacks.
Cleanup failure also retains this owner and target truth; it never ends the session.
Only explicit End or page teardown ends the retained session as `STOPPED_BY_USER`.
No fault becomes a learner verdict, Skip or natural completion. PREPARING infrastructure
failures retain admission/error semantics without an intervention or admitted session.
An admitted ACTIVE STEP microphone terminal analysis failure instead latches the
application-only `StepAnalysisIntervention = { kind: 'TERMINAL_ANALYSIS_FAILURE' }`.
Fault detection is not session end: controller and domain remain ACTIVE with the same
session/target/progress. `runtime.setInputUnavailable()` prevents input and Skip,
cancels unfinished CAPTURING/ANALYZING attempts without a verdict and preserves any
finalized POST_VERDICT record, currentIndex and targetGeneration. No rearm, advance,
retirement boundary, automatic retry or inference reacquisition follows failure.

The blocking STEP analysis dialog has exactly one action, End. Escape/outside click
cannot dismiss it. Only explicit End (the normal abandon path) or page unmount ends
the retained runtime/application owner; neither creates natural completion or Result.
Page End latches manual-end/auto-arm identity before abandonment, preventing an effect
from restarting. Cleanup immediately releases failed capture/source runtime/inference,
listeners, attempt AudioContext and metronome, but retains runtime truth until End.
Borrowed microphone roots and the outer Device Lease are not stopped or released by
this attempt cleanup. Cleanup and subsequent End/unmount share idempotent releases;
stale callbacks cannot revive the owner. Analysis resource cleanup failure retains the
analysis intervention and ACTIVE session/target truth, with input unavailable and an
application cleanup error. System cleanup failure never produces `STOPPED_BY_USER`;
only explicit End or page teardown ends that retained failed STEP session.
PREPARING failures, temporary mute
recovery and physical source/AudioContext/capture infrastructure classification remain
unchanged. Final STEP scope completion never arms another physical/acoustic attempt:
domain rearm commits the final verdict, then the controller completes naturally before
any input arm. Non-final MATCH arms the next target; MISMATCH rearms the current target.
Normal completion wins late failure. STEP domain/version/attempt schema
contains no application intervention field.

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
repository source. Repairing stale implementation attestations mechanically updates
the core hash and source-adapter composite hashes; it does not change recognition
behavior, the model asset, identityName, or the schema-6 Result shape.

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
       [future optional calibration]
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
must have the target pitch, exact timing offset and local assignment-window eligibility.
Every child strike shares its parent group's canonical onset. Each observation is
owned exactly once by an exact same-pitch strike match or an unattributed relation;
non-target evidence is never substituted into a target slot. This boundary never
reruns an optimizer or reassigns evidence, and never repairs, migrates or normalizes
caller data.
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
Same-pitch cohort coverage has a derived 3W safety invariant: the direct cohort
extends at most 2W from its anchor, then requires W more coverage. W is the current
assignment window, not an independent frontier tuning parameter. Acoustic 170ms
future context remains model lookahead, never an event timestamp subtraction.
Model windows and decoder thresholds are unchanged.

Non-zero input timing calibration requires empirical device/runtime qualification.
Browser API latency hints alone are insufficient; baseLatency/outputLatency and
matched-note timing medians do not establish physical input latency. Any future
versioned calibration belongs at the source-specific evidence mapping boundary,
before source-blind assignment. It must shift event coordinates and safe analyzed
frontiers coherently to prevent late evidence and premature finalization. No non-zero
calibration is implemented by this contract.

A performance retains three distinct layers: immutable evidence truth,
source-blind assignment truth and source-bound evidence provenance.
MIDI publishes each physical NOTE_ON independently; its 250ms delivery grace is a
coverage-publication policy. Microphone observations describe decoder-qualified
acoustic evidence, not proof of physical key attacks.

MIDI coverage progression is explicit: session/clock snapshots and evaluation reads
never publish evidence or finalize assignment. The application heartbeat calls
`advanceToNow()` before sampling presentation; its frequency is not evidence policy.
The assignment finalizer exposes its next useful analysis frontier using the same
direct same-pitch target/claimant dependencies as live finalization. The score-blind MIDI
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

Same-pitch assignment uses the unchanged inclusive +/-250ms eligibility window.
`CONTINUOUS_EXACT_PITCH_ORDERED_ASSIGNMENT_FINALITY_V4` defines three objectives:
maximize cardinality, minimize total absolute timing error, then choose the
lexicographically earliest chronological non-crossing pair sequence.

Targets sort by expected Performance Time, then existing canonical score order only
when time is identical, with strike identity as the final corruption-safe fallback.
Events sort by Performance Time, then observation identity only for identical times.
Different-onset target colors never depend on opaque target identity. At 1000/1300ms
with one event at 1150ms, the earlier unresolved target wins, regardless of IDs.
This FIFO convention is deterministic product policy, not learner-accuracy evidence.

The domain-specific same-pitch solver uses scalar suffix cardinality/cost tables
and chronological reconstruction, with O(targets * events) space/time per cohort.
No DP cell retains a growing pair list; costs use structured comparison, without
epsilon or artificial numeric weighting. The generic residual-graph/Bellman-Ford
matcher is absent from production. Overlapping eligibility remains: targets
1000/1250ms with events 1100/1110ms both match, as do events 800/1100ms. Nearest
per-target greedy and midpoint clipping do not preserve these objectives.

W=250ms remains an unqualified algorithm-policy parameter. The common-radius
non-crossing proof works for any radius, not specifically 250ms. Round 16 selected
no replacement tolerance; V4 changes only cohort solver/equal-objective ownership.
It is not timing-tolerance validation and does not claim improved learner accuracy.
Note duration / notation end is not an attack acceptance deadline. Beat/IOI-relative
acceptance, midpoint ownership and device/learner qualification are not adopted.

Canonical chord strikes share one onset. Direct same-pitch cohorts are literal
interval neighbors within 2W, not recursively expanded graph components. A strike
waits for its direct cohort's latest expected onset plus W; the maximum additional
coverage is mathematically 3W. There are no independent group/residual timing
parameters. A group finalizes once all child strikes are finalized, with the maximum
of their required frontiers. Unattributed evidence waits only for its possible
same-pitch target claimants; unrelated pitches never extend a group's decision.

Raw strikes are PENDING, MATCHED, UNMATCHED or NOT_REACHED. MATCHED retains the
same-pitch observation and signed timing offset. UNMATCHED means no same-pitch
observation was allocated with healthy completed coverage. Groups carry strike
assignments and finality, without target substitution slots.

Every accepted observation is retained and has exactly one completed relation:
STRIKE_MATCH names its exact-pitch target, or UNATTRIBUTED has no target owner.
For target C4+D4 and observed C4+E4, C4 is MATCHED, D4 is UNMATCHED, C4's observation
is STRIKE_MATCH and E4 is UNATTRIBUTED. No D4-to-E4 ownership is invented. Completed
validation is strict current-shape only, checks local pitch/window/offset semantics,
exact ledger/owner agreement and finality causality without rerunning assignment.
Natural completion has no pending targets or unresolved same-pitch reservations.

### Continuous evaluation scale

Continuous retains all accepted evidence required by the completed result, including
provenance and extra/unattributed observations. Internal time/pitch indexes, explicit
unowned working sets and local ordered same-pitch matching restrict ordinary assignment
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

No new Continuous evaluation capacity ceiling is frozen without qualification
evidence. Future emergency limits must be justified by measured workload/device
headroom and must never silently truncate evaluation truth. This round introduces
no replacement count, length, memory heuristic or environment-configured ceiling.
Existing acoustic resource constants are unchanged and require their own audit.

The research-only `npm run benchmark:practice-evaluation-scale` runs the real
finalizer at 100/500/1,000/5,000 strikes with incremental publications, repeated
pitches, chords, exact matches and non-target/unattributed evidence. These workloads are
engineering characterization, not product capacity limits. JSON reports default
to ignored `artifacts/practice-evaluation-scale/`; `-- --output "<path>"` selects a
local output. Wall-clock is local engineering evidence, not a qualification
threshold, CI timing assertion or learner metric. Pathological dense graphs can
still require many legal edges; this does not justify inventing a ceiling here.

STEP multi-hour soak is not part of this round. Continuous recording chunk growth
is not part of this round.

### Canonical target truth

Continuous has one source-blind target state vocabulary: PENDING, MATCHED,
UNMATCHED and NOT_REACHED. There is no persisted interpretation tree or group
performance verdict. Groups organize score targets and assignment/finality; they do
not classify learner outcomes.

MATCHED means the current assignment policy found a unique accepted observation
with the exact target pitch inside its legal time window. UNMATCHED means healthy
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
PENDING and NOT_REACHED are untouched. UNAVAILABLE means trustworthy analysis could
not complete and never fabricates negative target colors. User abandonment still
produces no learner Result. UNAVAILABLE also covers an admitted Continuous microphone
attempt whose analysis became unavailable under the explicit Analysis Failure
Intervention contract below.

### Live feedback and Review

Continuous Review is replay-first, not a statistics dashboard. No learner-facing
aggregate performance metrics artifact exists. Review keeps synchronized replay,
score/playhead, completed annotations, useful metadata and recording/save/share
and retry/back actions; it does not display outcome/extra counts or replacement
percentages, grades or scores.

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
6: local session and score/revision/artifact identities, resolved scope, tempo plan,
input source, active performance duration, completed evaluation, evidence
provenance and ISO UTC completion time. The result is pure, deeply immutable and
JSON-serializable. It contains no recording or browser-media resource. STEP creates
no result artifact, metrics or performance report.

The completion transaction creates the result from the canonical artifact and
resolved scope. COMPLETE evaluation has exactly status, inputSource, assignmentPolicyId and
assignment. UNAVAILABLE has exactly status, inputSource, assignmentPolicyId and
reason, without inventing empty analysis.
Validation rejects mismatched session/source identities, corrupt assignment and
unsupported provenance. It never repairs
or upgrades an artifact. JSON round-trip preserves these semantic checks.
Both Result creation and parsed Result validation require SCOPE_COMPLETED for a
COMPLETE evaluation. Generic assignment/evaluation may still retain STOPPED_BY_USER
for internal diagnostics; that does not make it eligible for a learner Result.

Result validation accepts schema 6 exact fields only. Schemas 2/3/4/5, V3 assignment policy, retired
interpretation fields/policies, extra unknown fields and a metrics field are rejected without migration, normalization, compatibility or repair.
A score revision mismatch does not alter retained evaluation, input, scope, tempo
or active duration. Score annotations, playhead and share-score rendering require
confirmed artifact identity independently of recording replay.

## Evaluation / Evidence Provenance

Completed evaluation and diagnostic full snapshots retain assignmentPolicyId.
`CONTINUOUS_EXACT_PITCH_ORDERED_ASSIGNMENT_FINALITY_V4` covers same-pitch
+/-250ms eligibility, maximum cardinality then minimum absolute timing error,
chronological non-crossing ties, exact match/unattributed ownership, direct-cohort target frontiers,
child-dependent group finality and terminal clamps. Finalization availability uses
Session Time; expected/event/frontier positions use Performance Time. There is no
independent interpretation algorithm or interpretation policy identity. Validation
checks exact assignment truth and source consistency without repair or reassignment.

MIDI evidence declares
`MIDI_NOTE_ON_SESSION_TIME_WITH_250MS_COVERAGE_GRACE_V2`: physical NOTE_ON facts,
session-time capture, one observation per NOTE_ON, 250ms publication-coverage grace
and exact terminal coverage. V2 corrects availability to Session Time; native NOTE_ON
event mapping and 250ms coverage behavior remain unchanged. The evidence owner supplies this identity.

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
remains live, becomes unmuted, and the same MediaRecorder remains usable. Original
track unmute/ended and recorder events update health passively. There is no manual
Check Device action. Recovery only exposes Continue; it never resumes automatically.
Ended tracks, recorder errors, pause/resume/start failures and unusable pipelines
allow explicit continuation without recording only when performance is safe; otherwise End is required. No new recorder or stream
is spliced into the current artifact.

Resource impact is explicit: RECORDING_ONLY, INPUT_REQUIRED or INPUT_AND_RECORDING.
A recorder-owned clone fault with healthy input, or recording loss with healthy MIDI,
can offer Continue without recording while interruption is unresolved. Recovered
recording offers only Resume or End, preserving the now-recoverable intent. Root microphone mute and temporary AudioContext
interruption pause canonical transport and wait for the same input/capture pipeline to
recover. Continuous capture explicitly retains its existing graph across temporary
context suspension; closure or invalid chronology still invalidates it. STEP temporary
root mute cancels unfinished input, preserves target/progress and automatically returns
to waiting on same-root recovery. Its recovery commits a fresh physical capture
watermark before rearming, excluding delayed or partial evidence. STEP terminal
root/context/capture failure instead retains the active session and target behind its
End-only infrastructure intervention. Unusable resources are released immediately;
only End or page teardown ends domain/application truth. The controller never stops
or reacquires the borrowed root. STEP terminal infrastructure or analysis End latches
a page-local requirement for Setup: no in-place Continue Practice remains, even if the
outer root is still healthy. Returning to Setup has no environment side effects; its
explicit Prepare performs fresh qualification before a fresh Practice entry/session. Ordinary healthy
learner End still offers Continue Practice. Initial page-entry auto-arm remains distinct.
Terminal analysis failure has its separate End-only intervention. Context/capture/analysis
failure remains owned by the Attempt or engine, without generic Environment invalidation.
Continuous required-input root ended, context closure and invalid capture offer End only. Required
input loss never offers recording-only degradation. Shared-source callbacks converge
on one intervention, with input-required impact taking priority and one canonical pause.
MIDI disconnection retains its existing pause/reconnect contract and cannot accept
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
natural evaluation is the existing exact UNAVAILABLE shape with reason
`CONTINUOUS_ANALYSIS_UNAVAILABLE`, never partial COMPLETE truth. Result schema remains
6 and V4 assignment provenance remains unchanged. Healthy media finalizes normally;
Review retains replay/save/share and its unavailable notice without target colors.

Acoustic analysis release neither closes the controller AudioContext nor stops the
borrowed root stream, metronome or recorder. Source-track health observation is
irreversibly released with analysis; AudioContext health observation stays active
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
unexplained gaps, and nominal duration matching the final media end. Existing
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
without learner report statistics or historical report navigation.

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
cursor dimensions, staff mapping, colors and scroll thresholds remain fixed.

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
