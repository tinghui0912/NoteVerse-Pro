# Practice Following Improvement Plan

Last updated: 2026-09-10

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
= user explicitly saved this performance
= durable user-facing archive entry
```

`ReplayArtifact` is still the durable playback payload for that saved
performance. The user-facing concept is "save performance"; the implementation
does not copy a report snapshot. The saved archive entry is composed from the
finished `PracticeSession`, its immutable score revision, the saved replay
artifact, and optional evaluation facts.

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
Performance summary payload. V1 public evaluation projection is MIDI-only:
symbolic MIDI evidence may drive green/red annotations, key facts, and
problem-measure details; microphone Performance remains replay/session-fact only
until fixture-backed polyphonic evidence quality is proven. The predicate must
distinguish `0` from missing data: `missing = 0` and `extra = 0` are valid facts
when there is explicit evaluated MIDI target evidence, while an all-zero or
empty payload must not imply that analysis facts exist.

`summary_payload` is a compact fact payload, not a report artifact and not a
coaching script. It should contain durable evidence-derived facts such as
`metrics`, `targets`, and `problem_measures`. It must not carry presentation
prose such as `summary` sentences or `recommendations`, and it must not duplicate
the `PracticeAttempt` table as a second per-attempt source of truth. Per-target
and per-measure aggregate counts are valid read-projection facts; full attempt
history belongs to durable evidence tables or an explicit internal diagnostic
surface. User-facing copy belongs to the frontend presentation layer, and future
coaching workflows must use their own explicit product surface instead of hiding
guidance inside a report read model.

Summary build failures are lifecycle/operation facts. The durable session may
store internal failure details for observability, but public customer-facing read
models should expose only stable status/codes and must not leak raw tracebacks,
storage keys, SQL errors, or exception text into the Performance Report UI.

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
  the current expected group. `STEP_BY_STEP` progression advances only on an
  accepted `MATCH` or on explicit user `SKIP`.
- Microphone chord detection is best-effort evidence, not a progression
  shortcut. A partial microphone chord may be recorded for diagnostics and
  future analysis, but it must keep the user on the current expected group.
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
- MusicXML-to-`PracticeScoreTimeline` is a pure score-semantics boundary. It
  must not require a SoundFont, synthesize audio, initialize playback resources,
  or perform network access. SoundFont preparation belongs to playback/reference
  audio adapters, not to score timeline loading. The Partitura score parser
  adapter may block Partitura's optional FluidSynth import when no real
  SoundFont is configured, but it must not create a fake or empty SoundFont
  resource.
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
- `STEP_BY_STEP` skip is implemented end to end. Customer Web sends an explicit
  `client.skip` control frame only for active step-by-step sessions. The backend
  advances exactly one current expected group, persists a resolved
  `SKIPPED/user_skipped` attempt, and exposes skipped counts as neutral summary
  facts. Skipped attempts are not scorable, do not count as matches or errors,
  and do not inflate learning accuracy. They are also not treated as interrupted
  attempts; interruption remains a lifecycle state for unfinished attempts.
- A skip-generated alignment is a first-class alignment update. The runtime must
  update `last_alignment` and pending persistence counters exactly as it does
  for microphone or MIDI alignment, otherwise the final skip can advance the
  policy past the last expected group without letting the session lifecycle see
  `scope_completed=true`.
- Terminal `STEP_BY_STEP` alignment must not be exposed as completed until the
  backend has persisted the terminal alignment and committed
  `PracticeSession.state=FINISHED`. The websocket then sends the final
  `alignment.update` followed immediately by `session.finished`. Frontend
  completion UI is driven by `session.finished`, not by guessing from a local
  skip count or from score position.
- `STEP_BY_STEP` completion must preserve the last backend display anchor on
  the score. `PracticeStatus=finished` closes the active input lifecycle, but it
  must not clear the final prompt/highlight while the completion dialog is open;
  otherwise the user can perceive the session as ending before the final target.
- Step-by-step active-target decoration should follow Verovio's rendered chord
  structure. If a highlighted note belongs to a chord container, the chord
  container is decorated with it so stems and noteheads read as one visible
  target. The backend still owns the target ids; this is only a render-layer
  projection of the same display anchor.
- `STEP_BY_STEP` committed anchors render immediately. `advance`, `skip`, and
  initial/current-target prompts are backend-owned progression facts, not
  provisional frontend localization candidates. Customer Web must not apply
  multi-frame stability gates or sequential jump clamping to these anchors; any
  evidence aggregation, confidence policy, or anti-flicker decision belongs in
  the evaluator/runtime before progression is committed.
- `STEP_BY_STEP` microphone attempt lifecycle now separates "can continue
  collecting an already-open attempt" from "can start a new attempt". A
  sustained tail from the previously accepted note must not open the next
  expected group and create an immediate false mismatch. Once the accumulator
  resolves an attempt, the runtime closes that input-collection cycle and waits
  for a fresh onset before opening the next attempt. This reset is tied to
  attempt lifecycle, not to UI/runtime action strings such as `hold`, `wait`, or
  `advance`. It preserves rolled-chord collection inside one attempt while
  preventing stale resolved attempts from blocking later input.
- Real-recording diagnostics now expose resolved attempt events with evaluator
  result, matched/missing/extra pitch sets, decision reason, gate reason, and
  confidence. This makes the current Once Again gap stage-specific: startup is
  accepted and the stream is not lost, but microphone pitch evidence stalls on
  early expected groups because the acoustic observer produces partial or wrong
  pitch candidates.
- The current dominant-peak acoustic observer remains the default product path.
  A conservative multi-peak FFT candidate mode exists only as fixture-backed
  experimentation; synthetic chord detection alone is not enough to enable it by
  default because real piano recordings can expose harmonics/noisy peaks as
  false extra notes.
- Skip is a step-by-step auxiliary control, not a core session lifecycle
  control. It should not sit inside the primary bottom control row where it
  changes row width between `STEP_BY_STEP` and `CONTINUOUS_PLAY`. The current UI
  renders it as a separate viewport-right floating control above the primary
  controls during active step-by-step practice. Rapid repeated skip clicks can
  arrive faster than React paints every intermediate websocket update, so the
  backend display anchor is the only authoritative visual position for
  `user_skipped` updates.
- `completion_outcome` describes the terminal completion event only. It no
  longer carries `summary_available`; summary readiness, saved replay
  availability, and evaluation availability are independent lifecycles exposed
  through their own read-model fields or endpoints.

Still needed:

- Keep `STEP_BY_STEP` completion lightweight: no user-visible formal report or
  score. The existing session summary path can remain as an internal/terminal
  snapshot, but UI copy must not overstate it.
- Keep Performance result availability explicit at the read-model and UI
  boundary:
  - browser-local just-finished replay is an immediate current-report capability;
  - saved replay is the durable historical archive capability;
  - summary availability is a session artifact lifecycle;
  - evaluation availability is an evidence capability, not replay availability.
- Add evidence-quality gates before showing Performance accuracy/problem claims,
  especially for microphone input.

## Priority Plan

### P0 - Stabilize Current Step-By-Step Practice

Goal: make the only exposed runtime reliable before adding Performance mode.

Tasks:

1. Done: add explicit skip support:
   - UI control appears only for active `STEP_BY_STEP` sessions;
   - backend command advances exactly one current expected group;
   - persisted attempt/summary fact is neutral skipped, not match/wrong;
   - skipped groups do not inflate learning accuracy.
   - final skipped group completes through the normal backend
     `PracticeSession FINISHED -> session.finished` lifecycle.
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

Microphone activity gates have different authority in each product mode:

```text
STEP_BY_STEP + MICROPHONE
-> input-ready immediately enters the current-target listening state
-> background noise estimation warms opportunistically from eligible non-musical audio
-> startup gate waits for a credible musical start
-> runtime evidence gate rejects obviously unusable input
-> evaluator decides MATCH / PARTIAL / MISMATCH / UNCERTAIN
-> runtime advances only on MATCH or explicit user SKIP

CONTINUOUS_PLAY + MICROPHONE
-> PerformanceClock owns progression
-> microphone input is recording/evaluation evidence only
-> calibration/capture health may affect evidence eligibility
-> calibration/capture health must never start, stop, pause, or advance the clock
```

The initial calibration window is a duration-level tuning parameter, not a
product rule expressed as a fixed frame count and must not be a user-visible
practice-readiness gate. The engine should warm its noise estimate from
accumulated valid audio samples/time in the background, so changing browser chunk
size or audio frame cadence must not silently change the intended estimator
maturity target. Credible tonal/onset activity must not be learned as background
noise and must not advance noise-estimate maturity. The UI must not show a
blocking "calibrating" state before step-by-step practice; once microphone input
is connected, the user-facing state is "ready, play the current note" while
noise estimation remains an evidence-preprocessing concern.

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
10. Done: improve MIDI pitch/content evaluator V1 detail:
   - MIDI observations are assigned to at most one nearest expected event inside
     an explicit assignment window;
   - chord notes are evaluated from the first same-event physical gesture inside
     an explicit simultaneity window;
  - a late expected pitch outside that gesture is retained as unconfirmed timing
    evidence. It is not exposed as public extra-note evidence and is not
    projected as a public missing/red note until a deliberate timing-evaluation
    policy exists;
   - same-onset same-pitch duplicate notation remains one physical strike target;
   - repeated same-pitch attacks after the first consumed expected strike are
     reported as extra/repeated input.
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
- MIDI Performance evaluation now has explicit V1 boundaries for dense adjacent
  events: each observation is assigned to at most one nearest expected event
  inside the assignment window; chord matching uses the first same-event
  physical gesture inside the simultaneity window; late expected pitches outside
  that gesture do not silently repair the chord and are projected as
  `UNCONFIRMED`, so they remain neutral in public missing/error annotations
  until timing evaluation has a deliberate policy. Late pitches that belong to
  another nearest event are still evaluated only against that event. Dense
  fixture tests cover late chord notes, adjacent single-note assignment,
  repeated same-pitch targets, duplicate notation, public neutral projection for
  unconfirmed strikes, and out-of-window notes.
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

1. Split the user-facing Performance result model into local replay availability,
   saved replay availability, summary availability, and optional evaluation
   availability. Do not treat the current conservative `summary_payload` as a
   finished FormalReport. Implementation is mostly in place; keep hardening the
   central read-model predicate and frontend presentation boundaries so missing
   analysis never masquerades as zero-error analysis.
2. Add evidence-quality gates for creating/showing `EvaluationArtifact`.
3. Harden MIDI evaluator V1 with more fixture coverage and tuning after browser
   evidence grows. The core V1 assignment/simultaneity/repeated-extra contract is
   in place and includes dense adjacent-event regression coverage; remaining work
   is to validate constants against real MIDI recordings and add broader musical
   fixtures such as fast repeated-note passages, arpeggiated chords, and
   expressive early/late playing.
4. Add timing distribution only after the shared timebase and latency semantics
   are proven by tests.
   The current timebase is good enough to preserve MIDI event order and drive
   Replay V1, but not enough to support millisecond-precision timing verdicts.
5. Improve microphone observation quality beyond activity coverage: analyzable
   regions, confident regions, uncertain regions, and later polyphonic evidence.
   Current real-engine fixture status against the revised Once Again score:
   public negative samples still guard false starts, but the local Once Again
   excerpt and the first 20 seconds of the complete `Once Again.wav` are marked
   `known_gap` for stable follow progress. The attempt-lifecycle reset bug that
   previously allowed only the first accepted update has been fixed, but these
   fixtures still advance only through the opening region and do not yet produce
   enough accepted alignment advance to claim robust step-by-step microphone
   following.
6. Add result UI fields for coverage/evidence quality without presenting weak
   microphone evidence as exact accuracy.
7. Decide which raw observations and expected-event outcomes need durable
   storage only after replay diagnostics and result requirements prove the need.

Recently completed P2 validation:

- Browser validation confirmed lazy historical saved replay playback for saved
  microphone/MIDI Performance sessions after leaving and re-entering the report
  page. Historical playback requests a fresh click-time playback URL and uses the
  same score cursor projection as immediate local replay.

### P3 - Improve Microphone Recognition

Goal: reduce false negatives and false positives, especially for chords.

Current P3 direction is benchmark-first. Do not continue tuning generic acoustic
thresholds one fixture at a time. The next microphone work must use a shared
fixture matrix and one benchmark vocabulary before any production observer is
changed.

P3.1 benchmark contract:

```text
dominant-peak observer
= current baseline

generic multi-peak FFT
= experimental candidate only
= not the default production direction

STEP_BY_STEP microphone recognition
= target-conditioned evidence verification
= the system already knows the current ExpectedPracticeStrikeTargets

not:
blind full transcription -> guessed score relation
```

Primary product risk ordering for STEP microphone:

```text
1. false match / false advance
2. expected strike recall
3. chord complete detection
4. median / P95 time-to-match
5. false discovery / extra evidence pressure
6. uncertain rate
```

False advance is more dangerous than a false negative. A missed recognition can
leave the user on the same target or be escaped with Skip; an incorrect advance
tells the user the target was accepted when the evidence did not justify it. For
candidate observer experiments, use the more general term `false_match_count`
unless the benchmark candidate actually owns progression decisions.

Benchmark metrics should keep evidence quality separate from product behavior:

```text
Evidence quality:
- score expected strike coverage when ground truth is only the score
- expected strike recall only when paired physical ground truth exists
- expected strike precision only when paired physical ground truth exists
- chord complete detection rate
- false_discovery_rate = extra predicted pitches / all predicted pitches

Product behavior:
- false advance rate / guard count
- median and P95 time-to-match
- uncertain rate
```

Every benchmark output must declare its `benchmark_scope`:

```text
baseline_runtime_replay
= current production replay/runtime owns startup, attempt lifecycle, and
  progression decisions
= false_match_count can be read as false-advance guard evidence

observer_window_replay
= an experimental observer is replayed inside windows created by the baseline
  runtime
= useful for pitch-evidence comparison
= must not be read as end-to-end false-advance or time-to-match quality

causal_shadow_runtime_replay
= an experimental candidate owns startup, attempt lifecycle, and progression in
  a separate shadow run
= only this scope can make end-to-end product-behavior claims for a new observer

offline_score_aligned_oracle
= a complete external transcript is aligned back to known score targets after
  the fact
= useful as an accuracy-ceiling and error-diagnosis oracle
= must not be read as causal following, false-advance safety, or time-to-match
  quality
```

Every benchmark summary must also declare evidence applicability:

```text
ground_truth_source:
  score_expectation
  paired_midi
  synthetic
  none

score_expected_strike_coverage
= matched score-expected strikes / score-expected strikes
= valid when the only available truth is MusicXML expectation

expected_strike_recall / expected_strike_precision
= physical performance accuracy metrics
= only valid for paired MIDI or synthetic fixtures
= null for real microphone recordings without physical-strike ground truth

paired_midi
= synchronized physical-strike truth from the same acoustic performance
= not a MusicXML-derived MIDI file
= not MIDI captured from a different take

synthetic
= generator-owned physical-strike truth
```

Every benchmark summary must declare causal semantics explicitly:

```text
causal: true | false
uses_future_context: true | false
evidence_horizon_ms: number | null
```

Do not infer these from the scope name in UI, docs, or future scripts.

Benchmark input identity should describe the canonical audio actually replayed
by the diagnostic script, not merely the source filename:

```text
audio_input:
  sha256
  sample_rate_hz
  channels
  sample_format
  sample_count
