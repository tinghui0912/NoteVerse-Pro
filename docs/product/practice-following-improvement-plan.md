# Practice Following Improvement Plan

## Purpose

This document records the concrete fixes and improvements needed for the current practice score-following feature after code review and real-engine replay analysis. It separates confirmed correctness issues from product-layer improvements so implementation can proceed in the right order.

## Current Architecture Snapshot

The current realtime practice path is:

```text
Customer web practice page
  -> AudioWorklet PCM capture
  -> practice WebSocket
  -> PracticeSessionRuntime
  -> BrowserAudioStreamAdapter
  -> MatchmakerLiveEngine / OLTW
  -> alignment.update
  -> page-level reliability gate
  -> PracticeFollowController
  -> Verovio note highlighting
```

Relevant files:

- `apps/customer-web/src/app/[locale]/(workspace)/score/[id]/practice/page.tsx`
- `apps/customer-web/src/lib/practice/follow-controller.ts`
- `apps/customer-web/src/lib/practice/protocol.ts`
- `apps/customer-web/src/lib/practice/verovio-adapter.ts`
- `backend/app/modules/practice/router.py`
- `backend/app/processing/realtime/session_runtime.py`
- `backend/app/processing/engines/practice_alignment/browser_audio_stream.py`
- `backend/app/processing/engines/practice_alignment/matchmaker_live.py`
- `backend/app/processing/engines/practice_alignment/audio_activity.py`
- `backend/scripts/evaluate_practice_replay.py`
- `backend/tests/fixtures/practice_audio/profile_manifest.json`

## What Is Working

The feature already has a solid realtime foundation:

- The browser uses low-latency streaming rather than batch recording.
- The backend separates WebSocket session state from audio stream state.
- Audio gate states distinguish `calibrating`, `armed`, `following`, `holding_decay`, and `lost`.
- The backend emits confidence-rich alignment updates.
- The frontend refuses to advance on low-confidence or inactive-audio updates.
- Wrong notes during an established following session do not move the highlight.
- Long pauses can recover in the tested Once Again fixture when the user continues from the expected position.

These are important strengths and should be preserved.

## Confirmed Problems

### 1. Initial Alignment Is Hop-Phase Sensitive

The current startup path depends on the latest single feature vector matching `_score_start_beat`:

```text
start signal
  -> start_streak >= min_active_frames
  -> current feature vs score_start_beat
  -> score >= 0.7
  -> start_confirmed
```

In `MatchmakerLiveEngine`, `_score_start_feature()` checks one beat location. In `BrowserAudioStreamAdapter`, a failed start feature immediately clears the start streak and returns `start_feature_mismatch`.

Replay analysis showed:

- Normal hop-aligned starts succeed reliably.
- Starts with some sample offsets or delays can fail repeatedly.
- Opening wrong notes followed by a correct restart can either start or fail depending on the combined duration and frame phase.
- The failure is not truly "4 wrong notes vs 12 wrong notes"; it is a frame/window alignment problem exposed by those scenarios.

This is the highest-priority correctness issue because a user can play the correct opening after the system is armed and still see no start. This is specifically an initial-alignment or entry-detection problem. Tracking recovery after following has already started is a separate concern and performed reasonably well in the tested long-pause scenarios.

### 2. Frontend Drops Useful Low-Confidence State

`page.tsx` currently ignores all `alignment.update` payloads that do not pass:

```text
match_state == matched
audio_active == true
input_policy_confidence >= 0.55
validation_confidence >= 0.55
visual_confidence >= 0.55
```

This protects the highlight from jumping, but it also hides useful information:

- audio was heard but did not match
- the follower is in `holding_decay`
- the follower is `lost`
- recovery is underway
- the user may be playing the wrong entry

The user only sees a frozen highlight, which feels like the system may be broken.

### 3. Alignment Acceptance Logic Is Split Across Layers

There are at least three places making acceptance decisions:

- Backend audio gate and input policy.
- `page.tsx` reliability gate.
- `PracticeFollowController` desync/recovery/commit rules.

This makes behavior difficult to reason about and hard to test as product behavior. The system lacks a single authoritative practice decision object such as:

