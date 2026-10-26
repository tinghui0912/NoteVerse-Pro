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
keeps the current attempt in Practice while the user decides. STEP has no empty settings
sheet. Continuous Live Feedback uses a labelled, keyboard-accessible Switch in Practice,
not Setup. It only changes current score feedback visibility: readiness, session identity,
inference, evaluation, Review and Share Video remain unchanged. The preference persists
with the profile and defaults to OFF.

## Practice Readiness

`readiness/` derives requirements purely from the complete configuration. Live
readiness is UNCONFIGURED, CHECKING, READY or BLOCKED, with component diagnostics
and download progress. Its fingerprint represents the effective requirement set,
so equivalent configurations share qualification; unrelated presentation changes
do not invalidate it. Readiness is never persisted.

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
the selected requirements are satisfied, preserving revision identity. Idle settings
can change high-impact configuration and expose Prepare when needed; active sessions
lock those choices. Full reload restores preferences, not readiness or GPU memory.
Setup success does not promise immutable permissions: Start reacquires fresh device
resources and fails closed on device/permission loss without cold model bootstrap.

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
streams, AudioContexts, recorder and lease while retaining the healthy warm engine.
Natural completion and abandonment retain their distinct contracts below.

Persistent state consists only of user preferences and the existing verified OPFS
model asset. Readiness, warm engine, tempo/metronome/scope and current completion
are browser memory; capture, clocks, evaluation and recorder are session resources.
Practice Results/reports remain transient and are never persisted.

Live note feedback is a presentation preference, mutable during ACTIVE/PAUSED.
OFF removes live supported/wrong/missed decorations while retaining score, range
and playhead. Evaluation, interpretation, metrics and natural Result production
continue unchanged. ON/OFF does not restart a session or engine. Review always
shows completed feedback; Share Video always uses its clean-score contract.

## Domain Ownership

`src/lib/practice/kernel/` owns the pure, cross-mode artifact contract, canonical
scope, count-in, tempo, session timebase and common session identity/completion
metadata. It depends on neither mode, acoustic implementation nor browser resources.
Artifact validation and access stay in `artifact.ts`; scope and count-in policy have
their own modules. Renderer note IDs are projected by `score-view/cursor-scope.ts`.

`step/domain/` owns pitch evidence, exact target comparison, target progression and STEP snapshots.
`continuous/domain/` owns performance clock/timeline mapping, session composition
and Continuous snapshots. Its `evaluation/` separates immutable evidence,
source-blind assignment/finality, and source-specific interpretation. The evaluation
session composes these layers; `result/continuous-performance-metrics.ts` projects versioned learner-facing
counts from interpretation. The two mode domains do not
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
MISMATCH; runtime schema 8 (`step-exact-pitch-learning-v8`) defines this contract.

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

Physical input captured while an answer is busy is retired, never queued or deferred
to the next target. The physical frontier may be ahead of the analysis frontier;
domain rearm followed synchronously by microphone arm shares that capture watermark.
Only a source event strictly after it can open another attempt, including when a
publication arrives late. Retirement prevents already captured or delayed evidence
from crossing attempt boundaries. It does not assert that future acoustic observations
after the watermark represent a fresh physical key attack. Sustain/resonance may
require evidence-based onset/activity/release policy; no cooldown or silence gate
is part of this contract.


The controller owns the root microphone stream and session AudioContext; the input
borrows them and owns its analysis clone, capture bridge, assembler and Worker graph.
Finish/dispose await resource release; restart constructs a fresh controller after
cleanup. MIDI disconnection cancels unfinished input and retains the same target
and MIDIAccess owner; reconnection establishes a fresh eligibility boundary.
Microphone infrastructure or analysis failure is terminal. Unfinished attempts are
cancelled without fabricated verdicts.

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
no performance evidence. Resume begins a distinct source/performance segment.
Source ranges are half-open and source sample identity remains chronological.

The controller owns one root microphone stream. Analysis and recorder use independent
clones. Metronome borrows the session context. Final controller cleanup stops the
root and closes the context; each consumer releases only its own resources.

## Acoustic Foundation

`practice/acoustic/{model,source,runtime}` is score-blind. It consumes PCM and
source-domain analysis regions and publishes immutable physical observations.
Expected score enters only the product-domain evaluator. One capture stream uses
one model session; raw tensors remain inside the inference transaction.

