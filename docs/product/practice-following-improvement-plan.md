# Practice Following Improvement Plan

Last updated: 2026-08-31

## Current Decision

The Practice product exposes two user-facing practice modes in Customer Web:

```text
STEP_BY_STEP
CONTINUOUS_PLAY
```

`STEP_BY_STEP` is wait-for-note guided practice. The visible score position is
the next expected playable group. Microphone and MIDI input are supported.

`CONTINUOUS + PERFORMANCE` must not be implemented as free-speed score
following, Matchmaker-driven cursor movement, or `FOLLOW_PERFORMER`. Continuous
performance is the fixed-clock product preset:

```text
CONTINUOUS_PLAY
-> backend canonical runtime config
-> PerformanceTimeline / ResolvedPerformanceScope
-> PerformanceClock owns visible musical position and completion
-> microphone/MIDI observations share the clock timebase as evaluation evidence
-> PerformanceResult is replay-first: immediate local replay first, saved ReplayArtifact only after user action
```

Backend service validation accepts `CONTINUOUS_PLAY` only through the canonical
fixed-clock preset projection. Customer Web exposes this as a product mode,
while browser end-to-end lifecycle coverage remains the next required hardening
step.

`CONTINUOUS_PLAY` is a core product mode, but its first durable user value is
synchronized replay: the user should be able to review what was just played
while the score playhead follows the fixed clock. Evaluation is second, and
scoring is last. The long-term result boundary is:

```text
PerformanceResult
-> PlayablePerformanceReplay       // transient just-finished replay or downloaded saved replay
-> SavedReplayArtifact?            // durable only after explicit user save
-> EvaluationArtifact?            // inferential, evidence-gated
```

`SavedReplayArtifact` must not be created automatically just because the product
captured usable audio or MIDI. Default Performance completion creates a durable
`PracticeSession` and `SessionSummary`, while audio/MIDI replay remains local and
ephemeral unless the user explicitly chooses "Save performance". MIDI and
microphone follow the same user-facing rule: immediate replay is available after
Performance completion, durable replay exists only after explicit save. Storage
implementation is unified at the product boundary:

```text
SavedReplayArtifact
-> durable DB metadata for a user-saved performance

Replay payload
-> immutable object-storage object
```

Do not store MIDI replay payloads in the database. MIDI and microphone payloads
both use object storage; the object content format differs by kind.

The durable replay data plane should be object-storage direct, not proxied
through the application server:

```text
Save:
Customer Web -> backend upload authorization
Customer Web -> object storage PUT
Customer Web -> backend finalize
backend -> validate object metadata
backend -> INSERT SavedReplayArtifact

Playback:
Customer Web -> backend playback authorization
backend -> short-lived signed GET URL
Customer Web -> object storage/CDN
```

The upload authorization is not a `SavedReplayArtifact` and does not need
`PENDING`, `FAILED`, or `EXPIRED` artifact states. A `SavedReplayArtifact` row
still means the object already exists and is playable. Finalize must be
idempotent by backend-issued `artifact_uuid`: retrying the same finalize returns
the existing artifact for the same session/object identity instead of creating a
duplicate. Object cleanup for abandoned upload authorizations is an operational
garbage-collection concern, not a business artifact state.

`EvaluationArtifact` should exist only when evidence quality is high enough to
support the claims shown in the UI. Weak microphone evidence may still be useful
for internal diagnostics, but it must not become exact accuracy, exact
wrong-note counts, or problem-measure claims.

Saved Performance availability is a derived read-model capability, not a
`PracticeSession` lifecycle state and not a persisted boolean on the session. A
`PracticeSession` may be kept permanently for future aggregate history while
still having no user-facing saved-performance entry. V1 uses explicit save as
the user's archive intent:

```text
PracticeSession
= backend practice fact
= may support future aggregate practice counts, durations, and trends

Current Performance Report
= immediate post-performance review flow
= may use browser-local transient replay

Saved Performance
= user explicitly saved replay
= durable user-facing archive entry
```

Historical saved-performance entry eligibility is therefore concrete and
artifact-driven:

```text
saved replay artifact exists
→ saved performance entry exists
```

Do not expose a second `saved_performance_available` alias alongside
`saved_replay_available`; the duplicate name suggests a separate product
decision when the durable archive is in fact driven by the saved replay
artifact itself.

`evaluation_available` may enrich a Saved Performance with score annotations and
problem facts, but it must not create a saved-performance archive entry by
itself. A just-finished unsaved Performance can still show an immediate Current
Performance Report while browser-local replay exists; after the user leaves that
flow, it should not appear in the long-term user archive unless the user saved
it. The `/practice/summary` route guard still protects direct URLs and enforces
that the page is Performance-only, but Score Detail should link only to saved
performances. Until a formal `EvaluationArtifact` table exists,
`evaluation_available` is computed by one central predicate over the finished
Performance summary payload. The predicate must distinguish `0` from missing
data: `missing = 0` and `extra = 0` are valid facts when there is explicit
evaluated target evidence, while an all-zero or empty payload must not imply
that analysis facts exist.

Public clients should express product intent through a practice preset, not by
assembling internal policy enums. The backend owns the canonical projection from
product intent to runtime configuration:

```text
STEP_BY_STEP
-> WAIT_FOR_NOTE
-> EVENT_DRIVEN
-> GUIDED
-> LEARNING

CONTINUOUS_PLAY
-> CONTINUOUS
-> FIXED_CLOCK
-> STATUS_ONLY
-> PERFORMANCE
```

The runtime axes are not arbitrary public combinations. A public API field should
exist only when product behavior needs clients to choose it; discovering a
conceptual axis does not automatically make it a DB column, API field, frontend
state, or URL parameter.

## Domain Invariants

- `PracticeScope.start_expected_group_id` and
  `PracticeScope.end_expected_group_id` define an inclusive playable-target
  range.
- Current selected-range UI snaps start/end to `ExpectedPracticeGroup`. It does
  not support arbitrary rest, barline, or naked-beat boundaries.
- `render_note_ids` are only a render and hit-test bridge. They must not become
  persisted scope identity.
- Practice render identity is backend-owned for the Practice page. The frontend
  must consume backend-prepared Practice MusicXML and backend target catalog ids.
- `WAIT_FOR_NOTE` completes when the final selected expected group is matched.
  It must not wait for note duration, release, pedal decay, or nominal beat end.
- `STEP_BY_STEP` may expose an explicit user skip action. Skip is a low-emphasis
  escape hatch for one current expected group, not a correctness result. It must
  advance exactly one expected group, must not be stored as `MATCH`, and must be
  counted as skipped/neutral rather than wrong.
- `STEP_BY_STEP` can have a lightweight completion surface, but it should not
  produce a user-facing performance report or score. Its durable summary is a
  terminal session snapshot and learning aid, not a formal assessment.
- A tied continuation fragment is not a new expected practice target. Any note
  event carrying `tie stop`, including middle `stop + start` fragments in a
  multi-measure tie chain, remains part of the original sounding event for
  practice-target progression.
- Mixed chords are resolved at note-fragment granularity. If one note at an
  onset is tied from a previous note while other chord notes are newly struck,
  the tied continuation is excluded from the expected target but the newly
  struck notes still form an expected practice group.