```ts
{
  action: "advance" | "hold" | "relocalize" | "wait";
  reason: PracticeDecisionReason;
  experienceState: PracticeExperienceState;
  displayAnchor?: PracticeDisplayAnchor;
}
```

### 4. Real-Engine Regression Tests Do Not Cover the Exposed Edge Cases

The existing real-engine profile matrix covers normal Once Again start, negative non-music starts, and mixed-input positives. It does not cover:

- random sample offsets before the first correct note
- armed delay before correct entry
- alternate WebSocket/audio chunk boundaries
- wrong notes followed by correct restart
- long pause then single-note continuation
- long pause then phrase continuation
- mid-piece wrong notes followed by correct continuation
- frontend UX state mapping for low-confidence/lost/recovering states

### 5. Practice Mode Semantics Are Not Explicit

The current behavior is closest to a conservative free-follow mode:

- advance on reliable matched updates
- hold on uncertainty
- do not explicitly wait for a correct note
- do not score wrong notes live in the practice view

That is a valid mode, but it is not enough for beginner practice. Future modes should be treated as product hypotheses until their behavior is defined and tested.

## Priority Plan

## P0 - Build the Initial-Alignment Regression Harness

Goal: lock the current initial-alignment bug into deterministic real-engine tests before changing the algorithm. The core invariant is that the same musical performance should not substantially change start success, first aligned beat, or startup latency just because the leading silence sample offset or chunk boundary changed.

Tasks:

1. Extend `backend/scripts/evaluate_practice_replay.py` or add a companion real-engine replay script that can compose:
   - calibrated silence
   - arbitrary armed delays
   - sample offsets from `0..hop_length-1`
   - different WebSocket/audio chunk boundaries
   - wrong-note sequences
   - correct Once Again restart

2. Add phase-invariance tests.
   - Same performance plus sample offset `0..hop_length-1`.
   - Expected result: start success is invariant, first aligned beat stays within fixture-specific tolerance, and startup latency stays bounded.
   - PR CI should run a representative deterministic subset, such as offset `0`, `1`, `floor(hop_length / 4)`, `floor(hop_length / 2)`, `hop_length - 1`, plus known historical failure offsets.
   - Nightly or dedicated regression should run the full `0..hop_length-1` sweep and broader random/property cases.

3. Add chunking-invariance tests.
   - Same PCM content with different transport chunk boundaries.
   - Expected result: alignment decisions are equivalent within a small timing tolerance.

4. Add scenario tests.
   - Armed delay `0..12s` followed by correct start.
   - 1, 4, 8, and 12 wrong notes followed by correct restart.
   - Wrong-note section must not start.
   - Once Again correct restart should start within a bounded latency and first reliable beat should be near the fixture's first playable event, currently beat `3.13`.

5. Add initial-alignment diagnostics to replay output.
   - Count consecutive `start_feature_mismatch` frames.
   - Report max startup evidence.
   - Report time to first `start_confirmed`.
   - Report time to first reliable alignment.
   - Include enough fields in replay reports to explain why a start failed.

Acceptance criteria:

- Existing profile manifest still passes.
- New phase and chunking tests fail on the current implementation and can validate the fix.
- Fixture-specific assertions, such as Once Again first reliable beat near `3.13`, are kept scoped to that fixture and not treated as global startup rules.

Initial P0 baseline, captured on 2026-08-21 with `initial_alignment_manifest.json`:

- Existing `profile_manifest.json` still passes.
- Once Again phase offsets `0`, `1`, `133`, `266`, and `532` samples currently pass.
- A 12-second armed delay before correct Once Again entry currently passes.
- Wrong C4 followed by correct Once Again restart currently fails to start. The replay reports `51` `start_feature_mismatch` frames and no emitted alignment updates.
- Smaller-than-hop transport chunking currently fails with a real feature extraction error: `n_fft=1066 is too large for uncentered analysis of input signal of length=789`.
- Larger-than-hop transport chunking at `640` samples currently passes.

The immediate implementation target was therefore narrower than the earlier hypothesis: preserve the passing phase/delay behavior, fix wrong-note restart startup recovery, and make audio ingestion chunk-boundary robust before tuning the windowed initial-alignment policy.

P0 implementation status:

- `MatchmakerLiveEngine` now buffers arbitrary incoming PCM chunks into stable `hop_length` analysis frames before feeding the stream adapter.
- Startup validation now uses a very short scored candidate window when a score-specific start validator is present. The window only tolerates a brief one-frame break and requires repeated matching start-feature evidence, preventing the mixed non-music negative from starting.
- After this fix, both `profile_manifest.json` and `initial_alignment_manifest.json` pass in the `practice-quality` container.

## P0.5 - Add a Minimal PracticeScoreTimeline

Goal: provide enough music-domain structure for entry detection, first playable event prompts, chords, rests, and future wait-for-note behavior without pulling in a full editor-domain rewrite.

Tasks:

1. Define a minimal practice timeline projection.

```ts
type ScoreBeat = number;

type PracticeScoreEvent = {
  eventId: string;
  onsetBeat: ScoreBeat;
  durationBeats: ScoreBeat;
  pitches: string[];
  renderNoteIds: string[];
  staffIds: string[];
  voiceIds: string[];
  playable: boolean;
  entryCandidate: boolean;
};

type PracticeEntryGroup = {
  groupId: string;
  onsetBeat: ScoreBeat;
  eventIds: string[];
  renderNoteIds: string[];
  entryCandidate: boolean;
};
```

`ScoreBeat` is the practice timeline's musical-time unit. It is an absolute score-time coordinate across the expanded performance timeline, not a measure-relative offset. It should map consistently to the beat/qstamp domain used by Matchmaker and Verovio, not to seconds, MusicXML divisions, or wall-clock time.

For this practice layer, define `1.0` as one quarter-note duration. This avoids ambiguity in 6/8, cut time, pickup measures, tempo changes, and future repeat expansion. If the implementation later renames this type to `ScoreTime`, keep the same unit and coordinate semantics.

2. Build it from the existing MusicXML/Verovio data path.
   - Identify rests vs playable note events.
   - Preserve event identity at the staff/voice level.
   - Build simultaneous `PracticeEntryGroup` values for exact same-onset practice matching and highlighting.
   - Preserve render note IDs for Verovio highlighting.
   - Mark the first playable event explicitly.
   - Treat tie continuations carefully so they are not mistaken for new entry events.
   - Treat `eventId` as practice timeline identity. Treat `renderNoteIds` as render/highlight anchors only, not domain identity.
   - Do not introduce near-onset grouping in the first version. If future modes need it, add an explicit `EntryGroupingPolicy` so score event identity and performance matching tolerance remain separate.

3. Keep scope narrow.
   - Do not connect the full editor domain model to practice yet.
   - Do not attempt full pedagogy, phrase, fingering, or harmonic analysis.
   - Only model what initial alignment and visual following need.

Acceptance criteria:

- The first playable event is explicit.
- Chords and two-hand same-onset entries can form a simultaneous practice entry group while preserving staff/voice event identity.
- The timeline can replace the current plain `beat -> noteIds[]` lookup for first-note prompts and startup entry candidates.

P0.5 implementation status:

- Added `PracticeScoreTimeline`, `PracticeScoreEvent`, and `PracticeEntryGroup` in the backend practice-alignment domain.
- Timeline construction uses `partitura` `note_array` as the authoritative score-time and pitch source, with MusicXML note IDs used to supplement render/staff/voice metadata.
- Entry groups are exact-onset only; near-onset grouping remains intentionally out of scope.
- `MatchmakerLiveEngine` now derives first playable beat, score end beat, and OLTW score positions from `PracticeScoreTimeline`.
- Fast unit tests cover chord grouping, same-onset multi-voice entry groups, staff/voice preservation, and near-onset separation.
- Real-engine replay for both `profile_manifest.json` and `initial_alignment_manifest.json` still passes after the timeline is in the runtime path.
- Frontend replacement of the current plain `beat -> noteIds[]` visual lookup remains part of later protocol/UI work, not P0.5.

## P1 - Implement Windowed Initial Alignment and Entry-Region Evidence

Goal: make initial entry robust to hop phase, leading silence, wrong-note attempts, and restart timing without making non-music false starts easier.

Tasks:

1. Replace single-frame start validation with a parameterized evidence window.
   - Keep a rolling feature history in the startup phase.
   - Treat the window size as a tunable parameter, not an architectural invariant.
   - Evaluate candidate sizes using latency and false-start metrics rather than hard-coding `300-800ms` as a requirement.

2. Score an entry region rather than only `_score_start_beat`.
   - Use `PracticeScoreTimeline` entry candidates.
   - Compare against the first playable event and a short early-entry phrase.
   - Keep the region narrow enough to avoid unrelated later false starts.

3. Return an anchor decision.
   - Capture the chosen entry event or anchor beat.
   - Use it for the initial `start_confirmed` alignment instead of always assuming exactly `_score_start_beat`.

4. Preserve negative scenarios.
   - Speech, cough, keyboard, desk knock, mixed non-music, and wrong-pitch starts must remain rejected.

Acceptance criteria:

- P0 phase and chunking tests pass.
- Wrong notes followed by correct restart pass for 1, 4, 8, and 12 wrong-note cases.
- Existing negative start scenarios still pass.
- Time to first reliable alignment remains within the product latency target chosen from replay data.

P1 implementation status:

- Startup input is now buffered into stable analysis hops, so transport chunk boundaries do not affect feature extraction.
- Startup validation uses a short, profile-controlled feature window instead of a single current frame.
- Startup scoring checks a narrow `PracticeScoreTimeline` entry region instead of only `_score_start_beat`.
- `start_confirmed` can anchor to the selected entry-region beat.
- `PracticeAudioProfile` owns `startup_feature_window_frames` and `startup_entry_region_beats` so future tuning is reviewed with replay results.
- Existing non-music profile scenarios, Once Again phase offsets, armed delay, wrong-note restart, and alternate chunk-size baseline all pass.
- The current P0 fixture covers wrong C4 followed by correct restart; additional 1/4/8/12 wrong-note sequence variants should be added when more multi-note wrong-entry fixtures are available.

## P2 - Introduce an Alignment Decision / Follow Policy Layer

Goal: centralize "should the product advance, hold, recover, or prompt" instead of scattering policy across backend, page, and visual controller.

Tasks:

1. Define a versioned decision contract with an authoritative owner.

Preferred flow:

```text
Raw Alignment
  -> backend FollowPolicy
  -> AlignmentDecision
  -> WebSocket
  -> frontend Visual Controller
```

The frontend should keep schema validation, stale/out-of-order protection, animation smoothing, scroll, and highlight commit logic. The frontend should not re-decide whether a musical position is product-accepted.

2. Define a versioned enum for reasons.
   - Avoid arbitrary log strings in the product protocol.
   - Candidate reasons:
     - `insufficient_input`
     - `entry_mismatch`
     - `low_alignment_confidence`
     - `holding_position`
     - `reacquiring`
     - `stable_match`

3. Define decision payload shape.
   - Candidate fields:
     - `action`
     - `reason`
     - `experience_state`
     - `display_anchor`
     - `alignment`
     - `confidence_summary`
   - Candidate actions:
     - `advance`: accept forward progress within the current tracking neighborhood.
     - `hold`: keep the current display anchor.
     - `relocalize`: explicitly jump outside the normal tracking neighborhood to a newly confirmed location.
     - `wait`: wait for stronger or mode-specific evidence.
   - `accepted` may be exposed as a derived convenience field if useful, but it should not be the core product semantic.
   - `display_anchor` should be able to carry both event and beat information:

```ts
type PracticeDisplayAnchor = {
  eventId?: string;
  beat: number;
};
```

   - Keep engine evidence separate from product decision where possible. For example:

```ts
{
  alignment: {...},
  decision: {...}
}
```

4. Define initial experience states.
   - Candidate states:
     - `waiting_for_input`
     - `listening`
     - `following`
     - `heard_but_uncertain`
     - `possible_wrong_note`
     - `recovering`
     - `lost`
     - `paused`

5. Define input health as a separate signal, not as a primary experience state.
   - Candidate values:
     - `good`
     - `too_quiet`
     - `noisy`
     - `clipping`
     - `unavailable`
   - The UI should be able to show an experience state and an input-health hint at the same time.