The model is `practice-acoustic-robust-browser@v1`, delivered through
`/model-assets/practice-acoustic-robust-browser-v1/access`. The acoustic README
records its byte size, SHA256, decoder and resource bounds. Source adapters accept
44.1kHz and 48kHz. Window inputs require real context; missing PCM is not padded.
Input regions include overlapping context, while acoustic owned regions authorize
observation publication. Window width does not define assignment finalization.

`practice/acoustic/continuous` projects source observations into performance time
and publishes `ContinuousEvidencePublication` through the session. Paused context
does not extend performance duration or evaluation coverage. At pause T coverage
remains below T. Natural completion drains real tail context and outstanding
analysis, then publishes empty exact-T coverage for the completed `[0,T)` domain.

## Continuous Evidence, Assignment and Interpretation

A performance retains three distinct layers: immutable evidence truth,
source-blind assignment truth, and source-specific product interpretation.
MIDI publishes each physical NOTE_ON independently; its 250ms delivery grace is a
coverage-publication policy. Microphone observations describe decoder-qualified
acoustic evidence, not proof of physical key attacks.

Publications carry immutable publication/observation identity, session domain,
source provenance, confidence, availability time and monotonic analyzed-through
coverage. Availability is not attack time. Exact replay is idempotent; mutated
identities and genuinely new evidence at or before declared coverage fail closed.
The evaluation session rejects observations whose source disagrees with its input:
MIDI sessions accept MIDI observations, and microphone sessions accept ACOUSTIC
observations.

### Source-blind assignment

Same-pitch assignment uses an inclusive +/-250ms window, maximizes cardinality,
then minimizes absolute timing error with stable identity ties. Canonical chord
strikes share their expected group's time. Direct-claimant reservations are
reversible and do not recursively expand. Strike, group and residual analysis
frontiers are bounded by +750/+1250/+1500ms respectively; these are coverage bounds,
not wall-clock latency guarantees.

Raw strike states are PENDING, MATCHED, UNMATCHED and NOT_REACHED. MATCHED means an
exact-pitch observation was allocated within the legal window. UNMATCHED means no
observation was allocated under the completed coverage and assignment policy;
it does not claim that the learner missed a note. Groups are PENDING or FINALIZED,
with strike assignments, residual relations and finality metadata, without a
product verdict.

Each observation has at most one tagged assignment: STRIKE_MATCH names a strike,
GROUP_RESIDUAL names a nearby group and a specific unmatched strike slot, and UNATTRIBUTED has
no strike/group owner. Residual slots are formed only for unmatched strikes;
incompatible-pitch observations within the group window are assigned globally and
deterministically. Unattributed observations wait until all legal strike and group
opportunities finalize. A completed assignment has no pending strikes/groups,
reserved observations or observations without an assignment. These relations are
bookkeeping, not an account of learner mistakes. Each group residual relation retains
its strike ID, immutable observation and signed timing offset computed at assignment.
The flat observation relation identifies the same group/strike slot. A slot can
receive at most one residual observation; completed-artifact validation requires
both relation views and the complete evidence ledger to agree.

### Source-specific feedback

The session fixes interpretation policy from its input source. Interpretation is
an immutable pure projection of the accumulated assignment; it does not assign
evidence again or recalculate timing.

MIDI uses `MIDI_PHYSICAL_NOTE_EVENTS_V1`. Physical NOTE_ON events support stronger
pedagogical feedback. Matched targets are CORRECT. An unmatched target with a
residual relation to its strike slot is WRONG, retaining the played observation
and assigned timing offset so feedback can state expected D4 / played E4. An
unmatched target without such a relation is MISSING. NOT_REACHED retains transport
meaning. Every target has exactly one outcome:

`Target = Correct + Wrong + Missing + Not Reached`.

Final group feedback is derived from those target outcomes: NOT_REACHED if any
is not reached, CORRECT if all are correct, WRONG if any is wrong, INCOMPLETE_CHORD
if some are correct, and MISSING otherwise. There is no separate group-level wrong
observation list. Interpretation reads assigned timing; it does not calculate it.