- Wrong, uncertain, or partial input may record evidence, but it must not advance
  the current expected group unless the step-by-step evaluator accepts it.
- Microphone chord detection is best-effort. A partial microphone chord may be
  accepted as learning evidence only under the explicit microphone policy; MIDI
  chord matching remains strict.
- Summary surfaces locate and explain problems. They must not create a local
  practice range from a single problem target. A target is a point; a
  `PracticeScope` is a user-selected range.
- Product presets express user intent. Backend canonical runtime configuration
  defines execution semantics. Frontend, tests, and future clients must not each
  maintain their own projection from preset to internal policy fields.
- Entering `/practice` opens a setup workspace, not a `PracticeSession`.
  Customer Web may preselect preset, scope, input source, speed, or metronome
  settings for convenience, but the backend session is created only when the
  user explicitly starts the chosen practice mode.
- Once a `PracticeSession` is created, its preset and canonical execution
  semantics are immutable. Switching practice modes later must create a new
  session, not mutate the existing one.
- Practice session detail read models must expose the canonical product preset.
  Customer Web must consume that preset directly when selecting the visual
  controller. It must not reverse-map `progression_mode`, `realtime_guidance`,
  and `evaluation_profile` into product mode.
- `CONTINUOUS_PLAY` means fixed-clock progression. Input evidence, recognition
  confidence, Matchmaker alignment, and evaluator outcomes must never pause,
  rewind, advance, or complete the fixed clock.
- The backend owns authoritative clock lifecycle. The frontend may interpolate a
  playhead locally from low-frequency clock sync messages, but it must not decide
  scope completion or session finish.
- Count-in has two separate responsibilities. The backend owns the authoritative
  `COUNT_IN -> RUNNING` transition; Customer Web may use its local monotonic
  clock only to refresh count-in presentation between backend sync messages. A
  local countdown reaching zero must not start Performance progression,
  ReplayTime, evidence time, or live playhead interpolation. Those begin only
  after an authoritative backend `RUNNING` snapshot.
- Every time-sensitive `PerformanceClock` operation must first reconcile
  time-driven transitions to its `now_ms`. The clock domain owns
  `COUNT_IN -> RUNNING` and `RUNNING -> ENDED`; public methods such as
  `snapshot()` and `pause()` must not depend on a previous caller having already
  refreshed the internal state. Pausing exactly at the initial count-in boundary
  is a `RUNNING -> PAUSED` transition; pausing after the terminal boundary must
  reconcile to `ENDED` and be rejected.
- Count-in UI should communicate preparation pulses, not wall-clock seconds and
  not timeline beat coordinates. Meter must preserve the original MusicXML
  numerator/denominator. The runtime derives the count-in duration from one
  measure in the backend Performance timeline, while the protocol exposes
  remaining display pulses so Customer Web can render `4, 3, 2, 1`-style
  preparation without deriving tempo or meter from MusicXML.
- Missing or unreadable MusicXML meter may use a clearly named 4/4 default as a
  defensive score-timeline assumption. This default must remain a missing-meter
  fallback, not an implied product rule; it may affect count-in length for
  malformed scores, so the domain model must keep the meter source explicit
  enough for future diagnostics.
- `CONTINUOUS_PLAY` resume uses the same count-in presentation contract as
  initial start, but it is a runtime preparation phase outside the core
  `PerformanceClock` progression math. While resume count-in is visible, the
  underlying clock remains paused, Performance time is frozen, local replay
  capture is stopped, and performance evidence is not recorded. The backend
  emits authoritative `COUNT_IN` sync during preparation and calls
  `PerformanceClock.resume()` only when it is ready to resume `RUNNING`.
- Fixed-clock visual interpolation must be derived from a backend-resolved
  Performance timeline projection. The frontend must not parse MusicXML tempo,
  infer tempo-map changes, or smear a selected scope across a single average
  beat velocity.
- Fixed-clock note highlighting is not the same as continuous rhythmic position.
  A note or chord may be highlighted only when the projected beat falls inside
  that playable group's musical active interval and inside the resolved scope.
  During rests, gaps, or after terminal completion, the live note highlighter
  should be empty. A future rhythmic cursor may visualize beat position
  separately, but it must not be faked by jumping to a future note or holding an
  expired previous note.
- `PerformanceTimelineProjection.segment.*PerformanceTimeMs` and
  `performance.clock_sync.performance_time_ms` share one scope-relative
  performance-time coordinate system. Projection segment times are not stretched
  by `speed_ratio`; instead, the backend clock advances `performance_time_ms` by
  `wall_elapsed_after_count_in * speed_ratio`. The frontend may apply the same
  `speed_ratio` only for short local interpolation between authoritative sync
  messages.
- Performance clock, microphone samples, MIDI events, and evaluation outcomes
  must share one session-relative monotonic timebase. Network arrival time and
  `Date.now()` are not valid timing-evaluation timestamps.
- Fixed-clock Performance timing evidence must name each coordinate explicitly:

```text
InputTime
-> device/browser monotonic input time, such as MIDI timestamp or AudioWorklet frame time

SessionActiveTime
-> active elapsed session time after count-in/pause normalization

TimelineTime
-> SessionActiveTime * speed_ratio, used to query PerformanceTimeline

MusicalBeat
-> score position resolved from TimelineTime
```

MIDI pitch/content evaluation may proceed before precise timing UX is rich, but
strict timing claims must wait until input origin, pause/resume handling,
speed-ratio conversion, and device/pipeline latency are all explicit. Replay
and Evaluation must share this same timebase contract; `ReplayArtifact` should
not be designed later with an incompatible clock. The same coordinates should
support transient local replay first and durable saved replay later.
- Current MIDI evidence timing has moved away from WebSocket arrival time, but
  browser input origin is not yet proven to be exactly synchronized with the
  backend `performance.started` clock origin. The likely offset is small enough
  for MIDI Replay V1, but not for precise claims such as "you were 37 ms late".
  Exact timing reports must wait for an explicit client/backend clock-origin and
  latency calibration design.
- MusicXML may not contain a usable numeric tempo. Backend tempo resolution may
  use a deterministic default or later a user-selected tempo, but fallback tempo
  is product/runtime configuration, not score truth.
- `SessionSummary`, `PlayablePerformanceReplay`, `SavedReplayArtifact`, and
  `EvaluationArtifact` are separate product concepts:

```text
SessionSummary
-> lightweight immutable terminal snapshot

PlayablePerformanceReplay
-> replay payload decoded for browser playback; may come from transient
   just-finished browser capture or from a downloaded saved replay object
-> owns a versioned replay timebase snapshot, including `speedRatio`, so it can
   explain ReplayTime -> TimelineTime without depending on a retained live
   WebSocket payload

SavedReplayArtifact
-> durable metadata for a synchronized score replay, created only by explicit user save

ReplayPayload
-> immutable object-storage object referenced by a saved replay artifact

EvaluationArtifact
-> inferential correctness/timing analysis, created only when evidence permits
```