6. Define policy thresholds semantically before tuning numbers.
   - `normal_tracking_window`: the neighborhood where matched forward motion can use `action=advance`.
   - `relocalization_threshold`: the distance or confidence boundary beyond which a jump must use `action=relocalize`.
   - A candidate beat far ahead of the current anchor must not be treated as ordinary `advance` only because it is numerically greater.

7. Move the top-level reliability decision out of `page.tsx`.
   - `page.tsx` should render a product decision, not reimplement backend policy.
   - Keep defensive frontend validation, but do not silently discard all low-confidence state.

8. Keep `PracticeFollowController` focused on visual stability.
   - It should handle DOM highlighting, scroll, and commit smoothing.
   - It should not be the owner of product-level desync/recovery semantics.

9. Backfill tests.
   - Backend unit tests for decision mapping.
   - Frontend tests for UX state rendering and no-highlight-advance on `hold`/`wait` decisions.

Acceptance criteria:

- The same raw alignment stream produces deterministic product decisions.
- Low-confidence/lost states are available to the UI without moving the highlight.
- `action=hold` and `action=wait` never advance display position.
- `action=relocalize` is the only decision that can intentionally move the display to a distant confirmed location.
- Existing reliable-follow behavior is preserved.

P2 implementation status:

- Added a backend-owned `FollowPolicy` that converts raw alignment telemetry into `AlignmentDecision`.
- `AlignmentDecision` now travels through the strict WebSocket protocol and frontend Zod schema.
- The decision contract includes:
  - `action`: `advance`, `hold`, `relocalize`, or `wait`.
  - `reason`: a versioned enum, not arbitrary UI logic.
  - `experience_state`: a versioned enum for product state display.
  - `display_anchor`: beat plus optional score group/event/render-note identifiers.
  - `confidence_summary`: visual, alignment, audio, continuity, validation, and input-policy confidence.
- `page.tsx` no longer silently discards low-confidence `alignment.update` messages.
- `PracticeFollowController` no longer owns product-level low-confidence, lost, backward, or large-jump policy.
- Frontend visual code still owns DOM highlighting, page focus, viewport scroll, note grace, and commit smoothing.
- `action=hold` and `action=wait` keep the existing highlight instead of advancing.
- `action=relocalize` bypasses local sequential clamping and intentionally jumps to the backend-confirmed anchor.
- Added backend unit coverage for first stable match, first unreliable input, input dropout hold, backward reacquisition hold, confident relocalization, and weak large-jump hold.
- Added frontend controller coverage for `hold`, `wait`, and `relocalize` display behavior.
- Verified with:
  - `ruff check` for the changed practice-alignment, realtime-protocol, and websocket-flow files.
  - `pytest tests/test_practice_follow_policy.py tests/test_practice_score_timeline.py tests/test_practice_runtime_regressions.py tests/test_practice_audio_replay_evaluation.py tests/test_practice_websocket_flow.py -q` -> 74 passed.
  - `npm run typecheck` in `apps/customer-web`.
  - `npm run test -- src/lib/practice/follow-controller.test.ts src/lib/practice/protocol.test.ts` -> 5 passed.
  - Once Again replay manifest -> passed all P0/P1 scenarios.

Remaining P2 work:

- Add visible user-facing state copy in P3 instead of overloading P2 with UI messaging.

## P3 - Expose User-Understandable Practice States

Goal: when the system is uncertain, users should know what is happening and what to do next.

Tasks:

1. Add UX state display in the practice session status area.
   - Avoid technical labels such as `lost` or `feature_mismatch`.
   - Suggested user-facing messages:
     - "Listening"
     - "Following"
     - "I heard something, keep playing"
     - "Finding your place"
     - "Waiting for the correct note"
     - "Check microphone level"

2. Keep algorithm uncertainty separate from teaching judgment.
   - `heard_but_uncertain`: the system heard audio, but evidence is not strong enough.
   - `possible_wrong_note`: evidence suggests a musical mismatch, but avoid overclaiming.
   - `recovering`: the system is trying to find the user's position.
   - Input health should be rendered as a separate hint, for example microphone too quiet, noisy, clipping, or unavailable.

3. Show state without visual noise.
   - Do not block the score.
   - Do not flash messages on every low-confidence frame.
   - Use debouncing/hysteresis so state changes feel calm.