Only raw UNATTRIBUTED events become MIDI extra notes. They form a separate
additional-playing metric, outside the target denominator. For target C4+D4 and
played C4+E4, the target outcomes are correct 1 / wrong 1 / missing 0 / not reached 0,
with extra notes 0. The residual slot is an assignment fact; the stronger target
meaning belongs only to MIDI interpretation.

Microphone uses `ACOUSTIC_CONSERVATIVE_SUPPORT_V1`. Matched targets are SUPPORTED;
unmatched targets are UNCONFIRMED. Group feedback is NOT_REACHED if any target was
not reached, SUPPORTED if all matched, PARTIALLY_SUPPORTED if some matched, and
UNCONFIRMED otherwise. Acoustic residual/unattributed detections remain raw
diagnostics and never become learner-facing wrong/extra notes. Conservative
acoustic V1 interprets decoder-qualified observations without adding a second,
uncalibrated confidence threshold; confidence and provenance remain in the ledger.
Residual strike-slot identity does not enter acoustic learner errors. Its target
partition is `Target = Supported + Unconfirmed + Not Reached`.

NOT_REACHED retains assignment coverage semantics within a natural result. User
abandonment does not project targets into a partial report. UNCONFIRMED means completed analysis did not support a target;
UNAVAILABLE instead means trustworthy analysis could not complete. Unavailable
evaluations carry input source, assignmentPolicyId, interpretationPolicyId and reason,
without dummy assignments.

### Live feedback and Review

Live feedback and score annotations consume interpretation. Review presents the
metrics retained in the immutable completed result, without recomputing them from
the currently opened score artifact.
MIDI Review groups correct/wrong/missed/not-reached target counts together,
with extra notes in a separate additional-playing section. Microphone Review reports supported/unconfirmed target counts and does
not count residual detections as learner errors. Supported targets are green;
MIDI WRONG targets are red and MISSING targets have a separate neutral missed
annotation. Acoustic unconfirmed and not-reached targets remain neutral. Production
consumers receive the evaluation session's bound interpretation; only evaluation
composition imports the interpreter. There is no overall accuracy percentage or
aggregate score in this contract.

Completed performances retain both the full raw assignment/evidence ledger and
its deterministic interpretation for diagnostics, future calibration and analytics.
There is no independent mutable feedback truth or second offline evaluation pass.
Natural SCOPE_COMPLETED enters application FINALIZING until tail analysis and recording
finish. Completion projects the same ledger and drains unfinished work without a
second evaluation pass. End during count-in discards the session without a result.

Analysis failure with healthy infrastructure stops analysis resources while clock,
playhead, metronome and recording continue. Preparation failure never starts
transport. Root track loss/mute or unexpected AudioContext interruption terminates
the session, withholds completed truth and releases owned resources. Listeners are
detached before intentional cleanup. Cleanup failure is terminal failure; each
owned release is attempted once. Product errors are localized; bounded diagnostics
retain causal metadata separately from observations and user recordings.

## Continuous Result Artifact

`result/continuous-performance-result.ts` owns `ContinuousPerformanceResult`, schema
1: local session and score/revision/artifact identities, resolved scope, tempo plan,
input source, active performance duration, completed evaluation, metrics, evidence
provenance and ISO UTC completion time. The result is pure, deeply immutable and
JSON-serializable. It contains no recording or browser-media resource. STEP creates
no result artifact, metrics or performance report.

The completion transaction creates the result from the canonical artifact and
resolved scope. COMPLETE evaluation retains assignment and interpretation; UNAVAILABLE
retains its reason and both policy identities, without inventing empty analysis.
Validation rejects mismatched session/source identities, corrupt assignment or
interpretation, inconsistent metrics and unsupported provenance. It never repairs
or upgrades an artifact. JSON round-trip preserves these semantic checks.

## Metrics

`result/continuous-performance-metrics.ts` owns `CONTINUOUS_PRODUCT_METRICS_V1`.
Metrics are a deterministic projection of the session-bound interpretation, not of
raw assignment. The result factory derives them rather than accepting an independent
caller-supplied aggregate. Stored metrics are validated against that projection.

MIDI target counts partition as Correct + Wrong + Missing + Not Reached; extra
notes are a separate played-event metric. Microphone counts partition as Supported
+ Unconfirmed + Not Reached, without wrong/extra learner counts. UNAVAILABLE metrics
retain the canonical scoped target count and reason, without fabricated zero outcomes.
No overall accuracy, timing grade, weighted score or telemetry transport is defined.