Evidence-quality metrics may be internal gates for whether an
`EvaluationArtifact` is created or shown. They do not all need to become
user-facing report KPIs.
- Evidence retention is not user replay retention. Backend may keep in-memory or
  diagnostic evidence for `SessionSummary`/evaluation during a session, but it
  must not silently convert that evidence into a durable user replay artifact.
- A saved replay row exists only after synchronous save succeeds. The row implies
  the object-storage payload already exists and can be replayed. Save failures
  return an error and do not create `PENDING`, `FAILED`, or otherwise incomplete
  artifact rows. If object upload succeeds but finalize fails, cleanup is an
  implementation concern, not a user-visible artifact state.
- A saved replay playback URL is an ephemeral authorization result, not artifact
  metadata. Customer Web should load saved replay metadata with the report, but
  request a fresh playback URL only when the user clicks Play. If that playback
  attempt fails, the page preserves the `SavedReplayArtifact` identity, stops
  loading, shows a lightweight playback error, and leaves the same Play action
  available for the next user-initiated fresh authorization attempt.
- Playback authorization is for object read access only. It must not override
  response headers such as `Content-Type` or `Content-Disposition` in the
  presigned URL; the report already has artifact metadata in the database, and
  object-storage providers may reject response-header overrides for existing
  object metadata.
- User-saved replay is permanent until the user deletes it. Do not add
  `EXPIRED`, `expires_at`, or automatic retention fields for this product rule.
- Deleting a saved replay is a two-phase durability operation: first remove the
  visible `SavedReplayArtifact` row and enqueue the immutable object key in a
  deletion outbox inside the same database transaction; then let the worker
  delete the physical object idempotently with bounded retries. The API must not
  synchronously delete storage first and leave a still-visible DB row if object
  deletion fails.
- `STEP_BY_STEP` does not default to replay recording. It may keep neutral
  learning attempts and a lightweight summary, but raw audio/MIDI replay should
  not be recorded by default. Replay belongs to `CONTINUOUS_PLAY`, first as
  local immediate replay and later as explicit saved replay.
- Local Performance replay time is active Performance time. `COUNT_IN` is not
  replay time: capture starts at the first `RUNNING` clock state, where
  replay time is 0. `PAUSED` wall time is excluded for both MIDI and microphone.
  Local capture stops at the Performance terminal boundary
  (`performance.ended` or the local user-stop boundary), not when later
  `session.finished` persistence work completes.
- `PlayablePerformanceReplay` stores replay data, not browser resource handles.
  Audio replay owns a `Blob` plus metadata; UI components derive and revoke
  object URLs for playback.
- Performance Report is a report/review surface, not a coaching workflow or a
  practice planner. Freeze the product boundary as:

```text
Report identifies.
User decides.
Practice executes.
```

  The report should show what happened, where it happened, and what evidence
  supports it. It must not decide practice priority, practice order, remediation
  queue state, or the size of a new practice range. Do not add per-problem
  "practice here", "play from here", "next problem", "start problem practice",
  or automatic problem-queue CTAs until a validated product need exists. The
  existing full replay player, synchronized orange playhead, progress bar, and
  evidence annotations are sufficient for the current review surface; users can
  scrub replay themselves and then choose any range on the Practice page.
  Performance Report should prioritize reliable facts over scores:

```text
Session facts
Replay
Annotated score
Key facts
Problem details
```

  For MIDI Performance, the first reliable key facts should come from strike
  evidence: confirmed correct strike targets, missing strikes, extra/repeated
  pitches, and problem-measure count. For microphone Performance, show only
  facts backed by current evidence, such as duration, replay availability, and
  analysis/capture coverage. Do not show a total score, pitch/rhythm/completion
  score rings, expression score, or exact microphone wrong-note rate before the
  corresponding evaluator evidence is strong and explainable.
- Report replay has two separate visual layers:

```text
Replay position layer
-> orange current cursor/playhead; answers "where is playback now?"

Evaluation layer
-> green confirmed correct
-> red confirmed error
-> neutral original notation when evidence is insufficient
```

  A replay-position decoration must not imply correctness, user performance
  quality, or recognition evidence. Any temporary "already passed" notation
  decoration is only a replay-timeline diagnostic/auxiliary layer and must be
  named as such, for example `replay-passed`, never `played` or `correct`.
  Mature report UX should prefer evidence-backed evaluation colors over a
  permanent passed-onset trail. Microphone reports must be conservative:
  unrecognized notes are neutral unless the evidence channel is healthy enough
  to confirm an error. Rest intervals may be shown by the current playhead, and
  may receive an error marker only for confirmed rest violations; they should
  not become permanently green simply because replay time passed through them.
  The first supported evaluation-color slice is MIDI Performance. Group-level
  outcomes are not note-level truth: `MATCH` may mark every expected note in the
  group green, but `PARTIAL`/`MISMATCH` must not automatically mark every
  notehead in the group red. Piano input matching uses physical strike targets,
  not raw notation-note cardinality: same group + same pitch + new attack
  requirement collapses to one expected strike target that may own multiple
  render note ids. The evaluator should expose expected-strike outcomes
  (`MATCHED`, `MISSING`, `UNCONFIRMED`) and unexpected MIDI pitches separately;
  the report/read-model layer projects only confirmed matched/missing strike
  targets to render note ids. `NOT_OBSERVED` remains neutral until the product
  deliberately promotes missed-note semantics for a reliable input/evaluation
  policy. Extra notes are not properties of expected noteheads and must be shown
  as separate evidence, not by coloring an arbitrary score note red.
  The report UI should show extra/repeated MIDI pitches as a compact evidence
  row on the relevant target/measure, not as fake notation inserted into the
  Verovio SVG.
  The Performance report top facts are limited to evidence-backed values. MIDI
  Performance shows correct strike targets, missing strikes, extra/repeated
  pitches, and problem-measure context. Microphone Performance shows
  conservative duration and coverage facts instead of note-accuracy claims.
  Microphone Performance remains metrics/replay-first and should not receive
  per-note red/green marks without stronger polyphonic evidence.
- Report replay rendering must not use `HTMLMediaElement.timeupdate` as the
  score-animation clock. The media element or MIDI replay clock owns
  authoritative `ReplayTime`; `requestAnimationFrame` is only a render
  scheduler that samples the authoritative time and projects it through the
  replay timebase into the Performance timeline. This keeps playback position
  responsive without inventing a separate UI clock.
- `CONTINUOUS_PLAY` resume should use a short resume count-in before returning
  to `RUNNING`. This count-in is a runtime/lifecycle preparation phase, not a
  new musical clock progression state: `PerformanceClock`, ReplayTime, and
  evidence time remain frozen until the backend authoritatively resumes
  `RUNNING`. `STEP_BY_STEP` does not use resume count-in because it waits on a
  current expected group rather than a fixed musical phase.

## Removed Direction

The previous free-speed Continuous direction is retired:

- No Matchmaker score follower may drive the user-visible Continuous cursor.
- No automatic distant relocalization path is part of the current product.
- Customer Web must not expose a free-follow or Matchmaker-driven
  `CONTINUOUS_PLAY` entry point.
- No replay fixture or test should treat Matchmaker free-follow selected-range
  completion as the future Performance contract.