```

If a fixture starts as 48 kHz stereo and is resampled to 16 kHz mono float32,
the benchmark identity belongs to the 16 kHz mono float32 replay PCM. The
canonical bytes are contiguous little-endian float32 PCM samples at the declared
sample rate and channel count.

The fixture matrix should include:

- real `Once Again.wav` and the derived excerpt;
- synthetic single notes;
- synthetic simultaneous chords;
- rolled chords;
- repeated same-pitch attacks;
- octave-confusion cases such as A4/A5 and C4/C5;
- non-tonal input such as desk taps, keyboard typing, coughs, and speech;
- mixed piano plus background noise.

Benchmark diagnostics may include a small internal reason taxonomy such as:

```text
accepted_match
false_advance_guard
startup_pitch_mismatch
low_alignment_confidence
low_expected_activation
extra_candidate
no_expected_activation
uncertain_evidence
no_onset
```

These diagnostic reasons are for scripts, fixture reports, logs, and future
developer tooling. They must not become user-facing Performance Report copy and
must not automatically expand the public realtime WebSocket contract.

The next production candidate should be score-informed / target-conditioned
acoustic evidence: for the current expected strike targets, estimate onset and
spectral activation per expected pitch over the gesture window. This avoids
pretending that the realtime observer can or should transcribe every audible
pitch before using the score. Existing Basic Pitch, Transkun, and Aria-AMT
benchmarks are enough for the current full-transcript reference layer. Do not add
more acoustic frontends until bounded STEP evaluation exposes a concrete failure
that the current references cannot explain.
The first `TargetConditionedPianoObserver` implementation is an experimental
benchmark candidate only. It estimates per-expected-pitch spectral activation
from PCM and can project matched expected pitches into the existing
`AudioObservation` evaluator contract, but it is not wired into the production
Matchmaker runtime and does not claim robust real microphone polyphonic support.

P3 provider direction is now:

```text
AcousticEvidenceProvider
= produces expected-pitch evidence for a known ExpectedPracticeGroup
= never returns MATCH / PARTIAL / MISMATCH
= never owns product progression in production

Expected evidence
↓
ExpectedEventEvaluator
↓
STEP policy / shadow runtime
```

Do not keep inventing handcrafted DSP versions before benchmarking mature
open-source acoustic frontends. Accuracy-ceiling systems are benchmark inputs,
not production runtime dependencies. Verified Transkun V2/V2 Aug checkpoints
should be treated as the first offline piano-AMT oracle candidate because public
MIREX/MAESTRO evidence currently makes it the strongest open accuracy-ceiling
reference. The initial P3 comparison now covers Basic Pitch, Transkun V2 Aug,
and Aria-AMT; do not add more full-AMT providers by default unless a bounded
STEP benchmark exposes a specific failure that these references cannot explain.

Offline AMT providers must enter as explicit benchmark-only evidence providers:

```text
external transcription artifact
-> aligned to expected strike targets as an offline oracle
-> ExpectedEventEvaluator
-> offline_score_aligned_oracle benchmark metrics
```

They must not:

```text
drive production STEP progression
replace PracticeScoreTimeline identity
become a saved replay/report artifact
silently run when no explicit benchmark artifact is provided
```

The initial Transkun integration consumes an exported MIDI transcription from an
explicitly-run Transkun job. The benchmark script may load that MIDI as a named
oracle provider and align it back to expected score targets. Running Transkun
itself remains an external research step until dependency, model, latency, and
deployment constraints are intentionally reviewed.

Docker smoke test status:

- `transkun==2.0.1` can run inside the practice quality container as a temporary
  research venv with CPU PyTorch. It currently needs `setuptools<81` because the
  CLI imports deprecated `pkg_resources`; this is another reason not to add it
  to production/runtime requirements.
- The PyPI package includes the `transkun` CLI and bundled `pretrained/2.0.pt`,
  so a smoke transcription can run without a separate model download.
  This has not been verified as the public Transkun V2 Aug checkpoint; benchmark
  output must therefore label it as the PyPI 2.0.1 default checkpoint, not as
  V2 Aug.
- CPU transcription succeeded for:
  - `once_again_excerpt_16k.wav` -> 82 note-on events;
  - `Once Again.wav` -> 291 note-on events.
- Feeding the generated full-recording MIDI directly into the existing attempt
  windows produced many extra pitches, proving that raw AMT note-on output
  cannot be interpreted as a STEP progression oracle by simply dropping it into
  current gesture windows.
- A first benchmark-only transcript-to-score/time alignment layer now greedily
  anchors Transkun note-on clusters to `ExpectedPracticeGroup` identities and
  narrows each provider projection to the aligned gesture window. With that
  alignment on `Once Again.wav`:

  ```text
  observer_window_replay:
  - baseline score_expected_strike_coverage = 0.24
  - target_conditioned_dsp_v1 score_expected_strike_coverage = 0.28

  offline_score_aligned_oracle:
  - ground_truth_source = score_expectation
  - transkun_pypi_2_0_1_default_midi_oracle score_expected_strike_coverage = 0.7448
  - transkun expected_strike_recall = null
  - transkun expected_strike_precision = null
  - transkun chord_complete_detection_rate = 0.6818
  - transkun per_pitch_extra_rate = 0.042
  - transkun uncertain_rate = 0.2095
  - false_match_count / false_advance_guard_count / time-to-match are not
    emitted for this scope, because whole-file transcript alignment is not
    causal following.
  ```

  The alignment layer makes the oracle comparison much cleaner, especially for
  extra-note pressure, but this remains score-expected coverage, not physical
  recognition recall. It is a benchmark/reference path, not a production STEP
  recognizer.

The current priority is:

1. Add paired MIDI + microphone ground-truth fixtures. The local fixture
   contract now lives in
   `backend/tests/fixtures/practice_audio/paired_ground_truth_manifest.json`.
   Start the product-specific capture matrix with C-E-G omissions so false chord
   completion is measured before another model is integrated. In parallel, use
   public paired datasets as raw acoustic observer smoke tests when they contain
   synchronized audio and same-performance MIDI truth.
2. Keep `TargetConditionedPianoObserver` as the handcrafted DSP benchmark
   baseline and proof of the score-conditioned provider contract.
3. Keep the exported-MIDI AMT oracle provider as an
   `offline_score_aligned_oracle` only. It establishes an offline accuracy
   ceiling without changing production runtime behavior or making causal
   progression claims.
4. Run selected-window offline transcription shootouts for public paired data
   before changing production observer behavior. The first P3 v1 shootout is now
   complete for Basic Pitch, Transkun, and Aria-AMT; do not add hFT, MT3, Kong,
   Essentia, or other full-AMT providers until bounded STEP evidence creates a
   specific need.
5. Then run score-conditioned comparisons with the same evaluator and
   ExpectedPracticeStrikeTargets, so model quality and score-prior benefit stay
   separable.
6. Reopen additional acoustic-provider comparisons only after bounded STEP
   evaluation exposes a specific failure that the current references and
   handcrafted baseline cannot explain.

Public paired-dataset smoke status:

```text
MAESTRO v3.0.0
sample:
2015/MIDI-Unprocessed_R1_D1-1-8_mid--AUDIO-from_mp3_06_R1_2015_wav--3

source:
- official archive is ~108 GB
- Google Cloud Storage supports byte-range access
- one 46.16s WAV + matching MIDI pair was extracted without downloading the full archive
- formal P3 shootouts must use official `test` split recordings only

benchmark:
- script: backend/scripts/evaluate_public_paired_midi_dataset.py
- downloader: backend/scripts/download_maestro_pair.py
- ground_truth_source = paired_midi
- benchmark_scope = paired_midi_oracle_onset_window
- onset_source = paired_midi
- this measures pitch observation inside oracle note-on windows, not onset
  detection, score-following, or product progression quality
- selection-mode = prefix or balanced
- frozen selection manifests are required for cross-provider shootouts
```

Reproducible commands:

```bash
python scripts/download_maestro_pair.py \
  --dataset-dir data/work/datasets/maestro-v3.0.0

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/maestro-v3.0.0/2015/MIDI-Unprocessed_R1_D1-1-8_mid--AUDIO-from_mp3_06_R1_2015_wav--3.wav \
  --midi data/work/datasets/maestro-v3.0.0/2015/MIDI-Unprocessed_R1_D1-1-8_mid--AUDIO-from_mp3_06_R1_2015_wav--3.midi \
  --output data/work/datasets/maestro-v3.0.0/maestro_baseline_observer_report.json \
  --max-groups 120

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/maestro-v3.0.0/2015/MIDI-Unprocessed_R1_D1-1-8_mid--AUDIO-from_mp3_06_R1_2015_wav--3.wav \
  --midi data/work/datasets/maestro-v3.0.0/2015/MIDI-Unprocessed_R1_D1-1-8_mid--AUDIO-from_mp3_06_R1_2015_wav--3.midi \
  --output data/work/datasets/maestro-v3.0.0/maestro_balanced_baseline_observer_report.json \
  --selection-mode balanced \
  --groups-per-bucket 20 \
  --max-groups 120

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/maestro-v3.0.0/2008/MIDI-Unprocessed_09_R3_2008_01-07_ORIG_MID--AUDIO_09_R3_2008_wav--2.wav \
  --midi data/work/datasets/maestro-v3.0.0/2008/MIDI-Unprocessed_09_R3_2008_01-07_ORIG_MID--AUDIO_09_R3_2008_wav--2.midi \
  --dataset-id MAESTRO \
  --dataset-version v3.0.0 \
  --official-split test \
  --recording-id 2008/MIDI-Unprocessed_09_R3_2008_01-07_ORIG_MID--AUDIO_09_R3_2008_wav--2 \
  --selection-mode balanced \
  --groups-per-bucket 20 \
  --max-groups 120 \
  --write-selection-manifest data/work/datasets/maestro-v3.0.0/maestro_test_p3_v1_selection.json \
  --output data/work/datasets/maestro-v3.0.0/maestro_test_p3_v1_baseline_observer_report.json

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/maestro-v3.0.0/2008/MIDI-Unprocessed_09_R3_2008_01-07_ORIG_MID--AUDIO_09_R3_2008_wav--2.wav \
  --midi data/work/datasets/maestro-v3.0.0/2008/MIDI-Unprocessed_09_R3_2008_01-07_ORIG_MID--AUDIO_09_R3_2008_wav--2.midi \
  --dataset-id MAESTRO \
  --dataset-version v3.0.0 \
  --official-split test \
  --recording-id 2008/MIDI-Unprocessed_09_R3_2008_01-07_ORIG_MID--AUDIO_09_R3_2008_wav--2 \
  --selection-manifest data/work/datasets/maestro-v3.0.0/maestro_test_p3_v1_selection.json \
  --max-frequency-candidates 4 \
  --output data/work/datasets/maestro-v3.0.0/maestro_test_p3_v1_fft_top4_observer_report.json
```

The script also emits `metrics_by_bucket` so smoke results can be inspected by
musical difficulty instead of relying on one aggregate score. Current buckets:

```text
single_note
dyad
triad
four_plus_note_chord
octave
repeated_pitch_context
dense_passage
```

Balanced selection is multi-label, not mutually exclusive. A single MIDI strike
group may count as both `dyad` and `octave`, or as `four_plus_note_chord`,
`octave`, and `dense_passage`. This is intentional: the benchmark reports
musical stress conditions, not a single taxonomy. Balanced mode selects up to
`groups_per_bucket` unique examples per bucket and restores score order before
evaluation. Cross-provider comparisons must read the frozen manifest generated
from this selection instead of recalculating selection per provider.

Current MAESTRO smoke metrics over the first 120 MIDI strike groups:

```text
dominant_fft_baseline:
- expected_strike_recall = 0.0492
- expected_strike_precision = 0.0918
- false_discovery_rate = 0.9082
- exact_group_match_rate = 0.05
- chord_complete_detection_rate = 0.0
- uncertain_rate = 0.1833

fft_top_4_candidates:
- expected_strike_recall = 0.1585
- expected_strike_precision = 0.1234
- false_discovery_rate = 0.8766
- exact_group_match_rate = 0.0
- chord_complete_detection_rate = 0.0
- uncertain_rate = 0.1917
```

Selected bucket results:

```text
dominant_fft_baseline:
- single_note recall = 0.0857, precision = 0.1017
- dyad recall = 0.0395, chord_complete_detection_rate = 0.0
- triad recall = 0.0, chord_complete_detection_rate = 0.0
- octave recall = 0.0

fft_top_4_candidates:
- single_note recall = 0.2286, precision = 0.1096
- dyad recall = 0.1184, chord_complete_detection_rate = 0.0
- triad recall = 0.1212, chord_complete_detection_rate = 0.0
- octave recall = 0.0909, uncertain_rate = 0.8
```

Current MAESTRO balanced metrics over 120 selected strike groups from 375
available groups:

```text
dominant_fft_baseline:
- expected_strike_recall = 0.0932
- expected_strike_precision = 0.2752
- false_discovery_rate = 0.7248
- exact_group_match_rate = 0.0417
- chord_complete_detection_rate = 0.0
- uncertain_rate = 0.0917

fft_top_4_candidates:
- expected_strike_recall = 0.2143
- expected_strike_precision = 0.2509
- false_discovery_rate = 0.7491
- exact_group_match_rate = 0.0
- chord_complete_detection_rate = 0.0
- uncertain_rate = 0.1833
```

Current MAESTRO P3 v1 official test selection:

```text
recording:
2008/MIDI-Unprocessed_09_R3_2008_01-07_ORIG_MID--AUDIO_09_R3_2008_wav--2

metadata:
- official_split = test
- canonical_composer = Domenico Scarlatti
- canonical_title = Sonata K. 525
- duration = 65.95s
- source_group_count = 424
- selection_manifest = data/work/datasets/maestro-v3.0.0/maestro_test_p3_v1_selection.json
- selected_group_count = 120
- bucket_membership = multi_label

dominant_fft_baseline:
- expected_strike_recall = 0.1168
- expected_strike_precision = 0.4051
- false_discovery_rate = 0.5949
- exact_group_match_rate = 0.025
- chord_complete_detection_rate = 0.0
- uncertain_rate = 0.3417

fft_top_4_candidates:
- selection_mode = manifest
- expected_strike_recall = 0.2628
- expected_strike_precision = 0.4045
- false_discovery_rate = 0.5955
- exact_group_match_rate = 0.075
- chord_complete_detection_rate = 0.0706
- uncertain_rate = 0.175
```

Interpretation:

- Current dominant FFT is a baseline only; it is not close to reliable
  real-piano polyphonic recognition.
- Generic top-N FFT improves recall slightly but still produces overwhelming
  extra/false-discovery pressure and no chord-complete detection in this smoke
  sample.
- Bucket metrics make the failure clearer: the current FFT family is weak even
  under oracle onset windows, and chord-complete detection remains zero for
  dyads/triads in this smoke sample.
- This reinforces the benchmark-first direction: do not promote another DSP
  tweak into production without paired-truth comparison and false-match safety.
- Public paired data is useful for raw observer quality, but it should not be
  forced into `MatchmakerLiveEngine` unless the same score timeline exists.

```text
PianoVAM v1.0
sample:
Audio/2024-02-14_19-10-09.wav
MIDI/2024-02-14_19-10-09.mid

source:
- public Hugging Face dataset with paired amateur piano practice audio and MIDI
- one 745.49s mono WAV + matching MIDI pair was downloaded with temporary
  token-based HTTP authorization
- the token is not persisted by the downloader

benchmark:
- script: backend/scripts/evaluate_public_paired_midi_dataset.py
- downloader: backend/scripts/download_pianovam_pair.py
- ground_truth_source = paired_midi
- benchmark_scope = paired_midi_oracle_onset_window
- onset_source = paired_midi
- this measures pitch observation inside oracle MIDI onset windows, not onset
  detection, score-following, or product progression quality
