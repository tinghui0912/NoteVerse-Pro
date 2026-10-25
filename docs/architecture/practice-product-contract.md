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
is independent of these acoustic prerequisites. Detection is side-effect-free;
permission, device acquisition and model loading occur during session preparation.

Recording and input source are orthogonal. User-selected audio or video recording
is a review artifact. Analysis capture supplies PCM directly to the acoustic runtime.
MediaRecorder output is not the analysis PCM source. Generic application realtime
notifications invalidate application data independently of Practice execution.

## Domain Ownership

`src/lib/practice/kernel/` owns the pure, cross-mode artifact contract, canonical
scope, count-in, tempo, session timebase and common session identity/completion
metadata. It depends on neither mode, acoustic implementation nor browser resources.
Artifact validation and access stay in `artifact.ts`; scope and count-in policy have
their own modules. Renderer note IDs are projected by `score-view/cursor-scope.ts`.

`step/domain/` owns attempts, verdict policy, target progression and STEP snapshots.
`continuous/domain/` owns performance clock/timeline mapping, session composition
and Continuous snapshots. Its `evaluation/` separates immutable evidence,
source-blind assignment/finality, and source-specific interpretation. The evaluation
session composes these layers; `continuous/review-summary.ts` projects learner-facing
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

STEP is correctness-driven and waits for user input. `StepPracticeController` owns
the application lifecycle, selected input, metronome, cancellation and cleanup.
React subscribes to snapshots and sends commands. STEP has no performance clock
or Pause/Resume lifecycle. Its elapsed presentation time does not drive progression.

`StepPracticeRuntime` owns one target, one bounded attempt and one verdict:

```text
READY -> CAPTURING -> ANALYZING -> POST_VERDICT -> READY / scope completion
```

The domain compares physical attack pitches, excluding continuation pitches.
Exact pitch sets yield MATCH. MIDI uses exact-set evaluation: any other set yields
MISMATCH. Microphone evaluation yields RETRY/UNCERTAIN when all expected pitches
are present with additional pitches; other non-exact sets yield MISMATCH. Explicit
retry evidence produces RETRY with its reason. TOO_QUIET classification is not
implemented by the microphone input.

Finalization records an immutable result and preserves the answered target in
POST_VERDICT. Explicit rearm commits MATCH progression once; MISMATCH and RETRY
stay on the target. A final MATCH completes the scope at rearm. Skip is a separate
READY-only action. Full attempt/Skip history has a 100,000-record ceiling and fails
explicitly before accepting another record.

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
remains below T. Stop/natural completion drains real tail context and outstanding
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

Manual-stop targets outside complete legal coverage are NOT_REACHED for both
sources. UNCONFIRMED means completed analysis did not support a target;
UNAVAILABLE instead means trustworthy analysis could not complete. Unavailable
results carry input source, policy identity and reason, without dummy assignments.

### Live feedback and Review

Live feedback, Review summaries and score annotations consume interpretation.
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
Transport ENDED enters application FINALIZING until tail analysis and recording
finish. Completion projects the same ledger; it drains unfinished work only. A
zero-duration count-in Stop publishes empty zero-domain terminal coverage without
inventing model input.

Analysis failure with healthy infrastructure stops analysis resources while clock,
playhead, metronome and recording continue. Preparation failure never starts
transport. Root track loss/mute or unexpected AudioContext interruption terminates
the session, withholds completed truth and releases owned resources. Listeners are
detached before intentional cleanup. Cleanup failure is terminal failure; each
owned release is attempted once. Product errors are localized; bounded diagnostics
retain causal metadata separately from observations and user recordings.