- The old `continuous_follow_quality_manifest.json` fixture contract is removed.

The backend enum value `PracticeProgressionMode.CONTINUOUS` is runnable only as
the canonical fixed-clock `CONTINUOUS_PLAY` preset.

## Fixed-Clock Performance Foundation Status

Done:

- Public create-session requests now express product intent with
  `preset=STEP_BY_STEP` plus `input_source`; they no longer expose
  `progression_mode`, `realtime_guidance`, or `evaluation_profile` as public
  request fields.
- Backend canonical preset projection lives in the Practice module and maps:
  `STEP_BY_STEP` to `WAIT_FOR_NOTE + GUIDED + LEARNING`, and
  `CONTINUOUS_PLAY` to `CONTINUOUS + STATUS_ONLY + PERFORMANCE`.
- `PerformanceTimeline` provides nominal beat/time mapping from score timeline
  plus tempo segments.
- `ResolvedPerformanceScope` maps the persisted inclusive playable-target
  `PracticeScope` into fixed-clock start and terminal boundaries.
- Selected-range Performance terminal boundaries use the inclusive end group's
  musical sounding end. Chords use the maximum event end in the group, and tied
  notes extend through their continuation chain instead of stopping at the first
  MusicXML fragment.
- Scope tests now protect:
  - default tempo mapping;
  - tempo-map changes;
  - full-performance completion at score end;
  - full-performance inclusion of trailing rests;
  - selected-range completion at the inclusive end group's musical end;
  - tied continuation not becoming a separate selected target;
  - multi-fragment tie chains extending the selected terminal boundary;
  - mixed tied chords keeping newly struck notes as expected targets;
  - reversed and unknown selected-range rejection.
- `PerformanceClock` is implemented as a pure backend domain object over
  `PerformanceTimeline` and `ResolvedPerformanceScope`.
- `PerformanceRuntime` composes `PerformanceTimeline`, `ResolvedPerformanceScope`,
  and `PerformanceClock` into a pure backend clock-sync boundary for the future
  WebSocket/runtime integration. It does not consume input, call Matchmaker,
  write database rows, or perform scoring.
- The Practice WebSocket protocol now reserves fixed-clock Performance messages:
  `performance.clock_sync`, `performance.started`, `performance.paused`,
  `performance.resumed`, and `performance.ended`. `performance.clock_sync` is
  the authoritative state snapshot. Lifecycle events are transition
  notifications and carry the same snapshot payload so clients can recover from
  missed events by applying the next sync.
- Fixed-clock sync payloads expose `performance_time_ms` as the logical
  Performance time inside the selected scope. They do not expose backend wall
  clock or a browser-comparable server timestamp, and this field must not be used
  as an input-evaluation timestamp.
- The backend runtime registry now has a fixed-clock Performance construction
  path. `WAIT_FOR_NOTE` sessions still build the existing alignment runtime;
  canonical `CONTINUOUS_PLAY` sessions build a
  `PerformancePracticeSessionRuntime` around `PerformanceRuntime`.
- Practice target catalog and Performance runtime construction now share the
  same backend-prepared MusicXML to `PracticeScoreTimeline` loader, keeping
  render identity, practice target identity, and fixed-clock scope projection on
  one timeline source.
- The shared MusicXML-to-`PracticeScoreTimeline` loader now lives under the
  neutral `processing.practice_score` namespace rather than under the alignment
  engine package. Performance depends on the shared practice score projection,
  not on the Matchmaker/alignment engine.
- Runtime dispatch now uses a canonical runtime kind reconstructed from
  persisted execution facts, rather than branching directly on
  `progression_mode`. Invalid free-axis combinations fail before a runtime is
  constructed.
- The WebSocket router now has an internal fixed-clock Performance lifecycle
  branch. It sends `session.ready`, `performance.started`, authoritative
  `performance.clock_sync` snapshots, `performance.paused/resumed` transition
  notifications, `performance.ended`, and final `session.finished` without
  waiting for microphone or MIDI input frames.
- Fixed-clock Performance must persist session terminal semantics explicitly.
  Natural clock terminal, user-requested finish before terminal, and transport
  disconnect are different facts. The backend must not infer them from the last
  frontend event or collapse them into a generic finished state.
- `performance.ended` means the fixed musical clock reached its terminal
  boundary. `session.finished` means the backend has committed the authoritative
  `PracticeSession` terminal state. A user clicking Finish before terminal is a
  user stop, not natural scope completion.
- With no reconnect/resume protocol, unexpected Performance WebSocket
  disconnect must fail/interrupt the active session. It must not silently keep
  the clock running to `FINISHED`, and it must not emit a natural completion
  outcome.
- The router should stay a transport adapter. Fixed-clock scheduling and
  terminal decisions belong to the Performance runtime/stream boundary, not to
  ad-hoc router branches. A small delegated stream runner is acceptable now; a
  broad event bus is not needed.
- Clock tests now protect:
  - `READY -> COUNT_IN -> RUNNING -> ENDED`;
  - count-in remaining time;
  - musical beat projection from elapsed performance time;
  - scope completion when the fixed clock reaches the terminal boundary;
  - pause/resume freezing both count-in and running elapsed time;
  - speed ratio changing actual clock duration while preserving score time;
  - count-in duration using the scope-start tempo and speed ratio;
  - invalid configuration and invalid lifecycle transitions.
- Runtime tests now protect:
  - scope identity and terminal boundary in clock sync output;
  - start/count-in sync;
  - clock-driven progression and completion;
  - pause/resume freezing visible position;
  - tempo segments and speed ratio;
  - fail-fast invalid scope and clock configuration.
- Backend and Customer Web protocol tests now protect fixed-clock Performance
  sync payload parsing and strict field validation.
- Runtime registry tests now protect internal dispatch between step-by-step
  alignment runtime and fixed-clock Performance runtime, including rejection of
  runtime-kind/config mismatches.
- WebSocket lifecycle tests now protect that internal fixed-clock Performance
  sessions:
  - start from `client.init`;
  - emit clock snapshots;
  - complete and finish without any audio or MIDI input;
  - pause/resume through Performance lifecycle messages without alignment
    updates.
- Practice sessions now persist explicit completion reason:
  `SCOPE_COMPLETED` for natural scope completion and `STOPPED_BY_USER` for a
  user stop before the terminal boundary. Finished-session read models fail fast
  if that reason is missing. Completion reason does not carry failure taxonomy;
  failed sessions use `state=FAILED` and an error reason.
- Fixed-clock Performance WebSocket lifecycle now delegates to a dedicated
  practice stream boundary instead of keeping the clock loop inside the route
  handler.
- Fixed-clock Performance invalid-control and disconnect paths fail the active
  stream instead of allowing an interrupted transport to become a silent
  `FINISHED` session.
- `PracticeSessionDetailRead` now exposes backend-owned `preset`. Customer Web
  selects `STEP_BY_STEP` or `CONTINUOUS_PLAY` from this canonical product field
  and no longer reconstructs user intent from internal runtime axes.