- selection-mode = prefix or balanced
- frozen selection manifests are required for cross-provider shootouts
```

Reproducible commands:

```bash
HF_TOKEN=... python scripts/download_pianovam_pair.py \
  --dataset-dir data/work/datasets/pianovam-v1.0 \
  --basename 2024-02-14_19-10-09

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/pianovam-v1.0/Audio/2024-02-14_19-10-09.wav \
  --midi data/work/datasets/pianovam-v1.0/MIDI/2024-02-14_19-10-09.mid \
  --output data/work/datasets/pianovam-v1.0/pianovam_baseline_observer_report.json \
  --max-groups 120

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/pianovam-v1.0/Audio/2024-02-14_19-10-09.wav \
  --midi data/work/datasets/pianovam-v1.0/MIDI/2024-02-14_19-10-09.mid \
  --output data/work/datasets/pianovam-v1.0/pianovam_balanced_baseline_observer_report.json \
  --selection-mode balanced \
  --groups-per-bucket 20 \
  --max-groups 120

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/pianovam-v1.0/Audio/2024-02-14_19-10-09.wav \
  --midi data/work/datasets/pianovam-v1.0/MIDI/2024-02-14_19-10-09.mid \
  --dataset-id PianoVAM \
  --dataset-version v1.0 \
  --recording-id 2024-02-14_19-10-09 \
  --selection-mode balanced \
  --groups-per-bucket 20 \
  --max-groups 120 \
  --write-selection-manifest data/work/datasets/pianovam-v1.0/pianovam_p3_v1_selection.json \
  --output data/work/datasets/pianovam-v1.0/pianovam_p3_v1_baseline_observer_report.json

python scripts/evaluate_public_paired_midi_dataset.py \
  --audio data/work/datasets/pianovam-v1.0/Audio/2024-02-14_19-10-09.wav \
  --midi data/work/datasets/pianovam-v1.0/MIDI/2024-02-14_19-10-09.mid \
  --dataset-id PianoVAM \
  --dataset-version v1.0 \
  --recording-id 2024-02-14_19-10-09 \
  --selection-manifest data/work/datasets/pianovam-v1.0/pianovam_p3_v1_selection.json \
  --max-frequency-candidates 4 \
  --output data/work/datasets/pianovam-v1.0/pianovam_p3_v1_fft_top4_observer_report.json
```

Current PianoVAM smoke metrics over the first 120 MIDI strike groups:

```text
dominant_fft_baseline:
- expected_strike_recall = 0.1488
- expected_strike_precision = 0.463
- false_discovery_rate = 0.537
- exact_group_match_rate = 0.075
- chord_complete_detection_rate = 0.0
- uncertain_rate = 0.1

fft_top_4_candidates:
- expected_strike_recall = 0.3244
- expected_strike_precision = 0.4208
- false_discovery_rate = 0.5792
- exact_group_match_rate = 0.0167
- chord_complete_detection_rate = 0.0169
- uncertain_rate = 0.075
```

Selected PianoVAM bucket results:

```text
dominant_fft_baseline:
- single_note recall = 0.1475, precision = 0.1667
- dyad recall = 0.1786, chord_complete_detection_rate = 0.0
- triad recall = 0.3333, chord_complete_detection_rate = 0.0
- octave recall = 0.1474

fft_top_4_candidates:
- single_note recall = 0.4098, precision = 0.1773
- dyad recall = 0.2857, chord_complete_detection_rate = 0.0714
- triad recall = 0.3333, chord_complete_detection_rate = 0.0
- octave recall = 0.3028
```

Current PianoVAM balanced metrics over 120 selected strike groups from 3464
available groups. This same selection is frozen as
`data/work/datasets/pianovam-v1.0/pianovam_p3_v1_selection.json` and should be
reused by every provider shootout:

```text
dominant_fft_baseline:
- expected_strike_recall = 0.1676
- expected_strike_precision = 0.5688
- false_discovery_rate = 0.4312
- exact_group_match_rate = 0.0667
- chord_complete_detection_rate = 0.0
- uncertain_rate = 0.0917

fft_top_4_candidates:
- selection_mode = manifest
- expected_strike_recall = 0.327
- expected_strike_precision = 0.4859
- false_discovery_rate = 0.5141
- exact_group_match_rate = 0.0167
- chord_complete_detection_rate = 0.013
- uncertain_rate = 0.0583
```

PianoVAM interpretation:

- The Hugging Face token-based download path works without requiring persistent
  local login.
- This sample is much denser than the intended first product fixture; the first
  120 groups contain many four-plus-note chords, octave stacks, repeated-pitch
  contexts, and dense passages.
- The current FFT observers still fail the product safety bar. Top-N FFT raises
  recall, but also keeps false-discovery pressure high and does not reliably
  complete chords.
- PianoVAM should be kept as a public real-recording stress benchmark. It should
  not replace the smaller local fixture matrix that isolates omissions, extras,
  repeated attacks, and octave confusion.

P3 benchmark governance:

```text
DEV selections
-> may be inspected manually
-> may guide feature design, thresholds, grouping, and diagnostic taxonomy

HELD-OUT TEST selections
-> frozen selection manifest
-> no provider-specific resampling
-> no repeated threshold tuning against the same result table
-> used only for final before/after comparisons
```

MAESTRO formal results must record `official_split=test`. PianoVAM should be
treated as cross-domain amateur-practice holdout; do not tune a candidate on a
PianoVAM manifest and then report that same manifest as independent evidence.
The current P3 v1 manifests are first benchmark artifacts, not the final full
test suite.

P1 mature AMT shootout scopes:

```text
paired_midi_oracle_onset_window
-> paired MIDI tells the benchmark where each selected strike happened
-> provider only supplies pitch evidence inside that oracle window
-> suitable for FFT/CQT/activation frontends

selected_truth_window_transcription
-> provider receives only WAV and outputs MIDI
-> provider owns onset detection and pitch transcription
-> selected truth groups come from the frozen manifest
-> no score, no score alignment, no STEP runtime
-> precision and false-discovery metrics are scoped to selected truth windows,
   not to the full recording
-> suitable for full-transcript providers such as Transkun, Basic Pitch full
   decoder, and Aria-AMT

score_conditioned_step_evaluation
-> future product-behavior benchmark
-> uses ExpectedPracticeStrikeTargets and STEP acceptance policy
-> measures false advance, first-attempt acceptance, retry burden
```

`selected_truth_window_transcription` is implemented by
`backend/scripts/evaluate_selected_truth_window_transcription.py`. It compares a
provider-generated MIDI file against the frozen paired-MIDI selection manifest.
The evaluator assigns provider-owned predicted onset groups to selected truth
groups within an explicit onset tolerance. It also counts unassigned predicted
groups inside selected truth windows so local false-discovery pressure is not
hidden. It intentionally does not count predictions outside those selected
windows, so its `predicted_strike_precision` and `false_discovery_rate` must not
be interpreted as full-recording AMT precision/F1.

`score_conditioned_step_evaluation` is the next product-semantic benchmark
scope. Its job is not to find more full-AMT models; it asks whether known
`ExpectedPracticeStrikeTargets` can be accepted safely:

```text
Audio/model output
       ↓
Provider adapter
       ↓
ExpectedStrikeEvidence
       ↓
ExpectedGroupEvaluator
       ↓
MATCH / PARTIAL / MISMATCH / UNCERTAIN
       ↓
STEP gate
```

The first implementation is
`backend/scripts/evaluate_score_conditioned_step_cases.py`. It consumes the
same frozen paired-MIDI selection manifest and a provider MIDI transcript, then
generates:

```text
positive:
actual C-E-G
expected C-E-G
→ should MATCH

missing_added_pitch_negative:
actual C-E
expected C-E-G
→ must NOT MATCH

semitone_confusion_negative:
actual C-E-G
expected C-F-G
→ must NOT MATCH

octave_confusion_negative:
actual C4-E4-G4
expected C5-E4-G4
→ must NOT MATCH
```

This first script is deliberately labelled:

```text
benchmark_scope = score_conditioned_step_evaluation
evaluation_mode = offline_full_transcript
causal = false
uses_future_context = true
product_false_advance_eligible = false
product_false_advance_rate = null
```

It may consume full Transkun/Aria transcripts that benefited from future audio,
so it is an offline score-conditioned oracle only. It may report
`single_pass_correct_acceptance_rate`, `false_completion_rate`,
`missing_added_pitch_false_match_rate`, `semitone_confusion_false_match_rate`,
and `octave_confusion_false_match_rate`; it must not claim real STEP false
advance until a bounded-context provider is evaluated.

The bounded-context follow-up evaluates first-gesture evidence horizons such as:

```text
current onset + 500ms
current onset + 1000ms
current onset + 1500ms
```

The first bounded implementation still consumes offline provider transcripts, so
it is not product-false-advance eligible. It reports
`bounded_correct_acceptance_rate` and `bounded_false_completion_rate` only. A
future truly causal provider/runtime benchmark may report
`product_false_advance_rate` after it proves that evidence was produced without
future transcript context.

The second transcript-derived bounded view is `transcript_shadow_runtime`. It
uses the same offline transcript artifact, but runs a causal loop over transcript
groups inside each horizon: a non-MATCH attempt keeps waiting until MATCH or
timeout. This is closer to STEP "wrong input does not advance" behavior than
first-gesture evaluation, but it is still not product-false-advance eligible
because the transcript itself was produced offline.

The first true audio-window provider view is `causal_audio_window_provider` with
`target-conditioned-dsp-v1`. It reads only the bounded WAV window for the current
expected target and does not consume provider MIDI transcripts. It is a causal
provider benchmark, but not a full product runtime benchmark: it does not model
startup gating, attempt lifecycle, user retries, or end-to-end websocket
progression. Therefore it still must not publish `product_false_advance_rate`.

The next provider benchmark is `transkun_bounded_clip_provider`, implemented by
`backend/scripts/evaluate_transkun_bounded_clips.py`. It exports one bounded WAV
clip per selected source group and horizon, runs Transkun on that clip, then
projects the resulting MIDI transcript onto the same positive and
counterfactual-negative STEP cases. Its metadata must remain explicit:

```text
onset_source = paired_midi
window_anchor_source = paired_midi
bounded_context = true
future_beyond_decision_time = false
streaming_causal = false
causal_attempt_detection = false
causal_runtime_loop = false
product_false_advance_eligible = false
```

This benchmark is more product-relevant than full-recording AMT because the
provider cannot see audio after the decision horizon. It is still not final STEP
runtime evidence because paired MIDI supplies the clip anchor and no independent
attempt detector is evaluated.

The metadata intentionally avoids calling Transkun a `causal_provider`.
Transkun does not see audio after the bounded decision horizon, but the model is
not a streaming causal architecture inside the clip. Clip cache identity is
bound to source audio SHA, clip start/end, pre-roll, horizon, sample rate,
chord-window grouping, Transkun version, checkpoint SHA, model config SHA, and
`clip_pipeline_version`. Changing any of those inputs must invalidate the cached
MIDI sidecar.

Because MAESTRO and PianoVAM fixtures are continuous performances, bounded
provider reports must separate raw false completion from continuous-performance
contamination. If a counterfactual expected pitch is physically played later in
the same bounded decision horizon, that negative case is marked contaminated and
excluded from the contamination-aware safety rate. Raw `false_completion_rate`
is retained for debugging, but
`false_completion_rate_excluding_contaminated_negatives` is the cleaner safety
diagnostic for continuous recordings.

Current offline full-transcript score-conditioned oracle results:

```text
MAESTRO official test / P3 v1 manifest:
- Transkun V2 Aug:
  single_pass_correct_acceptance_rate = 0.925
  false_completion_rate = 0.0
  missing_added_pitch_false_match_rate = 0.0
  semitone_confusion_false_match_rate = 0.0
  octave_confusion_false_match_rate = 0.0
  product_false_advance_rate = null
- Aria-AMT medium-double:
  single_pass_correct_acceptance_rate = 0.8667
  false_completion_rate = 0.0
  missing_added_pitch_false_match_rate = 0.0
  semitone_confusion_false_match_rate = 0.0
  octave_confusion_false_match_rate = 0.0
  product_false_advance_rate = null

PianoVAM / P3 v1 manifest:
- Transkun V2 Aug:
  single_pass_correct_acceptance_rate = 0.7333
  false_completion_rate = 0.0028
  missing_added_pitch_false_match_rate = 0.0
  semitone_confusion_false_match_rate = 0.0
  octave_confusion_false_match_rate = 0.0083
  product_false_advance_rate = null
- Aria-AMT medium-double:
  single_pass_correct_acceptance_rate = 0.725
  false_completion_rate = 0.0028
  missing_added_pitch_false_match_rate = 0.0
  semitone_confusion_false_match_rate = 0.0
  octave_confusion_false_match_rate = 0.0083
  product_false_advance_rate = null
```

Current bounded first-gesture score-conditioned results:

```text
MAESTRO official test / P3 v1 manifest:
- Transkun V2 Aug:
  500ms  bounded_correct_acceptance_rate = 0.8917
         bounded_false_completion_rate = 0.0
         octave_confusion_false_match_rate = 0.0
  1000ms bounded_correct_acceptance_rate = 0.8917
         bounded_false_completion_rate = 0.0
         octave_confusion_false_match_rate = 0.0
  1500ms bounded_correct_acceptance_rate = 0.8917
         bounded_false_completion_rate = 0.0
         octave_confusion_false_match_rate = 0.0
- Aria-AMT medium-double:
  500ms  bounded_correct_acceptance_rate = 0.85
         bounded_false_completion_rate = 0.0
         octave_confusion_false_match_rate = 0.0
  1000ms bounded_correct_acceptance_rate = 0.85
         bounded_false_completion_rate = 0.0
         octave_confusion_false_match_rate = 0.0
  1500ms bounded_correct_acceptance_rate = 0.85
         bounded_false_completion_rate = 0.0
         octave_confusion_false_match_rate = 0.0

PianoVAM / P3 v1 manifest:
- Transkun V2 Aug:
  500ms  bounded_correct_acceptance_rate = 0.6833
         bounded_false_completion_rate = 0.0028
         octave_confusion_false_match_rate = 0.0083
  1000ms bounded_correct_acceptance_rate = 0.6833
         bounded_false_completion_rate = 0.0056
         octave_confusion_false_match_rate = 0.0167
  1500ms bounded_correct_acceptance_rate = 0.6833
         bounded_false_completion_rate = 0.0056
         octave_confusion_false_match_rate = 0.0167
- Aria-AMT medium-double:
  500ms  bounded_correct_acceptance_rate = 0.675
         bounded_false_completion_rate = 0.0028
         octave_confusion_false_match_rate = 0.0083
  1000ms bounded_correct_acceptance_rate = 0.675
         bounded_false_completion_rate = 0.0028
         octave_confusion_false_match_rate = 0.0083
  1500ms bounded_correct_acceptance_rate = 0.675
         bounded_false_completion_rate = 0.0028
         octave_confusion_false_match_rate = 0.0083
```

Current transcript shadow-runtime score-conditioned results:

```text
MAESTRO official test / P3 v1 manifest:
- Transkun V2 Aug:
  500ms  shadow_correct_acceptance_rate = 0.925
         shadow_false_completion_rate = 0.0111
         octave_confusion_false_match_rate = 0.0167
  1000ms shadow_correct_acceptance_rate = 0.9333
         shadow_false_completion_rate = 0.0361
         octave_confusion_false_match_rate = 0.0917
  1500ms shadow_correct_acceptance_rate = 0.9333
         shadow_false_completion_rate = 0.0417
         octave_confusion_false_match_rate = 0.1083
- Aria-AMT medium-double:
  500ms  shadow_correct_acceptance_rate = 0.8667
         shadow_false_completion_rate = 0.0111
         octave_confusion_false_match_rate = 0.0167
  1000ms shadow_correct_acceptance_rate = 0.875
         shadow_false_completion_rate = 0.0389
         octave_confusion_false_match_rate = 0.1
  1500ms shadow_correct_acceptance_rate = 0.875
         shadow_false_completion_rate = 0.0444
         octave_confusion_false_match_rate = 0.1083

PianoVAM / P3 v1 manifest:
- Transkun V2 Aug:
  500ms  shadow_correct_acceptance_rate = 0.7333
         shadow_false_completion_rate = 0.0444
         octave_confusion_false_match_rate = 0.1333
  1000ms shadow_correct_acceptance_rate = 0.7333
         shadow_false_completion_rate = 0.075
         octave_confusion_false_match_rate = 0.225
  1500ms shadow_correct_acceptance_rate = 0.7333
         shadow_false_completion_rate = 0.0778
         octave_confusion_false_match_rate = 0.2333