4. Preserve the last reliable highlight during uncertain states.
   - Add a secondary visual treatment only if useful, such as a subtle waiting pulse on the expected note.

Acceptance criteria:

- Wrong notes do not advance the highlight, but the user receives clear feedback.
- Long pauses show a recoverable listening/recovering state.
- No rapid state flicker during normal playing.

P3 implementation status:

- `PracticeSessionStatus` now receives the latest backend `AlignmentDecision`.
- Added user-facing state mapping for:
  - following -> "Following in real time" / "正在实时跟随"
  - heard-but-uncertain -> "I heard something. Keep playing" / "听到了声音，请继续弹"
  - possible wrong note -> "Waiting for the correct note" / "等待正确的音符"
  - recovering/lost -> "Finding your place" / "正在找回位置"
  - waiting for input -> existing first-note prompt
- Low-confidence and recovery states are displayed without advancing the highlight because highlight movement remains controlled by P2 `action`.
- Input health hints are rendered separately from the practice state:
  - low input while waiting -> microphone-level hint
  - clipped input -> microphone-distance hint
- Uncertain state changes are delayed slightly in the status component so transient low-confidence frames do not immediately flicker the displayed message.
- Added frontend coverage for following, possible-wrong-note, and separate input-health mapping.
- Verified with:
  - `npm run typecheck` in `apps/customer-web`.
  - `npm run test -- src/lib/practice/follow-controller.test.ts src/lib/practice/protocol.test.ts src/components/practice/practice-session-status.test.ts` -> 8 passed.

## P4 - Add Explicit Practice Modes

Goal: support different learning intentions without forcing every user through one conservative free-follow behavior. Treat these as anticipated product modes; only promote a mode to product UI after its behavior is defined and tested.

Initial mode capabilities:

1. Free Follow
   - Current behavior, improved.
   - Best for playing through a piece.

2. Wait For Note
   - Beginner-oriented mode.
   - Highlight stays on the expected event until enough evidence of the correct event is heard.
   - Wrong notes are reported but do not advance.

3. Assessment
   - Records pitch, rhythm, and continuity errors.
   - Does not necessarily stop for every mistake.

4. Performance
   - Most tolerant and least intrusive.
   - Optimized for continuous playing.

Tasks:

- Add a `practice_mode` field to session creation and client init.
- Treat the persisted `PracticeSession` as the authoritative source of mode.
- WebSocket `client.init` may echo or validate mode, but must not independently choose business mode.
- Map `practice_mode` to a `FollowPolicyProfile`.
- Initially enable only Free Follow unless another mode has product-ready behavior.
- Allow mode-specific evaluators, especially for Wait For Note, without rewriting transport/session/input infrastructure or replacing the score-following engine.

Acceptance criteria:

- Modes are represented in the API and decision layer even if only Free Follow is initially enabled in UI.
- Adding Wait For Note does not require rewriting the realtime transport, session lifecycle, or existing Matchmaker audio follower.

P4 implementation status:

- Added `PracticeMode` with `FREE_FOLLOW`, `WAIT_FOR_NOTE`, `ASSESSMENT`, and `PERFORMANCE`.
- Added persisted `practice_mode` to `PracticeSession` plus Alembic migration `0041_practice_session_mode`.
- Added `practice_mode` to session creation request and session detail response.
- The frontend creates sessions with `practice_mode=FREE_FOLLOW`.
- WebSocket `client.init` now includes `practice_mode`.
- The websocket validates `client.init.practice_mode` against the server-owned session runtime mode.
- Runtime registration carries `practice_mode` into the alignment engine.
- `FollowPolicy` is selected through a mode profile; only `FREE_FOLLOW` currently has product-ready behavior.
- Non-Free-Follow session creation is rejected with a validation error until a mode has defined and tested behavior.
- Verified with:
  - `ruff check` for changed backend practice/mode/protocol/runtime files and related tests.
  - `pytest tests/test_practice_service_access.py tests/test_practice_read_model.py tests/test_practice_api_smoke.py tests/test_practice_websocket_flow.py tests/test_practice_runtime_regressions.py::test_practice_runtime_registry_registers_and_releases_sessions tests/test_practice_runtime_regressions.py::test_practice_runtime_emits_ready_notification_once -q` -> 24 passed.
  - `npm run generate:practice-api-types` in `apps/customer-web`.
  - `npm run typecheck` in `apps/customer-web`.