- `PerformanceRuntime` now exposes an immutable
  `PerformanceTimelineProjection` for the resolved scope. The Performance
  WebSocket stream sends it once as `performance.timeline` after `session.ready`;
  recurring `performance.clock_sync` messages remain lightweight authoritative
  state snapshots.
- Customer Web now has a fixed-clock `PerformancePlayheadController` foundation.
  It consumes backend Performance timeline projection plus clock sync payloads,
  projects a bounded visual beat for local interpolation, and highlights the
  current rendered score entry. It does not parse MusicXML tempo or retain an
  average-velocity fallback. This controller is visual-only: it does not own
  progression, completion, scoring, or recovery semantics.
- Customer Web controller selection must be owned by the session's canonical
  mode, not by whichever WebSocket message arrived most recently.
  `STEP_BY_STEP` sessions accept alignment/prompt updates for display;
  `CONTINUOUS_PLAY` sessions accept Performance clock sync for display.
  Unexpected cross-mode messages should not switch the active visual controller.
- The Practice page now derives the active visual controller from canonical
  session execution facts. `WAIT_FOR_NOTE + GUIDED + LEARNING` maps to
  `STEP_BY_STEP`; `CONTINUOUS + STATUS_ONLY + PERFORMANCE` maps to
  `CONTINUOUS_PLAY`; unsupported free-axis combinations fail instead of choosing
  a controller by message shape.
- Performance playhead tests now protect count-in, paused, and ended states from
  local extrapolation. Running-state interpolation is bounded by the scoped
  terminal beat and avoids small same-epoch visual regressions when a later sync
  arrives slightly behind the locally projected position.
- The current Performance playhead still renders by projecting musical beat onto
  playable timeline entries. That is a correct first visual layer over the
  backend timeline projection, but it is not the complete long-term rhythmic
  playhead semantics for rests, tail beats, or barline positions.

## Current Implementation Status

Done:

- Customer Web creates practice sessions through a canonical product preset plus
  input source. It no longer sends internal runtime axes.
- Customer Web no longer creates or preconnects a `PracticeSession` when the
  Practice page mounts. Setup changes remain frontend draft state; clicking
  Start creates the immutable backend session and opens its WebSocket stream.
- Customer Web browser coverage now protects the fixed-clock full-piece
  `CONTINUOUS_PLAY` lifecycle from setup through Start, `performance.timeline`,
  `performance.started`, `performance.clock_sync`, `performance.ended`, and
  `session.finished`. The test also verifies that MIDI input can be present
  without driving progression or completion.
- Customer Web browser coverage now also protects fixed-clock selected-range
  completion, pause/resume controls, and user stop. Pause/resume is asserted
  through `client.pause/client.resume` and backend Performance lifecycle
  messages; selected-range completion and full-piece stop are asserted through
  typed completion outcomes.
- Customer Web status coverage now protects fixed-clock count-in display. A
  `CONTINUOUS_PLAY` session receiving `COUNT_IN` shows preparation pulses
  instead of step-by-step first-note guidance or wall-clock seconds. Local
  countdown presentation reaching zero does not move the playhead until the
  backend sends an authoritative `RUNNING` sync.
- Customer Web user-facing status copy now keeps the two product modes separate:
  step-by-step practice may say it is following the player's input, while
  fixed-clock `CONTINUOUS_PLAY` says the performance is in progress. Product UI
  must not describe fixed-clock Performance as free-speed score following.
- The settings panel exposes `STEP_BY_STEP` and `CONTINUOUS_PLAY` as product
  modes. The selected mode is kept separate from the active backend session
  mode, and the active visual controller uses the backend-owned
  `PracticeSessionDetailRead.preset`.
- The status bar now treats fixed-clock Performance progress as mode-owned UI
  state instead of waiting for step-by-step alignment evidence.
- Backend service validation accepts `CONTINUOUS_PLAY` only as
  `CONTINUOUS + STATUS_ONLY + PERFORMANCE + FIXED_CLOCK_PERFORMANCE`.
- `MatchmakerLiveEngine` rejects non-`WAIT_FOR_NOTE` sessions if called
  directly.
- The live follow policy factory only constructs `WaitForNoteFollowPolicy`.
- The old Matchmaker/free-follow `FollowPolicy` and continuous scope resolver
  have been removed.
- The old Continuous replay manifest and selected-section free-follow tests have
  been removed.
- Completion outcomes no longer infer a Performance Summary from
  `progression_mode=CONTINUOUS`.

Still needed:

- Add explicit `STEP_BY_STEP` skip support from UI to backend runtime. It should
  advance only the current expected group and record a neutral skipped fact.
- Keep `STEP_BY_STEP` completion lightweight: no user-visible formal report or
  score. The existing session summary path can remain as an internal/terminal
  snapshot, but UI copy must not overstate it.
- Remove automatic durable replay creation from `CONTINUOUS_PLAY` finish. Current
  recording support should become an explicit browser-local immediate replay
  surface; durable saved replay requires user action.
- Add synchronized replay UI for `CONTINUOUS_PLAY` before stricter score claims.
- Separate local replay availability, saved replay availability, and optional
  `EvaluationArtifact` availability in read models and frontend result routing.
- Add evidence-quality gates before showing Performance accuracy/problem claims,
  especially for microphone input.

## Priority Plan

### P0 - Stabilize Current Step-By-Step Practice

Goal: make the only exposed runtime reliable before adding Performance mode.

Tasks:

1. Add explicit skip support:
   - UI control appears only for active `STEP_BY_STEP` sessions;
   - backend command advances exactly one current expected group;
   - persisted attempt/summary fact is neutral skipped, not match/wrong;
   - skipped groups do not inflate learning accuracy.
2. Keep `STEP_BY_STEP` completion lightweight:
   - show completion/selected range/duration/skipped count;
   - avoid score-like report language;
   - avoid problem-measure claims from weak microphone evidence.
3. Run backend mypy, lint, and targeted practice tests.
4. Run Customer Web lint, typecheck, and practice component/unit tests.
5. Fix any regressions from removing Continuous/free-follow code.
6. Keep the selected-range UX stable:
   - section button remains highlighted while a range is active;
   - selected range uses background decoration, not note recoloring;
   - bottom controls stay fixed.
7. Expand real microphone fixture coverage for step-by-step:
   - slow beginner pauses;
   - wrong notes followed by retry;
   - repeated incomplete chord attempts;
   - noisy but usable background.

### P1 - Define Fixed-Clock Performance Runtime

Goal: design Continuous Performance without reusing free-speed following.

Start by making public product intent map to backend-owned canonical runtime
configuration. Public create-session clients should send:

```text
preset
scope
input_source
performance_settings?  // only for CONTINUOUS_PLAY once enabled
```

The backend should then project to a typed runtime configuration. `timingPolicy`
may remain an internal runtime axis until there is a real product reason to
expose it through public API, DB, or frontend state.

Then create backend runtime models such as:

```text
PerformanceTimeline
  tempo_map
  musical_time_map
  expected_group_mapping

ResolvedPerformanceScope
  start_group_id
  end_group_id
  clock_start_time
  clock_end_time

PerformanceClock
  performance_timeline
  resolved_scope
  speed_ratio
  count_in
  session_timebase
  state
```