- Aria-AMT medium-double:
  500ms  shadow_correct_acceptance_rate = 0.725
         shadow_false_completion_rate = 0.0444
         octave_confusion_false_match_rate = 0.1333
  1000ms shadow_correct_acceptance_rate = 0.725
         shadow_false_completion_rate = 0.0694
         octave_confusion_false_match_rate = 0.2083
  1500ms shadow_correct_acceptance_rate = 0.725
         shadow_false_completion_rate = 0.0722
         octave_confusion_false_match_rate = 0.2167
```

Current causal audio-window provider results for `target-conditioned-dsp-v1`:

```text
MAESTRO official test / P3 v1 manifest:
- 500ms:
  correct_acceptance_rate = 0.7833
  false_completion_rate = 0.3417
  octave_confusion_false_match_rate = 0.5667
- 1000ms:
  correct_acceptance_rate = 0.75
  false_completion_rate = 0.4083
  octave_confusion_false_match_rate = 0.5167
- 1500ms:
  correct_acceptance_rate = 0.6917
  false_completion_rate = 0.4
  octave_confusion_false_match_rate = 0.5333

PianoVAM / P3 v1 manifest:
- 500ms:
  correct_acceptance_rate = 0.5417
  false_completion_rate = 0.3472
  octave_confusion_false_match_rate = 0.4917
- 1000ms:
  correct_acceptance_rate = 0.4917
  false_completion_rate = 0.3528
  octave_confusion_false_match_rate = 0.4833
- 1500ms:
  correct_acceptance_rate = 0.475
  false_completion_rate = 0.3417
  octave_confusion_false_match_rate = 0.475
```

Current Transkun bounded-clip smoke result:

```text
MAESTRO official test / first 4 P3 v1 source groups:
- provider = transkun_v2_aug_bounded_clip
- checkpoint = /opt/noteverse/models/checkpointMSimplerAug/checkpoint.pt
- pre_roll_seconds = 0.25
- selected_source_group_count = 4

500ms:
- correct_acceptance_rate = 1.0
- false_completion_rate = 0.0833
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.25
- octave_confusion_false_match_rate = 0.0

1000ms:
- correct_acceptance_rate = 1.0
- false_completion_rate = 0.0833
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.25
- octave_confusion_false_match_rate = 0.0
```

This smoke result proves the bounded-clip pipeline, not provider quality. The
sample is intentionally tiny and skewed toward early single-note MAESTRO events.
It should be expanded to the frozen balanced selection and PianoVAM before any
provider decision is made. The early semitone false match is already enough to
keep counterfactual negatives as hard gates instead of aggregate-only metrics.

Expanded cached bounded-clip result:

```text
MAESTRO official test / first 12 P3 v1 source groups:
- provider = transkun_v2_aug_bounded_clip
- checkpoint = /opt/noteverse/models/checkpointMSimplerAug/checkpoint.pt
- pre_roll_seconds = 0.25
- selected_source_group_count = 12
- case_count = 192

500ms:
- correct_acceptance_rate = 0.9167
- false_completion_rate = 0.0556
- false_completion_rate_excluding_contaminated_negatives = 0.0286
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.1667
- octave_confusion_false_match_rate = 0.0

1000ms:
- correct_acceptance_rate = 1.0
- false_completion_rate = 0.0556
- false_completion_rate_excluding_contaminated_negatives = 0.0286
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.1667
- octave_confusion_false_match_rate = 0.0

1500ms:
- correct_acceptance_rate = 1.0
- false_completion_rate = 0.0833
- false_completion_rate_excluding_contaminated_negatives = 0.0
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.1667
- octave_confusion_false_match_rate = 0.0833

2000ms:
- correct_acceptance_rate = 1.0
- false_completion_rate = 0.1944
- false_completion_rate_excluding_contaminated_negatives = 0.0
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.1667
- octave_confusion_false_match_rate = 0.4167
```

Interpretation: bounded Transkun improves the realism of the provider benchmark,
but it still is not a product false-advance metric because the clip is anchored
by paired-MIDI truth and the runtime does not detect the attempt start itself.
The 12-group run shows that raw false completion increases as the decision
window grows, but the contamination-aware rate drops to zero at 1500ms/2000ms in
this small MAESTRO slice because those raw false matches are explained by later
physical truth inside the continuous performance. This reinforces that STEP
microphone matching needs both a bounded wait policy and contamination-aware
fixtures before safety claims are made.

PianoVAM bounded-clip first result:

```text
PianoVAM / first 12 P3 v1 source groups:
- provider = transkun_v2_aug_bounded_clip
- checkpoint = /opt/noteverse/models/checkpointMSimplerAug/checkpoint.pt
- pre_roll_seconds = 0.25
- selected_source_group_count = 12
- case_count = 96

500ms:
- correct_acceptance_rate = 0.4167
- false_completion_rate = 0.0
- false_completion_rate_excluding_contaminated_negatives = 0.0
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.0
- octave_confusion_false_match_rate = 0.0

1000ms:
- correct_acceptance_rate = 0.3333
- false_completion_rate = 0.0
- false_completion_rate_excluding_contaminated_negatives = 0.0
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.0
- octave_confusion_false_match_rate = 0.0
```

Interpretation: this is the first bounded PianoVAM check over amateur/practice
recording conditions. It is intentionally limited to 500ms and 1000ms windows
because CPU Transkun inference is slow in the current long-lived container. The
low positive acceptance shows that bounded full-AMT evidence is much less
reliable on PianoVAM clips than the selected-window full-transcript oracle
suggests. The absence of false completion in this tiny first slice is useful,
but it is not enough to promote Transkun bounded clips to product behavior. Next
PianoVAM work should broaden the selection and inspect false negatives before
optimizing production observer behavior.

Second PianoVAM bounded shard:

```text
PianoVAM / P3 v1 source groups 12-23:
- provider = transkun_v2_aug_bounded_clip
- checkpoint = /opt/noteverse/models/checkpointMSimplerAug/checkpoint.pt
- pre_roll_seconds = 0.25
- source_group_offset = 12
- selected_source_group_count = 12
- case_count = 48

500ms:
- correct_acceptance_rate = 0.25
- false_completion_rate = 0.0
- false_completion_rate_excluding_contaminated_negatives = 0.0
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.0
- octave_confusion_false_match_rate = 0.0
```

Interpretation: the second PianoVAM shard confirms that low bounded acceptance
is not limited to the opening selection. Positive misses include both missing
expected tones and extra predicted tones around an otherwise present expected
pitch. Under strict STEP semantics, an expected pitch plus extra pitches is not a
safe match. This makes bounded PianoVAM useful as a stress test for both recall
and precision, and supports inspecting positive miss diagnostics before tuning a
production observer.

PianoVAM STEP-like isolated gesture first result:

```text
PianoVAM / P3 v1 isolated source groups, 500ms horizon:
- provider = transkun_v2_aug_bounded_clip
- source_selection_mode = no_subsequent_strike_within_horizon
- pre_roll_seconds = 0.25
- selected_source_group_count = 12

500ms:
- correct_acceptance_rate = 0.5833
- false_completion_rate = 0.0278
- false_completion_rate_excluding_contaminated_negatives = 0.0278
- contaminated_negative_false_match_count = 0
```

Interpretation: the isolated subset improves PianoVAM correct acceptance over
the naive first 12 continuous groups, which confirms that continuous-performance
pollution was a real benchmark-validity issue. It does not solve the product
problem: positive misses still include missing high chord tones and extra
octave-related predictions, so Transkun bounded clips remain benchmark evidence,
not a production STEP recognizer.

PianoVAM fixed-source pre-roll ablation:

```text
PianoVAM / same P3 v1 source groups:
- source_group_indices = [0, 4, 27, 28, 29, 30, 56, 57, 60, 61, 63, 64]
- horizon_seconds = 0.5
- source_selection_mode = explicit_source_group_indices
- provider = transkun_v2_aug_bounded_clip

pre_roll = 250ms:
- correct_acceptance_rate = 0.5833
- false_completion_rate = 0.0278
- false_completion_rate_excluding_contaminated_negatives = 0.0278
- contaminated_negative_false_match_count = 0

pre_roll = 1000ms:
- correct_acceptance_rate = 0.5833
- false_completion_rate = 0.0278
- false_completion_rate_excluding_contaminated_negatives = 0.0278
- contaminated_negative_false_match_count = 0

pre_roll = 2000ms:
- correct_acceptance_rate = 0.5
- false_completion_rate = 0.0278
- false_completion_rate_excluding_contaminated_negatives = 0.0278
- contaminated_negative_false_match_count = 0
```

Interpretation: increasing past context from 250ms to 1000ms did not improve
acceptance on the fixed PianoVAM source set, and 2000ms reduced acceptance. The
remaining bounded Transkun misses are therefore not explained by a simple
250ms-context cold-start problem. Longer pre-roll can also reintroduce previous
notes, pedal tails, and octave-related extra predictions, so Transkun bounded
exploration should stop here for P3 v1. The next high-information benchmark is a
deployable frontend direction such as Basic Pitch raw onset/frame activation
conditioned by ExpectedPracticeStrikeTargets, using the same positive and
counterfactual STEP cases.

Frozen Transkun bounded reference:

```text
TranskunBoundedReferenceV1
- provider = transkun_v2_aug_bounded_clip
- checkpoint = checkpointMSimplerAug/checkpoint.pt
- model_config = checkpointMSimplerAug/model.conf
- decision_horizon_seconds = 0.5
- pre_roll_seconds = 0.25
- source_selection_mode = no_subsequent_strike_within_horizon
- contamination_policy = case_specific_later_truth_pitch
- clip_pipeline_version = 1
- product_false_advance_eligible = false
```

Do not continue tuning Transkun bounded pre-roll/horizon parameters for P3 v1.
Keep this configuration as an accuracy/reference provider and possible future
teacher. Future recordings may rerun the frozen configuration, but should not
retroactively tune it against the same held-out selections.

Basic Pitch raw activation first result:

```text
PianoVAM / same fixed source groups as the Transkun pre-roll ablation:
- provider = basic_pitch_raw_activation
- provider_version = 0.4.0-onnx-raw-activation
- model = basic_pitch/saved_models/icassp_2022/nmp.onnx
- horizon_seconds = 0.5
- pre_roll_seconds = 0.25
- onset_activation_threshold = 0.5
- note_activation_threshold = 0.3
- unexpected_pitch_policy = all_activated

500ms:
- correct_acceptance_rate = 0.0
- false_completion_rate = 0.0
- false_completion_rate_excluding_contaminated_negatives = 0.0
- missing_added_pitch_false_match_rate = 0.0
- semitone_confusion_false_match_rate = 0.0
- octave_confusion_false_match_rate = 0.0
```

Interpretation: the first Basic Pitch raw-activation pass proves the desired
provider boundary, not product quality. It bypasses MIDI decoding and projects
raw `onset`/`note` activations onto expected pitches; NoteVerse still owns
MATCH/PARTIAL/MISMATCH evaluation. However, treating every activated non-target
pitch as an observed extra note made the benchmark answer the wrong first
question: generic raw activations include harmonics and neighboring notes that
can turn a target-positive attempt into a false MISMATCH. For this provider line,
`unexpected_evidence` should remain diagnostic by default; STEP target
progression experiments should first measure expected-pitch evidence only.

Basic Pitch raw activation DEV selection and held-out check:

```text
DEV selection:
- dataset = PianoVAM v1.0 / 2024-02-14_19-10-09
- manifest = data/work/datasets/pianovam-v1.0/pianovam_basic_pitch_activation_dev_selection.json
- selected_source_group_count = 24
- excluded_source_group_count = 120 from pianovam_p3_v1_selection.json
- require_no_subsequent_strike = true
- horizon_seconds = 0.5

DEV threshold scan, expected_only policy:
- strict onset/note = 0.5 / 0.3:
  correct_acceptance_rate = 0.5
  false_completion_rate = 0.0417
  false_completion_rate_excluding_contaminated_negatives = 0.0417
  octave_confusion_false_match_rate = 0.0833
- mid onset/note = 0.35 / 0.25:
  correct_acceptance_rate = 0.5
  false_completion_rate = 0.0694
  false_completion_rate_excluding_contaminated_negatives = 0.0694
  octave_confusion_false_match_rate = 0.0833
- loose onset/note = 0.25 / 0.2:
  correct_acceptance_rate = 0.5417
  false_completion_rate = 0.0972
  false_completion_rate_excluding_contaminated_negatives = 0.0972
  octave_confusion_false_match_rate = 0.1667

Held-out frozen P3 check, strict expected_only policy:
- MAESTRO official test / P3 v1 manifest:
  selected_source_group_count = 120
  correct_acceptance_rate = 0.5083
  false_completion_rate = 0.0694
  false_completion_rate_excluding_contaminated_negatives = 0.0262
  missing_added_pitch_false_match_rate = 0.025
  semitone_confusion_false_match_rate = 0.05
  octave_confusion_false_match_rate = 0.1333
- PianoVAM / P3 v1 manifest:
  selected_source_group_count = 120
  correct_acceptance_rate = 0.3667
  false_completion_rate = 0.0667
  false_completion_rate_excluding_contaminated_negatives = 0.0289
  missing_added_pitch_false_match_rate = 0.025
  semitone_confusion_false_match_rate = 0.0083
  octave_confusion_false_match_rate = 0.1667
```

Interpretation: Basic Pitch raw activation is a useful deployable evidence
frontend candidate, but it is not yet safe enough for STEP progression. The DEV
scan shows that lowering thresholds mostly trades a small recall gain for higher
counterfactual completion risk; the strict expected-only candidate is the best
current point on the false-advance-first curve. The held-out results confirm a
real octave-confusion problem, especially on PianoVAM. Do not wire this provider
into production progression until octave rejection and chord-tone evidence are
improved and revalidated on separate DEV/TEST selections.

Interpretation:

- The first score-conditioned oracles and bounded providers support the
  benchmark direction but do not yet prove STEP product safety. They use
  paired-MIDI anchors and therefore cannot claim `product_false_advance_rate`.
- The PianoVAM octave counterfactual false matches are the first concrete signal
  that octave confusion needs to remain a first-class safety fixture in bounded
  STEP evaluation.
- Bounded first-gesture acceptance is slightly lower than full-transcript oracle
  acceptance, which is expected because late or missing first gestures no longer
  get repaired by global assignment.
- Transcript shadow-runtime acceptance is closer to the full-transcript oracle,
  but its false-completion rate grows as the wait horizon grows. This shows why
  STEP microphone policy must treat waiting-window length as a safety parameter:
  a longer window can recover more correct attempts, but it also gives later
  unrelated gestures more chances to falsely complete a wrong expected target.
- `target-conditioned-dsp-v1` is useful as a benchmark boundary but is not a
  viable production recognizer. Its causal audio-window false completion rate is
  far above the STEP safety bar, and octave counterfactuals are especially weak.
  Do not wire this provider into production progression without a substantially
  stronger expected-pitch evidence model and fixture-proven octave rejection.
- The next benchmark direction is a deployable raw-activation frontend plus
  ExpectedPracticeStrikeTargets, with DEV/TEST separation for any threshold or
  aggregation tuning. Basic Pitch raw activation is the first candidate in that
  direction.

Transkun V2 Aug benchmark status:

```text
environment:
- executed inside the long-lived practice-quality container
- transkun package = 2.0.1
- model checkpoint = models/checkpointMSimplerAug/checkpoint.pt
- model config = models/checkpointMSimplerAug/model.conf
- device = cpu in the current container
- setuptools is pinned below 81 in that container because Transkun 2.0.1 imports
  pkg_resources

MAESTRO official test / P3 v1 manifest:
- provider = transkun_v2_aug
- benchmark_scope = selected_truth_window_transcription
- selected_truth_group_count = 120
- predicted_group_count = 419
- unassigned_predicted_group_count_in_selected_windows = 1
- onset_group_recall = 0.975
- expected_strike_recall = 0.9635
- predicted_strike_precision = 0.9888
- false_discovery_rate = 0.0112
- exact_group_match_rate = 0.9167
- chord_complete_detection_rate = 0.9176
- median_abs_onset_error_seconds = 0.003125