Review reads `completion.result.metrics`. A current score revision mismatch does
not alter the completed metrics, input, scope, tempo or active duration. Annotations,
SVG playhead placement and share-score rendering require confirmed artifact identity
and fail closed independently of aggregate presentation.

## Evaluation / Evidence Provenance

Every live/completed evaluation declares `assignmentPolicyId` and
`interpretationPolicyId`. `CONTINUOUS_EXACT_PITCH_ASSIGNMENT_FINALITY_V1` covers
same-pitch ±250ms eligibility, maximum cardinality then minimum absolute timing
error, stable deterministic ties, residual assignment, one-observation ownership,
+750/+1250/+1500ms finality bounds and terminal clamps. Any semantic change to
these rules requires an assignment-policy version change. Interpretation identity
is fixed by session source: `MIDI_PHYSICAL_NOTE_EVENTS_V1` or
`ACOUSTIC_CONSERVATIVE_SUPPORT_V1`. Validation checks both identities and that
interpretation is the pure assignment projection, without a second assignment pass.

MIDI evidence declares
`MIDI_NOTE_ON_SESSION_TIME_WITH_250MS_COVERAGE_GRACE_V1`: physical NOTE_ON facts,
session-time capture, one observation per NOTE_ON, 250ms publication-coverage grace
and exact terminal coverage. The evidence owner supplies this identity.

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
owned resources and inference lease, preserves recording intent, invalidates current
readiness and offers explicit Prepare. It creates no Result, dialog or recording
artifact, and does not classify recording faults as acoustic-analysis faults.
Setup success does not promise immutable permissions; Start only reacquires/checks
its fresh session resources and never repeats cold model preparation.

Post-start recording faults are actively published once per unresolved incident by
`PerformanceRecorder`, independently of input and acoustic-analysis errors. The
Continuous controller pauses its canonical transport, metronome and evidence
chronology and exposes a dedicated recording intervention. Performance time and
finality cannot advance beyond that pause boundary while the user decides.

A temporary muted track is recoverable only while every required track remains live
and becomes unmuted and the same MediaRecorder remains usable. Checking health never
resumes automatically. Explicit check-and-continue resumes that pipeline and Practice
at the same performance time. Ended tracks, recorder errors and unusable pipelines
require restart or explicit continuation without recording. No new recorder/stream
is spliced into the current artifact. Duplicate browser events do not create duplicate
interventions; a hard failure can invalidate recovery of an unresolved mute.

Continue without recording accepts degradation for this attempt, preserves the original
fault reason and persistent AUDIO/VIDEO preference, then resumes an intervention-owned
pause. A pre-existing user pause remains paused until the user resumes. Restart abandons
the old attempt and discards all media, then uses fresh recording admission and session
resources while retaining the warm acoustic engine and workspace options. End abandons
without any result. A latched natural completion wins late recorder callbacks.

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
interpretation, metrics or implementation provenance. Review Save Recording is an
explicit user action that reads only a READY recording and archive metadata.
Completion, Review mount and Review exit never create a PerformanceTake.

## Transient Completion Handoff

`continuous/completion.ts` composes `{ result, recording }` without flattening either
artifact. The controller terminates transport, freezes recording, drains acoustic
tail work, finalizes evaluation/media, creates the result and completes resource
cleanup before publishing the atomic completion and notifying completion listeners.
The store validates both artifacts and publishes neither half independently.

Analysis-unavailable can coexist with READY recording; complete evaluation/metrics
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
releases input, metronome, Worker, streams and AudioContext ownership. It discards
unfinished session state and recording chunks without draining the acoustic tail,
finalizing a recording or creating result/metrics/completion handoff. No dialog or
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

Review annotations remain ephemeral presentation of result.evaluation: MIDI correct
is supported/green, wrong is red, missed is neutral; microphone supported is green
and unconfirmed remains neutral. Share Video contains a clean musical score and its
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
retained result metrics, tempo, input, duration or scope metadata. review-replay.ts
projects READY media and delegates synchronization to the recording timebase;
review-view-model.ts reads result.metrics directly, without evaluating evidence.
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