Required behavior:

1. The user chooses or accepts tempo before starting.
2. A count-in happens before scoring begins.
3. The playhead advances from elapsed clock time, not from Matchmaker alignment.
4. Pause freezes clock elapsed time; resume continues from the same position.
5. Completion occurs when the clock reaches the selected scope end.
6. Silence, wrong notes, or noise affect report evidence, not playhead movement.
7. Microphone and MIDI observations are timestamped against the clock position.
8. The backend sends authoritative clock state transitions and low-frequency sync
   messages; the browser renders smooth playhead interpolation locally.
9. `PerformanceTimeline` and `ResolvedPerformanceScope` must exist before
   `PerformanceClock`; the clock should not parse MusicXML or infer scope.

### P2 - Build Performance Replay And Evidence

Goal: make fixed-clock Performance useful before promising detailed scoring.

Priority order:

1. Define the shared Performance timebase contract for replay and evaluation:
   - input/device monotonic time;
   - session active time after count-in/pause normalization;
   - timeline time after speed-ratio conversion;
   - musical beat projection from the backend timeline.
2. Define `PerformanceResult` read-model semantics:
   - immediate `PlayablePerformanceReplay` is the primary post-performance value;
   - durable `SavedReplayArtifact` is created only after explicit user save;
   - `EvaluationArtifact` is optional and evidence-gated;
   - `SessionSummary` remains a lightweight terminal snapshot.
3. Remove automatic replay persistence from Performance finish:
   - finishing a session must not insert a durable replay row by default;
   - backend evidence used for summary/evaluation must remain separate from
     user-visible saved replay;
   - existing automatic MIDI replay persistence is an intermediate
     implementation and should be replaced, not carried forward.
4. Implement local immediate replay for `CONTINUOUS_PLAY`:
   - microphone uses browser `MediaRecorder` output as a temporary compressed
     local blob;
   - MIDI uses a browser-held timestamped event buffer;
   - both sources share the fixed-clock timeline projection for synchronized
     score replay;
   - the `/practice` completion surface does not contain replay controls;
   - local replay is surfaced only after the user opens the Performance report;
   - unsaved local replay remains a transient browser artifact and is not a
     durable history item.
5. Add an explicit Save Performance command:
   - user clicks "Save performance";
   - the client requests upload authorization;
   - the client uploads the current local replay payload directly to object
     storage;
   - the backend finalizes the save only after validating the uploaded object;
   - the backend creates a durable `SavedReplayArtifact`;
   - failed save does not change the finished `PracticeSession`.
6. Add backend APIs for saving, reading, downloading, and deleting saved replay
   artifacts.
7. Build synchronized replay UI using the existing
   `PerformanceTimelineProjection` and `PerformancePlayheadController`.
8. Add retention semantics for saved replay:
   - MIDI and microphone share the same user-facing save/delete rules;
   - storage implementation can differ by artifact kind;
   - saved replay is permanent until user deletion;
   - expiry is not part of the current product rule.
9. Add EvaluationArtifact eligibility gates:
   - sufficient analyzable coverage;
   - input-source-specific confidence;
   - MIDI and microphone thresholds kept separate.
10. Improve MIDI pitch/content evaluator detail:
   - explicit extra-note attribution;
   - chord simultaneity windows;
   - consumed-observation assignment so one input event is not double-counted.
11. Add timing distribution only after timebase and latency semantics are proven:
   - timeline offset and user-visible performance offset are named separately;
   - median/percentile and early/late tendency are preferred over only averages;
   - device/pipeline latency bias is considered before scoring rhythm.
12. Improve microphone observation quality:
   - analyzable/confident/uncertain regions;
   - polyphonic/chord evidence only when fixture evidence supports it.

Do not start by persisting every clock tick or every raw observation as a row,
and do not begin by promising exact accuracy or problem-measure claims for every
input source. First define the in-memory evidence contract:

```text
Input
-> PerformanceObservation
-> ExpectedPerformanceTimeline
-> PerformanceEvaluator
-> PerformanceExpectedEventOutcome
-> SummaryAccumulator
```

Only after Summary, diagnostics, historical replay, and FormalReport
requirements are clear should the project choose a durable Performance data
model. Raw observations, expected-event outcomes, and summary aggregates are
different concepts and should not be forced into one table.

The dependency direction is fixed:

```text
Microphone / MIDI -> evidence / summary
Microphone / MIDI -X-> PerformanceClock progression
```

Performance observations and the fixed clock must share a session-relative
monotonic timebase. Do not use WebSocket arrival time or `Date.now()` as the
source of timing evidence for early/late judgments.

First-version Summary metrics that are safe for both microphone and MIDI:

- completion / coverage
- completion reason (`SCOPE_COMPLETED` or `STOPPED_BY_USER`)
- practice scope
- active duration
- pause / interruption information
- input activity coverage
- analyzable coverage
- confident / uncertain coverage
- low-confidence input regions

MIDI may add stronger symbolic metrics earlier because its evidence is explicit:

- matched expected groups
- missed expected groups
- extra notes
- chord completeness
- timing offset distribution

Microphone metrics must remain conservative until polyphonic evidence is
reliable. Avoid showing exact accuracy, exact wrong-note counts, or problem
measures from weak microphone evidence. Prefer "analyzable coverage",
"confident matches", and "uncertain regions".

The report and any later FormalReport should separate:

```text
what the clock expected
what the input observer heard
how confident the observer was
how the evaluator scored it
```

Every terminal Performance session may have a lightweight SessionSummary. A
stricter FormalReport should exist only when evidence quality is sufficient.

Implementation status:

- Added an in-memory Performance evidence contract in
  `backend/app/processing/performance/evidence.py`.
- `PerformanceObservation` normalizes microphone/MIDI activity onto the shared
  session-relative Performance timebase.
- `PerformanceExpectedEventOutcome` models event-level evaluation results
  separately from raw input observations and final summary aggregates.
- `PerformanceSummaryAccumulator` produces conservative first-version metrics:
  completion reason, scope kind, input source, active duration, input activity
  coverage, analyzable coverage, confident/uncertain coverage, and expected
  outcome counts.
- `PerformanceEvidenceRecorder` collects session-relative microphone activity
  observations and MIDI note-duration observations during fixed-clock
  Performance sessions. These observations are in-memory session evidence; they
  do not drive `PerformanceClock` and are not persisted as raw per-frame rows.
- `PerformanceExpectedEventEvaluator` maps MIDI observations onto the fixed
  Performance timeline and emits expected-event outcomes for the active scope:
  `MATCH`, `PARTIAL`, `MISMATCH`, or `NOT_OBSERVED`, with timing offsets.
- MIDI expected-event outcomes now include expected-strike outcomes and
  unexpected MIDI pitches. Summary projection uses these strike outcomes for
  green/red score annotations, so `PARTIAL` and `MISMATCH` groups do not imply
  every notehead in the group was wrong. Same-pitch duplicate notation in one
  expected group is treated as one physical strike target with multiple render
  ids, so one piano/MIDI key attack can satisfy all corresponding noteheads.