## P5 - Expand Full Musical Semantics for Visual Following

Goal: go beyond the minimal `PracticeScoreTimeline` and make the visual cursor represent richer musical context.

Tasks:

1. Extend the score timeline.
   - Measures
   - phrases if available
   - voices/staves
   - event groups
   - chords
   - tied/sustained notes
   - rests and playable entry points

2. Replace or extend `PracticeVerovioAdapter` timeline entries.
   - Move from `beat -> noteIds[]` to the event model created in P0.5.
   - Keep rendering IDs attached to timeline events.

3. Highlight all relevant active notes in a chord or multi-staff event.

Acceptance criteria:

- Chords and two-hand entries highlight as a musical event.
- Sustained/tied events do not create misleading new-entry prompts.
- The visual event timeline can serve Free Follow and Wait For Note.

P5 implementation status:

- Extended frontend `PracticeVisualTimelineEntry` with optional `eventId` and `groupId`.
- Added `PracticeDisplayAnchor` handling in `PracticeVerovioAdapter`.
- `PracticeFollowController` now resolves highlights from backend `decision.display_anchor` first.
- If `display_anchor.render_note_ids` is present, those render IDs become the authoritative highlight set.
- This lets backend score events/chords/two-hand groups drive visual highlighting instead of relying only on nearest beat lookup.
- Extended backend `PracticeScoreTimeline` events with measure numbers and tie metadata.
- Pure tie continuations are no longer marked as entry candidates, preventing sustained notes from becoming misleading next-entry prompts.
- Added timeline coverage for exact-onset musical groups, measure metadata, and pure tie-continuation suppression.
- Added frontend controller coverage that confirms multi-note backend display anchors highlight all specified render notes.
- Verified with:
  - `ruff check app/processing/engines/practice_alignment/score_timeline.py tests/test_practice_score_timeline.py`.
  - `pytest tests/test_practice_score_timeline.py -q` -> 2 passed.
  - `npm run typecheck` in `apps/customer-web`.
  - `npm run test -- src/lib/practice/follow-controller.test.ts src/components/practice/practice-session-status.test.ts src/lib/practice/protocol.test.ts` -> 9 passed.

## P6 - Add Performance Input Abstraction and MIDI Readiness

Goal: prepare the practice system for microphone, MIDI, and file replay without binding product logic to one input type.

Tasks:

1. Define input source abstractions without forcing every source into one raw frame shape.

```text
PerformanceInputSource
  -> AudioInputSource
  -> MidiInputSource
  -> ReplayAudioInputSource
```

2. Merge at the semantic observation layer.
   - Audio produces acoustic features.
   - MIDI produces symbolic observations.
   - Both can feed normalized `FollowerObservation` or `PracticeEvidence`.

3. Keep Matchmaker audio following as one engine implementation.

4. Add a future MIDI adapter path.
   - This does not need to be first, but the API and policy layer should not assume all input is microphone PCM forever.

Acceptance criteria:

- The policy and UX layer can consume normalized observations regardless of input source.
- No immediate regression to the microphone practice flow.

P6 implementation status:

- Added `PracticeInputSource` with `MICROPHONE`, `MIDI`, and `REPLAY_AUDIO`.
- Added persisted `input_source` to `PracticeSession` plus Alembic migration `0042_practice_input_source`.
- Added `input_source` to session creation request and session detail response.
- The frontend creates practice sessions with `input_source=MICROPHONE`.
- WebSocket `client.init` now includes `input_source`.
- The websocket validates `client.init.input_source` against the server-owned runtime source.
- Runtime registration carries `input_source` into the alignment engine.
- Matchmaker live alignment explicitly accepts only `MICROPHONE` input and fails clearly for unsupported sources.
- MIDI and replay audio are represented in the contract but rejected until their adapters and normalized evidence path are implemented.
- Verified with:
  - `ruff check` for changed backend input-source/protocol/runtime files and related tests.
  - `pytest tests/test_practice_service_access.py tests/test_practice_read_model.py tests/test_practice_api_smoke.py tests/test_practice_websocket_flow.py tests/test_practice_runtime_regressions.py::test_practice_runtime_registry_registers_and_releases_sessions tests/test_practice_runtime_regressions.py::test_practice_runtime_emits_ready_notification_once -q` -> 25 passed.
  - `pytest tests/test_storage_usage.py::test_score_delete_removes_practice_sessions -q` -> 1 passed.
  - `docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python practice scripts/export_openapi.py practice-api`.
  - `npm run generate:practice-api-types` in `apps/customer-web`.
  - `npm run typecheck` in `apps/customer-web`.
  - `npm run check:api-types` currently reports the expected uncommitted generated-file diff after contract regeneration; rerun it after committing generated API outputs.