PianoVAM / P3 v1 manifest:
- provider = transkun_v2_aug
- benchmark_scope = selected_truth_window_transcription
- selected_truth_group_count = 120
- predicted_group_count = 3313
- unassigned_predicted_group_count_in_selected_windows = 3
- onset_group_recall = 0.9
- expected_strike_recall = 0.9054
- predicted_strike_precision = 0.9795
- false_discovery_rate = 0.0205
- exact_group_match_rate = 0.7333
- chord_complete_detection_rate = 0.7662
- median_abs_onset_error_seconds = 0.003646
```

Interpretation:

- Transkun V2 Aug is a credible high-accuracy offline AMT reference on both the
  MAESTRO official test sample and the PianoVAM amateur-practice sample.
- PianoVAM is meaningfully harder than MAESTRO for exact group and chord
  completion, which supports keeping it as a cross-domain holdout.
- These numbers are not directly comparable to FFT oracle-onset metrics because
  Transkun owns full transcription while FFT is given paired-MIDI onset windows.
- Transkun should remain a benchmark/reference provider for now. It is not a
  production STEP runtime dependency until deployment, latency, and license
  constraints are separately evaluated.

Basic Pitch ONNX benchmark status:

```text
environment:
- executed inside the same long-lived practice-quality container
- basic-pitch package = 0.4.0
- model serialization = onnx
- model path = bundled ICASSP 2022 ONNX model from the basic-pitch package
- onnxruntime package = 1.29.0
- resampy package = 0.4.2
- device = cpu in the current container
- installed with explicit lightweight dependencies because the normal
  basic-pitch dependency resolver path is not clean on the current Python 3.12
  container

MAESTRO official test / P3 v1 manifest:
- provider = basic_pitch
- provider_version = 0.4.0-onnx-resampy0.4.2
- benchmark_scope = selected_truth_window_transcription
- selected_truth_group_count = 120
- predicted_group_count = 344
- unassigned_predicted_group_count_in_selected_windows = 3
- onset_group_recall = 0.8833
- expected_strike_recall = 0.5839
- predicted_strike_precision = 0.7843
- false_discovery_rate = 0.2157
- exact_group_match_rate = 0.2583
- chord_complete_detection_rate = 0.2941
- median_abs_onset_error_seconds = 0.005777

PianoVAM / P3 v1 manifest:
- provider = basic_pitch
- provider_version = 0.4.0-onnx-resampy0.4.2
- benchmark_scope = selected_truth_window_transcription
- selected_truth_group_count = 120
- predicted_group_count = 3104
- unassigned_predicted_group_count_in_selected_windows = 5
- onset_group_recall = 0.8417
- expected_strike_recall = 0.627
- predicted_strike_precision = 0.8406
- false_discovery_rate = 0.1594
- exact_group_match_rate = 0.25
- chord_complete_detection_rate = 0.2857
- median_abs_onset_error_seconds = 0.005872
```

Interpretation:

- Basic Pitch ONNX is usable as a reproducible offline selected-window
  benchmark provider in the current container, but it is not the strongest
  observed candidate on the current P3 v1 frozen selections.
- Its onset timing is reasonably close once a truth group is matched, but the
  current default thresholds miss many expected strikes and produce much weaker
  chord completion than Transkun V2 Aug.
- These results should not be used to tune Basic Pitch thresholds against the
  same P3 v1 manifests and then claim held-out improvement. If Basic Pitch is
  revisited, tune on a separate dev selection and reserve held-out manifests for
  final comparison.
- Basic Pitch should remain a comparison provider, not a production STEP
  dependency, unless later score-conditioned benchmarks show a clear product
  advantage under the false-advance-first safety bar.

Aria-AMT benchmark status:

```text
environment:
- executed inside the long-lived `noteverse-aria-amt-gpu-bench-shm` container
- python = 3.11.16
- torch package = 2.5.0+cu124
- torchaudio package = 2.5.0+cu124
- device = NVIDIA GeForce RTX 4080 Laptop GPU
- aria-amt commit = a1ab73fc901d1759ec3bc173c146b3c6a3040261
- aria-utils commit = 4ed0749d2d70918610f03a5316bf283479ff9d09
- model = piano-medium-double-1.0.safetensors
- container-local compatibility patch =
  `backend/scripts/patch_aria_amt_soundfile_reader.py`
```

The compatibility patch is required in the current benchmark container because
Aria-AMT 0.0.1 reads WAV segments through `torchaudio.io.StreamReader`, while
the Debian trixie image exposes FFmpeg 7 and torchaudio 2.5 searches for older
FFmpeg extension variants. The patch changes only the WAV segmentation adapter
to a `soundfile` reader. It does not change model weights, inference, decoding,
or MIDI post-processing, so Aria-AMT results remain benchmark-provider results
rather than a NoteVerse algorithm variant.

MAESTRO official test / P3 v1 manifest:

```text
- provider = aria_amt
- provider_version = a1ab73fc-medium-double-piano-medium-double-1.0
- benchmark_scope = selected_truth_window_transcription
- selected_truth_group_count = 120
- predicted_group_count = 423
- unassigned_predicted_group_count_in_selected_windows = 2
- onset_group_recall = 0.975
- expected_strike_recall = 0.9526
- predicted_strike_precision = 0.9775
- false_discovery_rate = 0.0225
- exact_group_match_rate = 0.8667
- chord_complete_detection_rate = 0.8824
- median_abs_onset_error_seconds = 0.004375
```

PianoVAM / P3 v1 manifest:

```text
- provider = aria_amt
- provider_version = a1ab73fc-medium-double-piano-medium-double-1.0
- benchmark_scope = selected_truth_window_transcription
- selected_truth_group_count = 120
- predicted_group_count = 3386
- unassigned_predicted_group_count_in_selected_windows = 5
- onset_group_recall = 0.9333
- expected_strike_recall = 0.9081
- predicted_strike_precision = 0.9655
- false_discovery_rate = 0.0345
- exact_group_match_rate = 0.75
- chord_complete_detection_rate = 0.7273
- median_abs_onset_error_seconds = 0.005312
```

Interpretation:

- Aria-AMT is a credible high-accuracy offline AMT reference in the current
  selected-window benchmark. It substantially outperforms Basic Pitch ONNX and
  lands close to Transkun V2 Aug on expected-strike recall.
- Transkun V2 Aug remains the stronger current reference on MAESTRO chord
  completion and selected-window false-discovery rate. Aria-AMT is slightly
  ahead on PianoVAM onset-group recall but behind on chord completion and
  false-discovery rate.
- Aria-AMT should remain a benchmark/reference provider until license,
  deployment, latency, memory, streaming, and score-conditioned behavior are
  separately evaluated.

Current selected-window provider comparison on the same P3 v1 frozen
manifests:

```text
MAESTRO official test:
- Transkun V2 Aug: expected_strike_recall 0.9635,
  predicted_strike_precision 0.9888, false_discovery_rate 0.0112,
  chord_complete_detection_rate 0.9176
- Basic Pitch ONNX: expected_strike_recall 0.5839,
  predicted_strike_precision 0.7843, false_discovery_rate 0.2157,
  chord_complete_detection_rate 0.2941
- Aria-AMT medium-double: expected_strike_recall 0.9526,
  predicted_strike_precision 0.9775, false_discovery_rate 0.0225,
  chord_complete_detection_rate 0.8824

PianoVAM:
- Transkun V2 Aug: expected_strike_recall 0.9054,
  predicted_strike_precision 0.9795, false_discovery_rate 0.0205,
  chord_complete_detection_rate 0.7662
- Basic Pitch ONNX: expected_strike_recall 0.627,
  predicted_strike_precision 0.8406, false_discovery_rate 0.1594,
  chord_complete_detection_rate 0.2857
- Aria-AMT medium-double: expected_strike_recall 0.9081,
  predicted_strike_precision 0.9655, false_discovery_rate 0.0345,
  chord_complete_detection_rate 0.7273