- The fixed-clock Performance WebSocket loop now records microphone chunks and
  MIDI events as evidence, evaluates MIDI expected-event outcomes at finish, and
  leaves progression, pause/resume, and completion under backend clock ownership.
- Performance `SessionSummary` generation now uses this accumulator and avoids
  step-by-step attempt/problem-measure claims when no reliable Performance
  outcome evidence exists.
- Added backend tests for the accumulator source boundary and for
  `finish_session` building a conservative Performance summary from collected
  evidence.
- The browser MIDI stream now sends cumulative active-session timestamps across
  pause/resume. Backend Performance runtime converts those input occurrence
  times through the fixed-clock count-in and speed-ratio model; MIDI evidence no
  longer uses WebSocket arrival time as musical timing evidence.
- Removed the intermediate automatic MIDI replay persistence path. Fixed-clock
  Performance finish no longer creates `PracticeReplayArtifact` rows, passes a
  replay snapshot through `finish_session`, or exposes an unfinished
  `/replay-artifacts` read API. The temporary DB-payload model and migration were
  removed so the future saved-replay implementation can be introduced cleanly as
  explicit user save plus object-storage metadata.
- Customer Web now has a frontend `PlayablePerformanceReplay` boundary for
  browser-playable `CONTINUOUS_PLAY` replay. Microphone Performance records a
  browser-local `MediaRecorder` blob only during Performance runtime;
  step-by-step microphone practice no longer starts replay recording by default.
  MIDI Performance buffers active-session timestamped MIDI events locally and
  exposes a simple immediate replay control in the completion dialog. This is
  transient browser state, not a saved artifact or backend persistence path.
- Local replay capture now follows the frozen timebase rule: `COUNT_IN` is not
  recorded, capture starts only after the Performance clock reaches `RUNNING`,
  pause wall time is excluded, and capture is stopped/frozen at
  `performance.ended` or the local user-stop boundary instead of waiting for
  `session.finished`. Audio replay data is stored as a local `Blob` plus
  metadata; the report page derives and revokes the temporary object URL.
- Immediate local replay now has a report-page player boundary. The `/practice`
  page does not render replay controls in the bottom bar or completion dialog.
  It only captures the finished `CONTINUOUS_PLAY` replay and makes it available
  to the report route as transient browser state.
- `PlayablePerformanceReplay` now carries an immutable `timebase` snapshot with
  `version` and `speedRatio`. Audio and MIDI replay use this snapshot to map
  replay active time to Performance timeline time instead of relying on the last
  live clock-sync payload still being present in page state.
- The completion dialog is the only post-finish surface on `/practice`.
  `STEP_BY_STEP` shows "Try Again" and "Section Practice"; `CONTINUOUS_PLAY`
  shows "Try Again" and "View Report". The report page is the only place where
  the local replay player appears.
- `CONTINUOUS_PLAY` resume count-in is implemented as a backend-owned runtime
  preparation phase. Resume from a running pause emits authoritative `COUNT_IN`
  sync while the underlying fixed clock remains paused; audio/MIDI evidence and
  local replay capture resume only after a backend `RUNNING` clock snapshot.
  Customer Web keeps the visible state in the preparation/count-in presentation
  even when the session row has already returned to `STREAMING`.
- The backend now has the durable saved replay metadata boundary:
  `PracticeReplayArtifact` rows are created only by an explicit save command for
  finished Performance sessions. Replay payloads are stored as immutable storage
  objects; the database stores metadata only (`artifact_uuid`, `session_id`,
  `kind`, `input_source`, `storage_backend`, `object_key`, `content_type`,
  `byte_size`, `checksum_sha256`, `duration_ms`, `timebase_version`,
  `format_version`, `created_at`). There is no `PENDING`, `FAILED`, `EXPIRED`,
  `expires_at`, or DB payload field under the current product rule.
- Backend saved replay APIs now use the final object-storage data-plane
  contract: upload authorization returns an object upload target without
  creating an artifact row; Customer Web uploads bytes to that target; finalize
  validates object metadata and creates the durable `PracticeReplayArtifact`.
  Finalize is idempotent by `artifact_uuid`, and a session can have at most one
  saved replay artifact per kind. Playback authorization returns a short-lived
  playback URL instead of streaming replay bytes through the backend.
- The backend requires the saved replay kind to match the session input source:
  `MICROPHONE -> AUDIO_RECORDING`, `MIDI -> MIDI_EVENTS`.
- Customer Web now exposes the explicit "Save performance" command on the
  Performance report playback card. The `/practice` page still owns only live
  capture and the completion dialog; the report page serializes the transient
  local replay only after the user clicks save. It computes the payload
  checksum, requests upload authorization, uploads the object, then finalizes
  metadata. MIDI replay is uploaded as a versioned NoteVerse replay JSON object,
  and microphone replay is uploaded as the recorded audio blob. Count-in is not
  part of either replay payload.
- The Performance report now consumes historical saved replay artifacts lazily
  when transient browser replay is no longer available. It lists saved artifact
  metadata for the session, shows a stable Play action, and requests a fresh
  playback URL only for a user-initiated play attempt. The downloaded payload is
  decoded into `PlayablePerformanceReplay` and rendered by the same report-page
  `PerformanceReplayPlayer` boundary. If playback loading fails, the artifact
  remains visible and the next Play click starts a new fresh authorization
  attempt. Playback URLs are plain read authorizations without response-header
  overrides. Local just-finished replay remains preferred when present.
- Saved replay deletion belongs to the Saved Performances management surface,
  not the Performance Report playback card. Deleting a saved artifact removes
  the visible `PracticeReplayArtifact` row from the archive list and queues an
  idempotent object-storage deletion record in the same database transaction; a
  worker outbox then removes the immutable payload with bounded retries. The
  report page may review and save, but artifact management belongs to the
  archive.
- The report replay player now binds audio `Blob` URLs after mount and revokes
  them only when the mounted audio element is being torn down or replaced. This
  avoids stale `blob:` URLs during replay and keeps the progress/play state from
  getting stuck after an audio load failure.
- Saved microphone replay now canonicalizes browser recorder content types by
  HTTP media type. `audio/webm;codecs=opus` is accepted and stored/uploaded as
  canonical `audio/webm`; unsupported audio media types are still rejected
  instead of being silently treated as WebM.
- Browser validation confirmed that report-page audio replay moves the score
  playhead in sync with replay time. Immediate local replay is no longer the
  current P0 blocker.
- Browser validation confirmed that explicit saved replay save and delete work
  after configuring object-storage CORS for Customer Web direct upload.
- Report replay score highlighting is a cursor projection, not a sustained
  sounding-note visualization: each replay time maps to the latest score onset
  at or before the projected beat. Notes that started earlier and are still
  sounding are not highlighted together with the current cursor. Chords or
  multiple notes sharing the same onset may still highlight together.
- `PracticeSession.state = FINISHED`, `SessionSummary.summary_status`, and
  saved/local replay availability are separate lifecycles. The completion
  dialog may open after the backend commits the terminal session state and sends
  `session.finished`; it must not wait for `summary_payload` to be ready.