Note:

- `tests/test_service_regressions.py` could not be collected in the `practice-quality` container because that image does not install `celery`; the relevant touched cases were reviewed and updated, but not executed in that container.

## Non-Goals for the Immediate Fix

Do not start with these:

- Rewriting Matchmaker or replacing OLTW.
- Broad threshold tweaking without regression tests.
- Building all practice modes before initial alignment is stable.
- Moving session creation later unless resource usage data proves it is a bottleneck.
- Adding MIDI before the current audio startup bug is fixed.
- Connecting the full editor domain model to practice before the minimal timeline is proven.
- Production observability work, dashboards, alerts, and audio-session diagnostics products are deferred out of this plan.
- Do keep structured replay diagnostics needed by P0 tests, such as startup latency, mismatch counts, and first reliable alignment timing.

## Suggested Implementation Sequence

1. Add failing real-engine initial-alignment phase and chunking tests.
2. Add the minimal `PracticeScoreTimeline` projection.
3. Implement windowed startup evidence and entry-region scoring.
4. Make the new tests pass while preserving existing negative scenarios.
5. Add `AlignmentDecision`/`experience_state` as backend-owned policy output.
6. Update the frontend to render decision state while preserving stable highlight behavior.
7. Add frontend tests for rejected/uncertain/lost decisions.
8. Introduce explicit `practice_mode` in the contract, initially defaulting to Free Follow.
9. Expand the visual timeline into richer musical event semantics.
10. Add input abstraction and MIDI-ready contracts.

## Verification Checklist

Backend:

- `pytest backend/tests/test_practice_audio_replay_evaluation.py`
- Real-engine replay for `profile_manifest.json`
- New initial-alignment phase matrix with random offsets
- Chunking-invariance replay tests
- WebSocket flow regression tests

Frontend:

- `practice/protocol` schema tests
- `PracticeFollowController` tests for action-based decisions, especially hold/wait/relocalize
- Practice page tests for UX state messages

Invariants:

- Same PCM with different chunk boundaries produces equivalent startup decisions.
- Same performance with leading sample offsets across a hop still starts consistently.
- `action=hold` or `action=wait` never advances display position.
- Recovering does not create large random highlight jumps unless an explicit `action=relocalize` decision is emitted.
- The same ordered evidence/alignment stream with the same `PracticeMode` and policy profile produces the same `AlignmentDecision` stream.

Manual:

- Start practice and play normally.
- Start practice, wait several seconds, then play correctly.
- Play wrong notes at the beginning, then restart correctly.
- Play correctly, make several wrong notes, then continue correctly.
- Pause/resume while listening and while following.

## Summary

The current practice following feature is not a bad design. It has a strong realtime foundation, but the next work should focus on correctness and product semantics in this order:

1. Build the real-engine initial-alignment and chunking regression harness.
2. Add a minimal music-domain `PracticeScoreTimeline`.
3. Fix initial-alignment robustness with windowed entry evidence.
4. Centralize alignment acceptance into a backend-owned policy/decision layer.
5. Show user-understandable uncertain/recovering states.
6. Add explicit practice modes.
7. Expand musical event semantics.
8. Prepare for MIDI/input abstraction.

The biggest mistake would be to keep tuning thresholds without tests. The right move is to lock the discovered edge cases into replay regressions, build the smallest musical timeline needed by the follower, then make startup and policy behavior deterministic.
