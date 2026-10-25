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
and Continuous snapshots. Its `evaluation/` owns assignment, observations,
finalization and the completed evaluation projection. The two mode domains do not
depend on one another. Consumers import concrete owner modules directly.

Continuous session accepts a clock-evidence port. `continuous/input/midi-evidence.ts`
implements MIDI observation identity, delivery-grace coverage and terminal coverage;
the application controller supplies it. Terminal evidence is published before the
evaluator completes. Acoustic publications enter through the separate validated
analysis-publication boundary.

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
observation publication. Window width does not define verdict finalization.

`practice/acoustic/continuous` projects source observations into performance time
and publishes `ContinuousEvidencePublication` through the session. Paused context
does not extend performance duration or evaluation coverage. At pause T coverage
remains below T. Stop/natural completion drains real tail context and outstanding
analysis, then publishes empty exact-T coverage for the completed `[0,T)` domain.

## Continuous Evaluation Truth

A performance has one accumulated evaluation truth. MIDI publishes each NOTE_ON
independently. Its 250ms delivery grace is a coverage-publication policy. MIDI and
microphone publications feed the same deterministic evaluator.

Publications carry immutable publication/observation identity, session domain,
availability time and monotonic analyzed-through coverage. Availability is not
attack time. Exact replay is idempotent; mutated identities and genuinely new
evidence at or before declared coverage fail closed.

Same-pitch assignment uses an inclusive +/-250ms window, maximizes cardinality,
then minimizes absolute timing error with stable identity ties. Each observation
has one semantic owner. Canonical chord strikes share their expected group's time.
Direct-claimant reservations are reversible and do not recursively expand. Strike,
group and EXTRA analysis frontiers are bounded by +750/+1250/+1500ms respectively;
these are coverage bounds, not wall-clock latency guarantees.

Strike states are PENDING, MATCHED, MISSING and NOT_REACHED. Group verdicts are
PENDING, CORRECT, MISSING, WRONG, INCOMPLETE_CHORD and NOT_REACHED. WRONG requires
missing strikes and legally assigned incompatible evidence. Without WRONG evidence,
no matches means MISSING; partial multi-strike matches mean INCOMPLETE_CHORD.
Manual-stop targets outside complete legal coverage are NOT_REACHED. Missing
analysis coverage yields UNAVAILABLE evaluation.

Finalized results are immutable and power both delayed live feedback and Review.
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