- Summary generation now runs as an explicit post-finish artifact step. The
  WebSocket flow sends `session.finished` first, then builds `SessionSummary`
  with the runtime evidence from that just-finished session. HTTP finish keeps
  its response self-contained by explicitly building the summary after the
  terminal state is committed.
- The Summary page must render a stable report shell for a finished session even
  when `SessionSummary` is `PENDING`, `NOT_REQUESTED`, or `FAILED`. Missing or
  failed analysis is shown as an analysis-section state, not as a whole-page
  failure. Whole-page failure is reserved for invalid/missing session identity or
  inaccessible score/session data.
- Report navigation for `CONTINUOUS_PLAY + FINISHED` is a product capability and
  must not be controlled by local replay availability. Local replay finalization
  is a separate route-handoff lifecycle: `not_expected`, `finalizing`, `ready`, or
  `failed`. If the user opens the report while local replay is finalizing,
  the Practice page waits for the replay terminal state; `ready` navigates with
  an immediate local replay available, while `failed` still navigates and the
  report shell remains usable without that local replay.

Remaining P2 work:

1. Browser-validate lazy saved replay playback-url for historical microphone
   and MIDI Performance sessions after leaving and re-entering the report page.
2. Split the user-facing Performance result model into local replay availability,
   saved replay availability, and
   optional evaluation availability. Do not treat the current conservative
   `summary_payload` as a finished FormalReport.
3. Add evidence-quality gates for creating/showing `EvaluationArtifact`.
4. Improve MIDI evaluator detail: explicit extra-note attribution, chord
   simultaneity windows, and consumed-observation assignment.
5. Add timing distribution only after the shared timebase and latency semantics
   are proven by tests.
   The current timebase is good enough to preserve MIDI event order and drive
   Replay V1, but not enough to support millisecond-precision timing verdicts.
6. Improve microphone observation quality beyond activity coverage: analyzable
   regions, confident regions, uncertain regions, and later polyphonic evidence.
7. Add result UI fields for coverage/evidence quality without presenting weak
   microphone evidence as exact accuracy.
8. Decide which raw observations and expected-event outcomes need durable
   storage only after replay diagnostics and result requirements prove the need.

### P3 - Improve Microphone Recognition

Goal: reduce false negatives and false positives, especially for chords.

Tasks:

1. Keep the current dominant-peak acoustic observer as a baseline only.
2. Add fixture-driven tests for polyphonic/chord evidence.
3. Evaluate whether chroma, multi-peak FFT, or a lightweight onset/pitch stack
   can improve chord evidence without pretending to be full AMT.
4. Keep MIDI as the high-confidence path for strict chord correctness.

### P4 - Product Polish

Goal: make the practice/report loop useful without over-automating.

Tasks:

1. Summary problem rows provide location/focus, not automatic "practice here".
2. Practice page owns range selection.
3. Optional future shortcut: "select from here" can open Practice focused on a
   problem target, but the user still chooses start and end.
4. Keep terminology user-facing:
   - step-by-step practice
   - performance
   - selected range
   - summary

Do not expose internal names such as `WAIT_FOR_NOTE`, `CONTINUOUS`,
`FOLLOW_PERFORMER`, evaluator profile, or policy profile in the product UI.

## Next Recommended Work

1. Redesign the Performance Report information architecture around reliable
   facts instead of template metric cards:
   - session facts;
   - replay;
   - annotated score;
   - at most three key facts;
   - problem details.
2. Build the MIDI Performance key-facts read model from strike evidence:
   confirmed correct strike targets, missing strikes, extra/repeated pitches,
   and problem-measure count. Do not derive these facts from UI colors.
3. Make microphone Performance report output intentionally conservative:
   replay, duration, and analysis/capture coverage only. Do not show exact
   note accuracy or red/green note claims for microphone until polyphonic
   evidence is proven by fixtures.
4. Keep problem details factual and non-directive. Show measure, missing strike
   pitches, and extra/repeated pitches. Do not add "practice here", "play from
   here", "next problem", or problem-queue CTAs.
5. Browser-validate lazy historical playback URL loading for saved microphone
   and MIDI replay after leaving and re-entering the report page.
6. Implement `STEP_BY_STEP` skip end to end after the Performance Report
   surface is no longer carrying misleading or unsupported metrics.
7. Add evidence-quality gates and improve MIDI evaluator detail before showing
   stricter timing or accuracy claims.
8. Improve microphone recognition after more fixtures exist; keep microphone
   claims conservative until chord/polyphonic evidence is proven by tests.

## Current Prioritized Todo

1. **P0: Collapse Performance Report into a reliable fact review surface.**
   Remove unsupported/template metric cards, keep replay and annotated score as
   the primary surface, and limit the top facts to evidence-backed values. For
   MIDI, use strike evidence; for microphone, use conservative coverage/capture
   facts only.
   Implementation status: the report page now leads with the annotated score
   and replay, keeps summary facts in a compact side panel, and no longer
   renders recommendation cards. Summary loading no longer flashes an
   "analysis unavailable" state before the real summary response settles. The
   user-facing report no longer renders the old technical evidence details
   panel; raw attempt fields and scoring policy versions remain internal
   diagnostics unless a deliberate developer/debug surface is designed.
2. **P0: Add explicit report facts from Performance summary evidence.**
   Backend/read-model and frontend should expose/display:
   - confirmed correct strike target count;
   - missing strike count;
   - extra/repeated pitch count;
   - problem-measure count.
   These facts must come from evaluator/read-model evidence, not from front-end
   CSS annotation classes.
   Implementation status: these evidence-backed Performance facts are exposed
   from the backend summary payload and displayed as report key facts. For
   microphone reports, user-facing facts are intentionally limited to plain
   session facts such as duration and input method; technical coverage metrics
   remain out of the primary UI.
   The replay card keeps deletion out of the core report playback controls:
   current unsaved reports show replay plus save, while saved/historical reports
   show replay only. Deletion is available from the Saved Performances archive
   list.
3. **P1: Improve factual problem details.**
   Each problem measure should show only evidence: missing pitches and
   extra/repeated pitches. No automatic practice CTA, replay-from-here CTA,
   queue, ranking, or generated remediation range.
   Implementation status: problem rows show missing pitches, extra/repeated
   pitches, and a location focus action only. Recommendations remain absent
   from the report UI.
4. **P1: Browser-validate historical saved replay playback.**
   Verify microphone and MIDI Performance reports can load saved replay metadata
   after leaving the page, request a click-time playback URL, and replay with the
   same score cursor projection as immediate local replay.
5. **P2: Split Performance result availability.**
   Read models and UI should distinguish local replay available now, saved
   replay available historically, summary available, and optional evaluation
   available.
6. **P2: Implement `STEP_BY_STEP` skip.**
   Add the explicit skip command and UI after report semantics are clean. Skip
   advances exactly one current expected group and records a neutral skipped
   fact.
7. **P3: Improve evaluation only after report facts are trustworthy.**
   Add evidence-quality gates, improve MIDI evaluator details, and delay exact
   timing/microphone accuracy claims until timebase, latency, and fixture
   evidence are strong enough. Do not present millisecond-level timing verdicts
   until browser input origin and backend clock origin are explicitly
   synchronized or calibrated.