```

This comparison supports keeping Transkun V2 Aug as the current offline
accuracy-reference provider, Aria-AMT as a strong secondary reference, and Basic
Pitch as a reproducible lower-cost comparison provider. None of these results
change the production runtime boundary:
`STEP_BY_STEP + MICROPHONE` still needs score-conditioned, false-advance-first
benchmarks before any acoustic provider is promoted.

Full-AMT survey is now frozen for P3 v1. Do not add hFT, MT3, Kong, or Essentia
unless a later score-conditioned product benchmark exposes a specific failure
that Transkun V2 Aug and Aria-AMT cannot explain. The next work belongs to
positive/negative STEP fixtures and bounded-context safety evaluation.

The previous local product-specific paired fixture priority remains:

1. Add the first paired MIDI + microphone ground-truth fixture matrix. The
   fixture contract now lives in
   `backend/tests/fixtures/practice_audio/paired_ground_truth_manifest.json`.
   Start with the C-E-G omission matrix so false chord completion is measured
   before another model is integrated.
2. Keep `TargetConditionedPianoObserver` as the handcrafted DSP benchmark
   baseline and proof of the score-conditioned provider contract.
3. Keep the exported-MIDI AMT oracle provider as an
   `offline_score_aligned_oracle` only. It establishes an offline accuracy
   ceiling without changing production runtime behavior or making causal
   progression claims.
4. After paired ground truth exists, do not keep expanding the full-AMT shootout
   list by default. Basic Pitch, Transkun, and Aria-AMT now have first P3 v1
   selected-window reference results; additional providers require a bounded
   STEP benchmark failure that the current references cannot explain.
5. Run score-conditioned positive/counterfactual-negative comparisons with the
   same evaluator and ExpectedPracticeStrikeTargets, so model quality and
   score-prior benefit stay separable. The first offline full-transcript oracle
   and bounded first-gesture transcript benchmark are implemented; causal
   bounded provider/runtime evaluation is still required before reporting
   product false advance.
6. Reopen additional acoustic-provider comparisons only after bounded STEP
   evaluation exposes a specific failure that the current references and
   handcrafted baseline cannot explain.

Tasks:

1. Keep the current dominant-peak acoustic observer as a baseline only.
2. Add fixture-driven tests for polyphonic/chord evidence.
3. Evaluate whether chroma, multi-peak FFT, or a lightweight onset/pitch stack
   can improve chord evidence without pretending to be full AMT.
4. Keep MIDI as the high-confidence path for strict chord correctness.
5. Restore real-recording step-by-step follow progress against the revised Once
   Again score before increasing microphone user-facing claims. The current
   complete-recording fixture should move from `known_gap` to `required` only
   after it advances through a meaningful score region, not merely after startup.

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
5. Add evidence-quality gates and improve MIDI evaluator detail before showing
   stricter timing or accuracy claims.
6. Improve microphone recognition after more fixtures exist; keep microphone
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
4. **Done: Browser-validate historical saved replay playback.**
   Browser validation confirmed that microphone and MIDI Performance reports can
   load saved replay metadata after leaving the page, request a click-time
   playback URL, and replay with the same score cursor projection as immediate
   local replay.
5. **P1: Split Performance result availability.**
   Read models and UI should distinguish local replay available now, saved
   replay available historically, summary available, and optional evaluation
   available. Current status: backend exposes `saved_replay_available` and
   `evaluation_available` separately for Performance reports, Saved Performance
   history is artifact-driven, and Customer Web keeps local replay and historical
   saved replay as separate playback sources. Continue hardening the central
   evaluation predicate and UI presentation so missing evidence is not rendered
   as zero-error analysis.
6. **Done: Implement `STEP_BY_STEP` skip.**
   Customer Web now exposes skip only during active step-by-step sessions. The
   backend owns the command, advances exactly one current expected group, and
   persists a neutral skipped attempt that is excluded from scoring while
   remaining available as a skipped-count fact.
7. **P2: Improve evaluation only after report facts are trustworthy.**
   Evidence availability is now gated as a public capability and MIDI evaluator
   V1 has explicit assignment, simultaneity, and repeated-extra semantics.
   Dense adjacent-event regression coverage is now in place. Continue with
   fixture-backed MIDI tuning against real recordings and microphone evidence
   work. The next microphone priority is to make the revised Once Again
   real-recording fixtures advance reliably, then promote those scenarios from
   `known_gap` to `required`. Delay exact timing/microphone accuracy claims until
   timebase, latency, and fixture evidence are strong enough. Do not present
   millisecond-level timing verdicts until browser input origin and backend
   clock origin are explicitly synchronized or calibrated.
8. **P3.1: Freeze microphone benchmark before changing the production observer.**
   The replay diagnostic script now emits a benchmark summary with the P3 metric
   priority, evidence-quality metrics, product-behavior metrics, and internal
   diagnostic reason counts. Continue by adding the remaining octave-confusion,
   rolled-chord, and repeated-attack fixtures, then compare any
   target-conditioned observer against the same manifest before promoting it.
   Current status: the microphone capability matrix now covers real single-note
   matching, synthetic rolled-chord accumulation, conservative simultaneous
   chord and octave-mixture non-support, and repeated same-pitch attempts after a
   release boundary. Attempt diagnostics now distinguish `display_target` from
   `evaluated_target`: after an accepted match, the displayed anchor may already
   be the next target, while the evaluated target is the group that was just
   accepted. `AcousticEvidenceProvider` is now the benchmark contract for
   score-conditioned acoustic candidates: providers emit expected-pitch evidence
   and never own `MATCH` semantics. An experimental
   `TargetConditionedPianoObserver` implements this contract as a benchmark-only
   DSP baseline for per-expected-pitch spectral activation; it is intentionally
   not the production observer yet. The replay diagnostic script can now replay
   the same resolved attempt windows through that candidate and emit a separate
   `candidate_benchmarks.target_conditioned_dsp_v1` summary next to the current
   baseline summary.

   Current `Once Again.wav` benchmark result:

   ```text
   baseline dominant observer:
   - starts successfully;
   - advances through the opening four sixteenth-note targets;
   - remains a known gap for stable follow progress;
   - full-recording alignment_advance is still 0.75 beat against the current
     min_alignment_advance 8.0 expectation;
   - reports false extra pitches around the second-measure first-beat chord.

   target_conditioned_dsp_v1:
   - does not produce false matches in the current observer-window fixture run;
   - reduces false extra-pitch evidence in the measured attempt windows;
   - slightly improves expected-strike recall on some mixed scenarios;
   - still fails to fully confirm the A5/D4/A4 chord at measure 2 beat 1;
   - increases UNCERTAIN/PARTIAL outcomes rather than solving progression.

   causal_shadow_runtime_replay:
   - runs as an independent benchmark-only progression experiment;
   - current full-recording run produced 29 resolved attempts;
   - expected-strike recall is 0.3766;
   - chord-complete detection is 0.0833;
   - false-advance guard count is 0 in the current run;
   - still does not meet production quality for STEP microphone chord following.
   ```

   Therefore `target_conditioned_dsp_v1` remains a useful benchmark candidate,
   not a production replacement. The next recognition work should improve
   expected-pitch activation quality for real piano chords, especially upper
   chord tones and octave-confusion cases, before considering runtime wiring.
   The diagnostic script now labels benchmark summaries with `benchmark_scope`.
   The candidate summary is `observer_window_replay`, so its metrics describe
   per-window evidence quality only. A separate `causal_shadow_runtime_replay`
   experiment now scans audio with candidate-owned fixed windows, starts and
   resolves its own attempts, and advances only on candidate MATCH decisions.
   This makes end-to-end comparison possible without wiring the candidate into
   production. It is still benchmark-only: its fixed window/hop/timeout
   parameters are diagnostic scaffolding, not user-facing runtime policy.

9. **P3.2: Stop optimizing legacy Matchmaker startup before acoustic frontend work.**
   The cold/warm causal replay comparison now shows:

   ```text
   cold ATTACK_MISSED = 6
   warm ATTACK_MISSED = 0

   cold PITCH_FALSE_NEGATIVE = 12
   warm PITCH_FALSE_NEGATIVE = 12
   ```

   This isolates two concerns. The cold-start first-strike loss belongs to the
   current Matchmaker startup/runtime integration and should be recorded as a
   known legacy limitation, not used as the next microphone recognition tuning
   target. Acoustic frontend experiments must run with `startup_mode = warm` so
   they answer the narrower product question:

   ```text
   System is ready.
   Current expected pitches are known.
   Did the user's new physical strike satisfy those expected pitches?
   ```

   Do not continue by adding pre-start audio buffering, changing the startup
   feature window, tuning the start scorer, changing OLTW/start-queue behavior,
   or designing a new first-strike lifecycle in Matchmaker. Keep startup safety
   regressions as guardrails, but move recognition work to warm-start acoustic
   evidence comparison.

   A new diagnostic script compares frontends on the same frozen public causal
   cases without changing production progression:

   ```text
   backend/scripts/compare_step_microphone_frontends_causal_cases.py
   ```

   Initial 59-case MAESTRO warm-start comparison used 350ms horizon max pooling
   and was then corrected to strike-local evidence. Raw activation benchmark
   semantics are now:

   ```text
   bounded causal prefix:
   case start -> target + 350ms

   evidence pooling:
   target - 50ms -> target + 120ms
   ```

   MIDI target onset is used only as an offline benchmark anchor. It is not
   visible to production runtime or recognizer decisions.

   Current temporal-local 59-case MAESTRO warm-start comparison after benchmark
   integrity fixes:

   ```text
   production FFT observer:
   - correct single acceptance = 4/8
   - correct chord complete acceptance = 0/8
   - wrong semitone false completion = 0/8
   - wrong octave false completion = 0/8
   - missing-note false completion = 0/8
   - same-note retrigger acceptance = 0/3

   Basic Pitch raw onset/frame activation:
   - correct single acceptance = 8/8
   - correct chord complete acceptance = 5/8
   - wrong semitone false completion = 0/8
   - wrong semitone false completion, excluding future-target contamination = 0/5
   - wrong octave false completion = 0/8
   - missing-note false completion = 0/8
   - missing-note false completion, excluding future-target contamination = 0/8
   - same-note retrigger acceptance = 3/3
   - no local model-frame cases = 0/59

   ByteDance/Kong high-resolution piano transcription raw activation:
   - correct single acceptance = 8/8
   - correct chord complete acceptance = 7/8
   - wrong semitone false completion = 0/8
   - wrong semitone false completion, excluding future-target contamination = 0/5
   - wrong octave false completion = 0/8
   - missing-note false completion = 0/8
   - missing-note false completion, excluding future-target contamination = 0/8
   - same-note retrigger acceptance = 3/3
   - no local model-frame cases = 0/59
   ```

   The earlier 3/8 semitone completions for both pretrained frontends came from
   temporal pooling across the full 350ms horizon: the counterfactual expected
   pitch appeared later inside the horizon. Under strike-local pooling those
   false completions disappear. Therefore this benchmark must keep both the
   bounded prefix and the local evidence window explicit.

   Benchmark integrity rules are now:

   - If a model has no frame inside `target - 50ms -> target + 120ms`, the
     pitch/case is marked `NO_LOCAL_MODEL_FRAMES` and cannot be accepted.
     The benchmark must not silently fall back to whole-clip pooling.
   - For counterfactual negative cases, future-target contamination is computed
     from `expected_pitches - actual_pitches_at_target`. In a missing-chord
     case such as `actual = C4`, `expected = C4 + E4`, future C4 is not
     contamination; future E4 is.
   - Reports include onset-coupled diagnostics (`frame_at_onset_peak` and
     nearby frame max), but those diagnostics do not change the current fixed
     threshold acceptance rule.
   - Source identity for future calibration/evaluation splitting is
     `source_audio_sha256`; source file and MIDI hashes are retained only as
     traceability metadata.

   The corrected contamination definition changes missing-chord clean negatives
   from `0/3` to `0/8`: the earlier clean count was too small because the
   benchmark excluded cases where the future note matched an actually played
   target tone instead of only excluding future counterfactual missing tones.
   Positive onset peaks are not clustered at either local-window boundary:
   Basic Pitch has 0 near-left and 0 near-right boundary peaks, and ByteDance
   has 0 near-left and 0 near-right boundary peaks.

   The current evidence says production FFT is the first bottleneck for chord
   recall and retrigger recognition. Basic Pitch retains strong single/retrigger
   recall but drops to 5/8 chord completion under local evidence. ByteDance/Kong
   keeps stronger chord evidence at 7/8, but it is piano-specific and
   bidirectional, so this benchmark is bounded causal-prefix, not true streaming
   causal runtime.

   Calibration/evaluation split status: the current 59 cases all come from one
   MAESTRO source audio SHA, so they are not sufficient for a disjoint
   calibration/evaluation split. Future calibration work must group by source
   performance/recording so derived positive and counterfactual cases from the
   same physical strike never cross split boundaries.

   Multi-source expansion status:

   ```text
   source performances = 8 MAESTRO test recordings
   total cases = 128
   cases per source = 16
   source identity = source_audio_sha256
   startup_mode = warm
   local window = target - 50ms -> target + 120ms
   decision horizon = 350ms
   thresholds = unchanged
   ```

   Aggregate results:

   ```text
   Basic Pitch raw activation:
   - correct single acceptance = 16/16
   - correct chord complete acceptance = 10/16
   - wrong semitone false completion = 3/16
   - wrong semitone false completion, clean = 0/10
   - wrong octave false completion = 1/16
   - wrong octave false completion, clean = 1/15
   - missing-note false completion = 2/16
   - missing-note false completion, clean = 0/13
   - same-note retrigger acceptance = 9/16
   - no local model-frame cases = 0/128

   ByteDance/Kong high-resolution piano transcription raw activation:
   - correct single acceptance = 16/16
   - correct chord complete acceptance = 15/16
   - wrong semitone false completion = 3/16
   - wrong semitone false completion, clean = 0/10
   - wrong octave false completion = 0/16
   - wrong octave false completion, clean = 0/15
   - missing-note false completion = 2/16
   - missing-note false completion, clean = 0/13
   - same-note retrigger acceptance = 13/16
   - no local model-frame cases = 0/128
   ```

   Interpretation: ByteDance/Kong's chord advantage persists across multiple
   independent performances (`15/16` vs Basic Pitch `10/16`) and its per-source
   chord rate is more stable (min `1/2`, median `2/2`, max `2/2`) than Basic
   Pitch (min `0/2`, median `1/2`, max `2/2`). Clean semitone and clean
   missing-note safety hold for both pretrained frontends, but Basic Pitch now
   shows one clean octave false completion (`1/15`) while ByteDance/Kong remains
   at `0/15`. The 8 independent source audio SHAs are enough to create a
   source-level calibration/evaluation split, but thresholds must still not be
   tuned on this same aggregate result and reported as held-out performance.

   The accepted 8-source / 128-case set is now frozen as:

   ```text
   data/work/datasets/maestro-v3.0.0/production_step_development_set
   role = development_set
   ```

   It must not be used as held-out evaluation because its results have already
   been inspected and used for frontend selection.

   Source-disjoint research sets:

   ```text
   calibration_set
   path = data/work/datasets/maestro-v3.0.0/production_step_calibration_set
   source_count = 4
   case_count = 64
   selection = seeded_diverse
   seed = 20260912

   frozen_evaluation_set
   path = data/work/datasets/maestro-v3.0.0/production_step_frozen_evaluation_set
   source_count = 4
   case_count = 62
   selection = seeded_diverse
   seed = 20260913
   ```

   Source identity is `source_audio_sha256`. The three sets are mutually
   disjoint:

   ```text
   development_set ∩ calibration_set = 0
   development_set ∩ frozen_evaluation_set = 0
   calibration_set ∩ frozen_evaluation_set = 0
   ```

   The frozen evaluation set has only provenance and case counts recorded. No
   Basic Pitch, ByteDance/Kong, threshold, or policy result has been run or
   inspected for that set.

   First simple global calibration grid, using only development + calibration:

   ```text
   Basic Pitch best zero-clean-negative rule:
   - positive recall = 41/72
   - clean negative false completion = 0/61
   - correct chord = 7/24
   - correct single = 20/24
   - retrigger = 14/24

   ByteDance/Kong best zero-clean-negative rule:
   - positive recall = 55/72
   - clean negative false completion = 0/61
   - correct chord = 18/24
   - correct single = 20/24
   - retrigger = 17/24
   ```

   The current best ByteDance/Kong rule uses:

   ```text
   frame_key = frame_activation
   target_onset_min = 0.1
   target_frame_min = 0.05
   semitone_onset_margin_min = -0.2
   octave_onset_margin_min = -0.2
   chord_onset_time_spread_max_ms = 80
   ```

   This is a research candidate, not a production policy. If the policy is
   frozen after calibration review, run the frozen evaluation set once and do
   not tune parameters from its result.

   Robustness audit on the 12 non-frozen sources (`development_set +
   calibration_set`) keeps the same policy grid and does not run frozen
   evaluation:

   ```text
   leave-one-source-out:
   - folds = 12
   - selected policy unique count = 2
   - 11/12 folds select:
     frame_key = frame_activation
     target_onset_min = 0.1
     target_frame_min = 0.05
     semitone_onset_margin_min = -0.2
     octave_onset_margin_min = -0.2
     chord_onset_time_spread_max_ms = 80
   - 1/12 folds selects the same policy except semitone margin = 0.0

   best balanced objective on all non-frozen sources:
   - positive recall = 55/72
   - balanced positive recall = min(single, chord, retrigger) = 17/24
   - clean negative false completion = 0/61
   ```

   Ablation of the current best ByteDance/Kong rule:

   ```text
   full rule:
   - single = 20/24
   - chord = 18/24
   - retrigger = 17/24
   - clean semitone/octave/missing false = 0/18, 0/23, 0/20

   without semitone margin:
   - single = 20/24
   - chord = 19/24
   - retrigger = 17/24
   - clean semitone/octave/missing false = 0/18, 0/23, 0/20

   without octave margin:
   - single = 20/24
   - chord = 18/24
   - retrigger = 18/24
   - clean semitone/octave/missing false = 0/18, 0/23, 0/20

   without both competitor margins:
   - single = 20/24
   - chord = 19/24
   - retrigger = 18/24
   - clean semitone/octave/missing false = 0/18, 0/23, 0/20

   without chord timing spread:
   - same as full rule on this data
   ```

   Interpretation: the current `-0.2` semitone/octave competitor margins are
   not providing useful discrimination on the 12-source research data. Removing
   them does not increase clean negative false completion and slightly improves
   positive recall. Chord timing spread is also not active for the current
   selected policy because disabling it produces the same result. This means the
   evidence supports a simpler candidate than the original margin-based rule.

   Balanced plateau definition:

   ```text
   clean_negative_false.accepted == 0
   and
   correct_single, correct_chord, retrigger
   each trail the balanced-best policy by <= 1 case
   ```

   This replaces the earlier aggregate-positive `<= 2 cases` plateau rule. The
   older rule was too loose because it could hide a regression concentrated in
   one positive family.

   Canonical simplified ByteDance/Kong candidate, evaluated on the 12
   non-frozen sources only:

   ```text
   frame_key = frame_activation
   target_onset_min = 0.1
   target_frame_min = 0.05
   semitone_onset_margin_min = disabled
   octave_onset_margin_min = disabled
   chord_onset_time_spread_max_ms = disabled

   correct single = 20/24
   correct chord = 19/24
   retrigger = 18/24
   clean semitone false = 0/18
   clean octave false = 0/23
   clean missing false = 0/20
   clean negative false, aggregate = 0/61
   ```

   Per-source clean negative false completion is `0` on all 12 non-frozen
   source recordings. Two source recordings remain weak on positives, but those
   failures are not introduced by the simplified policy; they reflect source- or
   frontend-level recall limits.

   Balanced onset/frame-only plateau:

   ```text
   policy_count = 90
   target_onset_min range = 0.1 -> 0.6
   target_frame_min range = 0.05 -> 0.4
   frame_key distribution:
     frame_activation = 30
     frame_at_onset_peak = 30
     frame_max_near_onset_peak = 30
   ```

   The simplified candidate is not an isolated parameter point. A broad family
   of onset/frame-only policies keeps clean negative false completion at zero
   while staying within one case of the balanced-best policy for single, chord,
   and retrigger acceptance.

   Frozen policy candidate:

   ```text
   FROZEN_POLICY_CANDIDATE
   frontend = ByteDance/Kong high-resolution piano transcription
   frame_key = frame_activation
   target_onset_min = 0.2
   target_frame_min = 0.2
   semitone margin = none
   octave margin = none
   chord timing spread = none
   ```

   Rationale:

   - It uses only target onset/frame evidence.
   - It avoids competitor margins and chord timing spread because the 12-source
     audit did not show discrimination value from those extra conditions.
   - It has zero clean negative false completion on every non-frozen source.
   - It is inside a broad balanced plateau rather than being a narrow optimum.
   - It has equal or better positive acceptance than the previous margin-based
     best rule on the non-frozen data.
   - It was selected by deterministic tie-break from the exact same-score
     onset/frame-only policies: among `frame_activation` policies tied at
     `single = 20/24`, `chord = 19/24`, `retrigger = 18/24`, and clean negative
     false `0/61`, `0.2 / 0.2` is closer to the existing grid midpoint than
     `0.1 / 0.05`.

   Frozen artifact:

   ```text
   data/work/datasets/maestro-v3.0.0/step_microphone_bytedance_frozen_policy.json
   status = frozen_before_evaluation
   checkpoint_sha256 = c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141
   ```

   This policy is frozen for research evaluation. Do not tune it from the frozen
   set.

   Frozen evaluation was run exactly once with the frozen artifact:

   ```text
   report = data/work/datasets/maestro-v3.0.0/production_step_frozen_evaluation_set/frozen_bytedance_policy_evaluation_report.json

   correct single = 7/8
   correct chord = 7/8
   retrigger = 8/8

   clean semitone false = 0/7
   clean octave false = 0/5
   clean missing false = 0/7
   NO_LOCAL_MODEL_FRAMES = 0/62
   ```

   Raw negative false completions before contamination filtering were
   `wrong_semitone = 1/8` and `wrong_octave = 1/8`, but both were marked
   contaminated under the benchmark's counterfactual-future-note policy. Clean
   false completion stayed at zero for all three negative families.

   Go/no-go: this is a `go` for the next research phase. The pretrained
   ByteDance/Kong frontend plus a simple target onset/frame policy generalizes
   well enough on frozen public paired data to justify streaming/runtime
   feasibility work. Do not adjust thresholds from this result. The next phase
   should test whether equivalent evidence can be made usable in the actual STEP
   runtime constraints; if streaming feasibility fails, return to new
   calibration data or tiny target-conditioned verifier research rather than
   retuning on this frozen set.

   Research provenance hardening:

   ```text
   tracked policy copy =
   backend/research/policies/step_microphone_bytedance_v1.json

   copied_after_frozen_evaluation_for_reproducibility = true
   not_pre_evaluation_git_registration = true
   ```

   The tracked copy is intentionally not described as preregistration. Policy
   identity is provider/model id, checkpoint SHA256, frame key, thresholds,
   local window, and decision horizon, not the machine-local checkpoint path.
   The frozen evaluator now checks the actual checkpoint SHA256 and fails if the
   artifact asks for unsupported semantics. Current supported semantics are:

   ```text
   frame_key = frame_activation
   competitor margins = disabled
   chord timing spread = disabled
   ```

   First runtime-feasibility experiment, future-context dependency on
   development + calibration only:

   ```text
   report =
   data/work/datasets/maestro-v3.0.0/bytedance_future_context_dependency.gpu.json

   policy = frozen ByteDance/Kong v1
   thresholds = unchanged
   prefixes = target + 80, 120, 160, 220, 350 ms
   reference = target + 350 ms
   local evidence window = target - 50 ms -> target + 120 ms
   case_count = 192
   inference_count per prefix = 264
   ```

   GPU full dev+cal result:

   ```text
   +80ms:
     decision agreement vs +350ms = 185/192
     correct single/chord/retrigger = 20/24, 16/24, 18/24
     clean negative false = 1/61
     mean inference wall time = 1479.894 ms

   +120ms:
     decision agreement vs +350ms = 188/192
     correct single/chord/retrigger = 20/24, 18/24, 18/24
     clean negative false = 1/61
     mean inference wall time = 1530.267 ms

   +160ms:
     decision agreement vs +350ms = 191/192
     correct single/chord/retrigger = 20/24, 18/24, 18/24
     clean negative false = 0/61
     mean inference wall time = 1571.249 ms

   +220ms:
     decision agreement vs +350ms = 191/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean negative false = 0/61
     mean inference wall time = 1575.625 ms

   +350ms:
     decision agreement vs +350ms = 192/192
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean negative false = 0/61
     mean inference wall time = 1608.663 ms
   ```

   CPU latency was measured only on a deterministic 12-case feasibility sample,
   not as a full metric replacement:

   ```text
   report =
   data/work/datasets/maestro-v3.0.0/bytedance_future_context_dependency.cpu_sample.json

   mean inference wall time:
   +80ms = 4523.994 ms
   +120ms = 4547.991 ms
   +160ms = 4731.885 ms
   +220ms = 4712.776 ms
   +350ms = 4691.287 ms
   ```

   Correct interpretation:

   - This experiment measures the official
     `PianoTranscription.transcribe()` zero-padded bounded-prefix sensitivity,
     not strict streaming causality.
   - Under the official 10-second-zero-padded offline wrapper, replacing padded
     silence with real future audio beyond roughly `+160ms` rarely changes the
     frozen decision; this is not a true causal-context bound.
   - Inference latency is a major runtime blocker for the official wrapper:
     GPU bounded-prefix inference is about `1.5s` per target-group call in this
     research setup, and CPU is far outside interactive STEP requirements.
   - ByteDance/Kong should remain a strong representation teacher/reference for
     target-conditioned evidence, not a direct production runtime candidate yet.
   - Next research should focus on whether the useful onset/frame representation
     can be distilled, cached, streamed, or replaced by a lightweight verifier.
     Do not connect this model directly to production STEP progression.

   ByteDance/Kong wrapper decomposition, development + calibration deterministic
   12-case sample:

   ```text
   report GPU =
   data/work/datasets/maestro-v3.0.0/bytedance_wrapper_decomposition.gpu.json

   report CPU =
   data/work/datasets/maestro-v3.0.0/bytedance_wrapper_decomposition.cpu.json

   prefix = target + 350ms
   thresholds = frozen 0.2 / 0.2
   sample = deterministic first 12 development/calibration cases
   ```

   Four paths:

   ```text
   A. official PianoTranscription.transcribe()
      10s padded input
      Note_pedal(note + pedal)
      MIDI-event postprocessing

   B. same 10s padded input
      direct full model forward
      no RegressionPostProcessor / MIDI decoding

   C. same 10s padded input
      note_model only
      no pedal_model
      no postprocessing

   D. actual bounded prefix only
      note_model direct forward
      no 10s pad
      no pedal_model
      no postprocessing
   ```

   GPU result:

   ```text
   A official transcribe:
     mean / median / p95 = 1407.038 / 1381.918 / 1630.476 ms
     tensor fed = 10.0s
     output frames = 1001
     accepted = 7/12

   B direct full model, padded:
     mean / median / p95 = 1064.568 / 1064.477 / 1177.738 ms
     agreement with A = 12/12
     activation delta vs A = 0

   C note model only, padded:
     mean / median / p95 = 634.642 / 624.250 / 724.014 ms
     agreement with A = 12/12
     activation delta vs A = 0

   D note model only, actual prefix:
     mean / median / p95 = 108.370 / 102.807 / 134.427 ms
     tensor fed = 1.35s
     output frames = 136
     agreement with A = 12/12
     onset abs mean/max delta vs A = 0.009063 / 0.059875
     frame abs mean/max delta vs A = 0.023452 / 0.480104
   ```

   CPU result:

   ```text
   A official transcribe mean = 4921.033 ms
   B direct full model, padded mean = 4565.173 ms
   C note model only, padded mean = 2737.302 ms
   D note model only, actual prefix mean = 363.761 ms
   D agreement with A = 12/12
   ```

   Interpretation:

   - The official wrapper cost is not mostly MIDI postprocessing; removing
     postprocessing saves about `342ms` on GPU in this sample.
   - Removing the unused pedal model is much more meaningful, reducing padded
     GPU forward from about `1065ms` to about `635ms`.
   - The largest win comes from removing fixed 10s padding: note-only actual
     prefix forward is about `108ms` on GPU and `364ms` on CPU for this sample.
   - Actual-prefix note-only output changes raw activations, as expected because
     the BiGRU sequence boundary changes, but the frozen verifier decision still
     agreed with the official wrapper on all 12 sampled cases.
   - This keeps ByteDance/Kong viable as a research runtime candidate only if
     NoteVerse can call the note model directly on bounded prefixes or extract a
     lighter equivalent. The official `transcribe()` wrapper itself should not
     be wired into production STEP.

   Direct note-model actual-prefix frontend validation, full development +
   calibration benchmark:

   ```text
   report =
   data/work/datasets/maestro-v3.0.0/bytedance_direct_note_frontend_validation.gpu.json

   cases = 192
   source performances = 12
   target-group inferences = 264

   input = bounded prefix through target +350ms
   model = ByteDance note_model only
   no 10s padding
   no pedal_model
   no RegressionPostProcessor
   no MIDI decoding

   verifier:
   onset >= 0.2
   frame >= 0.2
   local evidence = target -50ms -> target +120ms
   ```

   This validation reuses the full case semantics:

   ```text
   all expected_groups
   all target_group_seconds
   actual_groups
   expected_advances
   future counterfactual contamination
   source identity
   case-level MATCH / acceptance
   ```

   The official-wrapper reference was not rerun. Existing development and
   calibration `frontend_comparison_report.json` files were read and rescored
   with the frozen `0.2 / 0.2` verifier.

   Aggregate result:

   ```text
   decision agreement with official +350ms frozen verifier = 192/192

   correct single = 20/24
   correct chord = 19/24
   retrigger = 18/24

   clean semitone false = 0/18
   clean octave false = 0/23
   clean missing false = 0/20
   clean negative false = 0/61

   NO_LOCAL_MODEL_FRAMES = 0/192
   disagreements = 0
   ```

   GPU latency:

   ```text
   note_model forward latency:
     mean = 119.999 ms
     median = 115.828 ms
     p95 = 155.951 ms

   target-evidence end-to-end latency:
     mean = 121.409 ms
     median = 117.205 ms
     p95 = 157.257 ms
   ```

   Per-source positives remain uneven for the same source recordings that were
   already weak under the official wrapper, but direct note-model does not add
   new clean false completions and does not introduce case-level disagreements.

   Updated conclusion:

   - Direct `note_model` actual-prefix inference preserves the official-wrapper
     frozen verifier decisions on the full non-frozen benchmark.
   - Positive recall does not drop relative to the official-wrapper frozen
     verifier.
   - No new clean false completions appear.
   - Runtime feasibility is materially better than the official wrapper:
     direct note-model target-evidence end-to-end GPU latency is roughly
     `120ms` mean / `157ms` p95 in this benchmark setup.
   - This is strong enough to enter the next bounded-prefix context experiment.
     Still do not connect it to production until streaming/chunking behavior,
     batching, memory behavior, and failure cases are tested under a runtime-like
     adapter.

   Direct note-model bounded-prefix context experiment:

   ```text
   report =
   data/work/datasets/maestro-v3.0.0/bytedance_direct_note_prefix_context.gpu.json

   cases = 192
   source performances = 12
   target-group inferences per prefix = 264

   model = ByteDance note_model only
   no 10s padding
   no pedal_model
   no RegressionPostProcessor
   no MIDI decoding

   verifier:
   onset >= 0.2
   frame >= 0.2
   local evidence = target -50ms -> target +120ms

   prefixes:
   target +120ms
   target +160ms
   target +190ms
   target +220ms
   target +350ms reference
   ```

   Context reason:

   ```text
   STFT window = 2048 samples @ 16kHz
   center = true
   half-window ~= 64ms

   local evidence ends at +120ms
   full real-audio support for the rightmost local frame begins around +184ms
   ```

   Therefore:

   ```text
   +120ms / +160ms:
     local-window right edge may depend on boundary padding

   +190ms / +220ms / +350ms:
     local-window STFT support is fully inside real observed audio
   ```

   Results:

   ```text
   +120ms:
     agreement vs +350ms = 190/192
     correct single/chord/retrigger = 20/24, 18/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     target-evidence end-to-end mean / median / p95 =
       89.021 / 85.647 / 130.329 ms
     estimated strike->decision mean / median / p95 =
       209.021 / 205.647 / 250.329 ms

   +160ms:
     agreement vs +350ms = 191/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     target-evidence end-to-end mean / median / p95 =
       92.451 / 85.920 / 137.929 ms
     estimated strike->decision mean / median / p95 =
       252.451 / 245.920 / 297.929 ms

   +190ms:
     agreement vs +350ms = 191/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     target-evidence end-to-end mean / median / p95 =
       101.279 / 93.984 / 143.426 ms
     estimated strike->decision mean / median / p95 =
       291.279 / 283.984 / 333.426 ms

   +220ms:
     agreement vs +350ms = 192/192
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     target-evidence end-to-end mean / median / p95 =
       101.054 / 88.135 / 165.457 ms
     estimated strike->decision mean / median / p95 =
       321.054 / 308.135 / 385.457 ms

   +350ms:
     agreement vs +350ms = 192/192
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     target-evidence end-to-end mean / median / p95 =
       107.192 / 102.228 / 155.333 ms
     estimated strike->decision mean / median / p95 =
       457.192 / 452.228 / 505.333 ms
   ```

   Disagreements:

   ```text
   +120ms:
     - s03_correct_chord_002:
       positive recall loss; E4 onset is 0.193972 at +120ms vs 0.810750 at
       +350ms, just below the frozen onset threshold.
     - s08_wrong_semitone_001:
       short prefix rejects while +350ms accepts. This does not create clean
       negative risk because the short prefix is safer than the reference.

   +160ms / +190ms:
     - s08_same_note_retrigger_002:
       positive recall loss. The second group's G3 onset is below threshold
       at short prefix but accepted at +350ms.

   +220ms:
     - no disagreements
   ```

   Interpretation:

   - `+190ms` is not fully decision-equivalent to `+350ms`; it still loses one
     retrigger positive.
   - `+220ms` is decision-equivalent to `+350ms` on this full non-frozen
     benchmark.
   - None of the shorter prefixes introduce clean-negative false completion.
     Observed disagreements are positive recall / safer rejection issues, not
     clean-negative safety regressions.
   - Disagreements concentrate in two source recordings/case families:
     one correct-chord case and one same-note-retrigger case, plus one
     counterfactual semitone case where the short prefix rejects.
   - The shortest prefix where the full frozen local evidence window has real
     STFT support is approximately `+190ms`, but the shortest prefix that is
     decision-equivalent to `+350ms` in this benchmark is `+220ms`.
   - Research strike-to-decision budget for this direct note-model path is
     roughly:

     ```text
     +190ms prefix: mean ~= 291ms, p95 ~= 333ms
     +220ms prefix: mean ~= 321ms, p95 ~= 385ms
     ```

   - Direct note-model should enter the next runtime-like rolling-buffer
     prototype stage. Continue to keep it out of production until the rolling
     adapter proves equivalent behavior under real chunking, scheduling, and
     memory constraints.

11. Direct note-model fixed `+220ms` future context: past-lookback audit

   Status: completed on the non-frozen development + calibration sets only.
   Frozen evaluation was not touched, thresholds were not changed, and
   production recognition/progression was not modified.

   Output artifact:

   ```text
   backend/data/work/datasets/maestro-v3.0.0/bytedance_direct_note_lookback_context.gpu.json
   ```

   Contract:

   ```text
   source performances = 12
   cases = 192
   target-group inferences per lookback = 264

   model = ByteDance note_model only
   no 10s padding
   no pedal_model
   no RegressionPostProcessor
   no MIDI decoding

   verifier:
   onset >= 0.2
   frame >= 0.2
   local evidence = target -50ms -> target +120ms
   future prefix = target +220ms

   input crop per expected group:
   [target - lookback, target +220ms]

   lookbacks:
   150ms
   250ms
   500ms
   750ms
   1000ms reference
   ```

   Context reason:

   ```text
   STFT window = 2048 samples @ 16kHz
   center = true
   half-window ~= 64ms

   local evidence starts at -50ms
   minimum real past support for the leftmost local frame is ~= 114ms
   ```

   Results:

   ```text
   150ms lookback:
     agreement vs 1000ms = 192/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     tensor duration = 370ms
     target-evidence end-to-end mean / median / p95 =
       40.848 / 37.114 / 57.137 ms

   250ms lookback:
     agreement vs 1000ms = 191/192
     correct single/chord/retrigger = 20/24, 18/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     tensor duration = 470ms
     target-evidence end-to-end mean / median / p95 =
       50.929 / 48.472 / 67.201 ms

   500ms lookback:
     agreement vs 1000ms = 192/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     tensor duration = 720ms
     target-evidence end-to-end mean / median / p95 =
       68.798 / 66.458 / 86.472 ms

   750ms lookback:
     agreement vs 1000ms = 192/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     tensor duration = 970ms
     target-evidence end-to-end mean / median / p95 =
       81.097 / 72.300 / 126.063 ms

   1000ms lookback reference:
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     NO_LOCAL_MODEL_FRAMES = 0/192
     tensor duration = 1220ms
     target-evidence end-to-end mean / median / p95 =
       99.713 / 90.092 / 147.857 ms
   ```

   Disagreement:

   ```text
   250ms:
     - s08_correct_chord_001:
       positive recall loss. The G1 frame activation drops from 0.828380 at
       1000ms to 0.162983 at 250ms, so the chord is rejected.

   150ms / 500ms / 750ms:
     - no case-level decision disagreements vs 1000ms
   ```

   Interpretation:

   - `250ms` is not decision-equivalent to `1000ms`; it loses one correct chord.
   - `500ms` is decision-equivalent to `1000ms` in this benchmark.
   - `150ms` is also decision-equivalent to `1000ms` in this run, but the
     non-monotonic `250ms` failure means this should not be interpreted as a
     robust production-ready lower bound.
   - No tested lookback introduces new clean-negative false completion.
   - Retigger is not more history-dependent than single/chord in this result:
     all lookbacks report `17/24`, matching the `1000ms` reference.
   - Shorter history materially reduces compute:

     ```text
     500ms lookback vs 1000ms:
       tensor duration: 720ms vs 1220ms
       target-evidence mean: 68.798ms vs 99.713ms
       target-evidence p95: 86.472ms vs 147.857ms
     ```

   - Superseded interpretation:

     ```text
     Do not freeze "500ms past audio" as the rolling-buffer recommendation yet.
     ```

     Follow-up JSON-only comparison showed that the `1000ms cropped` lookback
     reference is itself behaviorally different from the prior uncropped
     `+220ms` direct-note baseline: it loses one same-note retrigger case
     (`18/24 -> 17/24`). Therefore the cropped-lookback experiment remains
     useful, but its `1000ms` reference should not be treated as the final
     behavioral reference.

12. Direct note-model lookback vs uncropped `+220ms` behavioral reference

   Status: completed by reading existing JSON only. No model inference was
   rerun, frozen evaluation was not touched, thresholds were not changed, and
   production recognition/progression was not modified.

   Input artifacts:

   ```text
   backend/data/work/datasets/maestro-v3.0.0/bytedance_direct_note_prefix_context.gpu.json
   backend/data/work/datasets/maestro-v3.0.0/bytedance_direct_note_lookback_context.gpu.json
   ```

   Derived comparison artifact:

   ```text
   backend/data/work/datasets/maestro-v3.0.0/bytedance_direct_note_lookback_vs_uncropped_220_comparison.json
   ```

   Behavioral reference:

   ```text
   uncropped direct-note +220ms:
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     clean negative false = 0/61
   ```

   Agreement vs uncropped `+220ms`:

   ```text
   150ms cropped:
     agreement = 191/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean negative false = 0/61

   250ms cropped:
     agreement = 190/192
     correct single/chord/retrigger = 20/24, 18/24, 17/24
     clean negative false = 0/61

   500ms cropped:
     agreement = 191/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean negative false = 0/61

   750ms cropped:
     agreement = 191/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean negative false = 0/61

   1000ms cropped:
     agreement = 191/192
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean negative false = 0/61
   ```

   Disagreements:

   ```text
   All cropped lookbacks:
     - s08_same_note_retrigger_002
       uncropped +220ms accepts; cropped lookback rejects.

   250ms cropped additionally:
     - s08_correct_chord_001
       one low G1 chord tone drops below threshold.
   ```

   Same-note retrigger detail:

   ```text
   case_id = s08_same_note_retrigger_002
   source_recording_id =
     9ace3b72a432e0cb3a60b1b75f7531968ef40890fb11da4df70858506fc8f290

   group 0:
     target_second = 16.3927
     uncropped input start relative to target = -1000.0ms
     1000ms cropped input start relative to target = -1000ms
     result = MATCH in both

   group 1:
     target_second = 16.9031
     previous expected group target = 16.3927
     distance previous -> current = 510.4ms

     uncropped input start relative to target = -1510.4ms
     1000ms cropped input start relative to target = -1000ms

     uncropped G3 evidence:
       onset = 0.206188
       frame = 0.996643
       accepted = true

     1000ms cropped G3 evidence:
       onset = 0.183591
       frame = 0.996142
       accepted = false
   ```

   Interpretation:

   - `1000ms cropped` is not equivalent to uncropped `+220ms`; it loses one
     same-note retrigger by pushing the second group's G3 onset evidence below
     the frozen `0.2` onset threshold.
   - The previous expected strike is not excluded by the `1000ms` crop. It is
     about `510ms` before the second target and remains inside the cropped
     window.
   - The behavioral difference comes from earlier sequence context before that
     previous strike: uncropped group 1 starts `1510ms` before the second target,
     while `1000ms cropped` starts only `1000ms` before it.
   - Therefore the earlier `150ms / 500ms / 750ms = 192/192 vs 1000ms`
     conclusion was only agreement with an already-degraded cropped reference.
   - No fixed tested lookback `<=1000ms` is fully equivalent to the uncropped
     `+220ms` behavioral reference.
   - Rolling-buffer lookback must not be frozen as a simple fixed millisecond
     value yet. The next research question should be whether the runtime buffer
     must preserve sequence context across previous expected groups / previous
     strikes, rather than independently cropping each expected group.

13. Position-matched zero-pad mechanism test

   Status: completed on development + calibration only. Frozen evaluation was
   not touched, thresholds were not changed, production recognition/progression
   was not modified, and no runtime adapter was implemented.

   Output artifact:

   ```text
   backend/data/work/datasets/maestro-v3.0.0/bytedance_position_matched_zero_pad.gpu.json
   ```

   Conditions:

   ```text
   A = UNCROPPED_REFERENCE
       existing direct-note +220ms result
       input = original case clip start -> target +220ms

   B = REAL_1000MS_CROP
       existing lookback result
       input = target -1000ms -> target +220ms

   C = POSITION_MATCHED_ZERO_PAD
       real audio is identical to B:
         target -1000ms -> target +220ms

       but prepend zeros:
         zero_pad_ms = max(0, A_target_position_ms - 1000ms)

       therefore:
         C target position from tensor start == A target position from tensor start
   ```

   Aggregate result:

   ```text
   A uncropped +220ms:
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     clean negative false = 0/61

   B real 1000ms crop:
     correct single/chord/retrigger = 20/24, 19/24, 17/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     clean negative false = 0/61
     agreement vs A = 191/192

   C position-matched zero-pad:
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     clean negative false = 0/61
     agreement vs A = 192/192
   ```

   C activation delta vs A:

   ```text
   onset abs mean = 0.000246
   onset abs max  = 0.018497
   frame abs mean = 0.000338
   frame abs max  = 0.034699
   NO_LOCAL_MODEL_FRAMES = 0/192
   ```

   Zero-padding distribution:

   ```text
   min = 0.0ms
   median = 0.0ms
   p95 = 537.7ms
   max = 1420.8ms
   mean = 62.559ms
   ```

   Key restored case:

   ```text
   case_id = s08_same_note_retrigger_002
   group = 1
   pitch = G3

   A uncropped:
     onset = 0.206188
     frame = 0.996643
     accepted = true

   B real 1000ms crop:
     onset = 0.183591
     frame = 0.996142
     accepted = false

   C position-matched zero-pad:
     restored to MATCH at case level
   ```

   Interpretation:

   - C restores A's complete case-level behavior across all 192 cases.
   - C fixes the only B-vs-A disagreement, including the lost same-note
     retrigger.
   - No new clean-negative false completion appears.
   - This strongly supports the mechanism hypothesis:

     ```text
     cropped-lookback drift is mainly left-boundary / sequence-position /
     recurrent warm-up behavior

     not a dependency on the removed real historical music content
     ```

   - The next research question can be narrowed to a deterministic warm-up
     contract for the direct note-model path:

     ```text
     fixed real lookback
     +
     deterministic left padding / warm-up
     +
     target position contract
     ```

     Do not freeze a specific padding length yet. This result only says the
     mechanism is viable and should be tested as a runtime-like rolling-buffer
     prototype before any production integration.

14. Fixed-anchor bounded-window runtime research candidate

   Status: completed on development + calibration only. Frozen evaluation was
   not touched, thresholds were not changed, no anchor sweep was performed, and
   production recognition/progression was not modified.

   Output artifact:

   ```text
   backend/data/work/datasets/maestro-v3.0.0/bytedance_fixed_anchor_window.gpu.json
   ```

   Terminology:

   ```text
   bounded-window runtime research candidate
   ```

   Do not describe this as a truly causal streaming model. The frontend still
   uses centered STFT features and a bidirectional GRU.

   Fixed input contract:

   ```text
   model = ByteDance note_model only
   onset >= 0.2
   frame >= 0.2
   local evidence = target -50ms -> target +120ms

   real past audio = last up to 1000ms
   target anchor from tensor start = 1600ms
   future audio = 220ms

   typical:
     left zero padding = 600ms
     real lookback = 1000ms
     target at 1600ms
     total tensor duration = 1820ms
   ```

   This contract intentionally does not use:

   ```text
   A_target_position
   case clip start
   source-relative target age
   ```

   Result vs uncropped `+220ms` behavioral reference:

   ```text
   A uncropped +220ms:
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     clean negative false = 0/61

   fixed-anchor bounded window:
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     clean negative false = 0/61
     agreement vs A = 192/192
     NO_LOCAL_MODEL_FRAMES = 0/192
   ```

   Activation delta vs A:

   ```text
   onset abs mean = 0.003499
   onset abs max  = 0.081642
   frame abs mean = 0.002624
   frame abs max  = 0.061927
   ```

   Window distribution in this dev/cal run:

   ```text
   zero_pad_ms:
     min / median / p95 / max = 600 / 600 / 600 / 600

   available_real_lookback_ms:
     min / median / p95 / max = 1000 / 1000 / 1000 / 1000

   actual_tensor_duration_ms:
     min / median / p95 / max = 1820 / 1820 / 1820 / 1820
   ```

   Latency:

   ```text
   note_model forward mean / median / p95 =
     114.718 / 114.016 / 131.131 ms

   target-evidence end-to-end mean / median / p95 =
     115.751 / 114.963 / 132.100 ms

   estimated strike->decision mean / median / p95 =
     335.751 / 334.963 / 352.100 ms
   ```

   Interpretation:

   - The fixed-anchor bounded-window contract fully restores the uncropped
     `+220ms` behavioral reference on the full 12-source / 192-case non-frozen
     benchmark.
   - It preserves positive recall and clean-negative safety:

     ```text
     agreement = 192/192
     clean false = 0/61
     positive metrics match A exactly
     ```

   - Offline context experiments should stop here. Do not sweep `1700ms`,
     `1800ms`, `2000ms`, or additional lookbacks unless a future rolling-buffer
     prototype reveals a new failure mode.
   - Research runtime input contract is now:

     ```text
     1000ms real lookback
     + deterministic left zero padding
     + target anchor at 1600ms
     + 220ms future
     ```

   - Next step: oracle-timestamp rolling-buffer prototype using this bounded
     window contract, still outside production.

15. Oracle-timestamp rolling-buffer equivalence

   Status: completed on development + calibration only. Frozen evaluation was
   not touched, thresholds were not changed, no strike detector was implemented,
   WebSocket/runtime production code was not modified, and this remains a
   research-only oracle-timestamp simulator.

   Output artifact:

   ```text
   backend/data/work/datasets/maestro-v3.0.0/bytedance_oracle_rolling_buffer.gpu.json
   ```

   Focused tests:

   ```text
   backend/tests/test_bytedance_oracle_rolling_buffer.py
   ```

   Research script:

   ```text
   backend/scripts/evaluate_bytedance_oracle_rolling_buffer.py
   ```

   Runtime metadata:

   ```text
   oracle_target_timestamp = true
   causal_attempt_detection = false
   streaming_causal_model = false
   product_false_advance_eligible = false
   ```

   This is a `bounded-window runtime research candidate`, not a truly causal
   streaming model, because the acoustic frontend still uses centered STFT
   features and a bidirectional GRU.

   Current PCM chunk contract audit:

   ```text
   browser capture primitive:
     navigator.mediaDevices.getUserMedia(...)
     source file:
       apps/customer-web/src/hooks/practice/use-practice-audio-stream.ts
       lines 60-63

   requested capture channels:
     channelCount = PCM_CHANNELS = 1
     source files:
       apps/customer-web/src/lib/practice/audio-stream.ts lines 1-3
       apps/customer-web/src/hooks/practice/use-practice-audio-stream.ts lines 60-63

   browser processing primitive:
     AudioWorkletNode('practice-pcm-processor')
     source file:
       apps/customer-web/src/hooks/practice/use-practice-audio-stream.ts
       lines 84-103

   worklet callback aggregation:
     frameSize = 2048 AudioContext samples
     postMessage(copy) only after 2048 samples are buffered
     source file:
       apps/customer-web/public/audio-worklets/practice-pcm-processor.js
       lines 4-5, 16-29

   resampling:
     downsampleTo16k(samples, audioContext.sampleRate)
     source file:
       apps/customer-web/src/hooks/practice/use-practice-audio-stream.ts
       lines 95-103

     implementation:
       outputLength = round(input.length / (inputSampleRate / 16000))
       nearest-sample pick by round(index * ratio)
     source file:
       apps/customer-web/src/lib/practice/audio-stream.ts
       lines 17-29

   PCM encoding:
     convertFloat32ToPcm16(...)
     little-endian signed 16-bit PCM
     source file:
       apps/customer-web/src/lib/practice/audio-stream.ts
       lines 5-15

   WebSocket binary send:
     socket.send(frame)
     source file:
       apps/customer-web/src/hooks/practice/use-practice-socket.ts
       lines 65-70

   client.init declared format:
     sample_rate = session detail sample_rate
     channels = session detail channels
     frame_samples = 640
     source file:
       apps/customer-web/src/app/[locale]/(workspace)/score/[id]/practice/page.tsx
       lines 716-718

   session creation constants:
     sample_rate = 16000
     channels = 1
     frame_format = pcm_s16le
     source files:
       apps/customer-web/src/lib/practice/audio-stream.ts lines 1-3
       apps/customer-web/src/hooks/practice/use-practice-session.ts lines 55-57

   backend WebSocket receive:
     await websocket.receive()
     binary_payload = message.get("bytes")
     step_runtime.process_audio_chunk(binary_payload)
     source file:
       backend/app/modules/practice/router.py
       lines 461, 716-725

   backend chunk ordering:
     process_audio_chunk appends bytes to AudioChunkBuffer
     then calls engine.ingest_audio(chunk)
     source file:
       backend/app/processing/realtime/session_runtime.py
       lines 117-121

     AudioChunkBuffer is a deque that appends chunks in receive order
     source file:
       backend/app/processing/realtime/audio_buffer.py
       lines 6-14

   backend PCM recovery:
     np.frombuffer(chunk, dtype=np.int16)
     samples.astype(np.float32) / 32768.0
     source file:
       backend/app/processing/engines/practice_alignment/matchmaker_live.py
       lines 618-620

   backend re-framing:
     chunks are concatenated into _pending_audio
     then split into hop_length frames
     hop_length = int(sample_rate / profile.frame_rate)
     source file:
       backend/app/processing/engines/practice_alignment/matchmaker_live.py
       lines 189-190, 252-274
   ```

   Important chunking conclusion:

   ```text
   The frontend worklet emits fixed 2048 AudioContext-sample blocks, but the
   downsampled 16k PCM chunk length depends on audioContext.sampleRate.

   Therefore the binary WebSocket chunk size is not guaranteed to equal the
   client.init frame_samples = 640 value.

   The backend currently preserves binary chunk order but does not rely on
   client.init frame_samples for splitting; Matchmaker concatenates chunks and
   re-frames by hop_length.
   ```

   For this simulator run:

   ```text
   research chunking contract:
     chunk_samples = 640 at 16kHz
     chunk_duration = 40ms
     parameterized = true
     final_browser_scheduling_equivalence_claimed = false
   ```

   Sample-level hard gate:

   ```text
   WAV input:
     streamed from the beginning of each case
     ingested once in chunk order

   oracle timestamp:
     used only to identify the target sample

   extraction:
     allowed only after received_samples >= target + 220ms
     chunk overshoot recorded
     tensor always truncated exactly at target + 220ms

   rolling tensor:
     ring buffer stores real PCM only
     600ms deterministic left zeros generated at extraction
   ```

   Gate result:

   ```text
   target groups = 264
   tensor-equivalent groups = 264
   all_groups_equivalent = true

   shape equality = all true
   sample-count equality = all true
   target sample index = 1600ms anchor
   max_abs_sample_diff = 0 for all groups
   hash equality = all true
   ```

   Chunk/overshoot metrics:

   ```text
   chunk size samples:
     min / median / p95 / max / mean =
     13 / 640 / 640 / 640 / 635.181

   chunk overshoot samples:
     min / median / p95 / max / mean =
     0 / 320 / 320 / 627 / 315.424

   chunk overshoot ms:
     min / median / p95 / max / mean =
     0 / 20 / 20 / 39.188 / 19.714

   ring-buffer extraction/copy ms:
     min / median / p95 / max / mean =
     0.035 / 0.058 / 0.109 / 0.221 / 0.065
   ```

   Model decision equivalence after sample gate passed:

   ```text
   rolling-buffer path:
     correct single/chord/retrigger = 20/24, 19/24, 18/24
     clean semitone/octave/missing false = 0/18, 0/23, 0/20
     clean negative false = 0/61
     NO_LOCAL_MODEL_FRAMES = 0/192

   agreement vs fixed-anchor offline reference:
     192/192
   ```

   Runtime research latency decomposition:

   ```text
   required future acquisition:
     220ms

   chunk-boundary overshoot:
     median = 20ms
     p95 = 20ms
     max = 39.188ms

   ring-buffer extraction/copy:
     median = 0.058ms
     p95 = 0.109ms

   model/evidence compute:
     mean / median / p95 =
     106.318 / 100.947 / 137.560 ms

   research strike->decision:
     mean / median / p95 =
     346.097 / 341.038 / 377.616 ms
   ```

   Interpretation:

   - The rolling-buffer extraction exactly reproduces the fixed-anchor offline
     tensor for every expected group before model inference.
   - The rolling path then reproduces the fixed-anchor offline case decisions
     `192/192`.
   - Simulator equivalence research should stop here.
   - Next stage: causal physical-strike candidate trigger research. That stage
     must not assume oracle timestamps and must separately evaluate
     false-advance eligibility.
