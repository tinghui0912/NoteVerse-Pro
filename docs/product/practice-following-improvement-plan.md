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

## Frozen Product / Architecture Rules

These rules supersede earlier wording that treated "Full performance" as a
general practice mode. The product model is intentionally two-dimensional:

```text
ProgressionMode = WAIT_FOR_NOTE | CONTINUOUS
PracticeScope = FULL_PIECE | RANGE
```

`ProgressionMode` answers how musical progression moves:

- `WAIT_FOR_NOTE`: the system waits at the current expected group until the
  target is completed. This is the product's step-by-step learning behavior.
- `CONTINUOUS`: the system keeps following musical time and does not stop
  progression just because the user made a mistake. This is the product's
  continuous-performance behavior.

`PracticeScope` answers what part of the score is practiced:

- `FULL_PIECE`: the whole score/revision.
- `RANGE`: a bounded expected-group range, optionally displayed as a measure or
  measure range.

The user-facing practice choices should therefore be:

```text
How to practice: Step-by-step practice | Continuous performance
Range: Full piece | Selected section
Input: Microphone | MIDI
```

In Chinese product copy, prefer `逐音练习 / 连贯演奏`. Use `完整演奏` only for the
specific `CONTINUOUS + FULL_PIECE` case, such as a CTA or completion title.
`CONTINUOUS + RANGE` is a continuous section practice, not a "full
performance".

Report and completion semantics are derived from progression plus scope:

| Scenario | Realtime feedback | End artifact | Standalone report page |
| --- | --- | --- | --- |
| `WAIT_FOR_NOTE + FULL_PIECE` | strong guided feedback | Learning Summary | optional details page |
| `WAIT_FOR_NOTE + RANGE` | strong guided feedback | Mini Practice Summary | no full report by default |
| `CONTINUOUS + FULL_PIECE` | weak/default status feedback | Performance Summary | primary Performance Report |
| `CONTINUOUS + RANGE` | weak/default status feedback | Segment Summary | no full report by default |

All sessions may persist structured results, but not all sessions should produce
the same user-facing "report". In particular:

- Wait-for-note summaries describe the learning process: attempts, partial
  groups, mismatches, first-pass success, dwell time, skipped/uncertain targets,
  and difficult positions.
- Continuous full-piece reports describe a performance-like take: pitch
  accuracy, missed/extra notes, rhythm/timing, tempo stability, continuity,
  pauses, analysis coverage, and confidence.
- Selected-section sessions should finish with a lightweight completion sheet by
  default. They can preserve attempt/performance data for history and future
  analytics without becoming formal full reports.
- Static score annotations are valid in both families, but their semantics must
  remain separate: learning difficulty/retry evidence for `WAIT_FOR_NOTE`,
  performance problems for `CONTINUOUS`.

The report-to-practice loop should remain user-directed:

```text
Full continuous performance -> Performance Report
Performance Report -> problem locations + "focus"
User enters Practice and chooses Full piece or Selected section
For Selected section, the user sets START and END directly on the score
Section completion -> lightweight sheet: retry / choose another range
```

Do not introduce an automatic `ReviewQueue`, recommendation state machine, or
"next required remediation target" for the MVP. The report should explain what
happened and offer entry points; the user remains in control of what to practice
next.

Summary and completion flows must stay information-first, not orchestration
first:

- A Summary item is historical evidence plus optional navigation. It is not a
  queue item, remediation task, or unresolved/resolved workflow state.
- MVP Summary actions should stop at "focus": scroll the annotated score to the
  relevant target and highlight it. Do not create a selected-section
  `PracticeSession` from a single problem target.
- A problem target is a point, while `PracticeScope` requires a start and an
  end. Do not infer `end_expected_group_id` from a problem point by silently
  choosing "same target", "rest of measure", "whole measure", "next measure",
  or "to score end".
- If later user feedback proves the Summary-to-Practice jump is too costly, add
  an explicit "select from here" flow that opens Practice in selected-range
  selection mode and focuses the problem target, but still requires the user to
  choose or confirm START and END before creating a session.
- Later selected-section practice must not mutate an earlier Summary. Each
  session summary remains an immutable snapshot of what happened in that
  session.
- Selected-section completion should offer local user-directed actions such as
  retry or choosing another range. It should not return to an originating
  Summary, auto-advance to another problem, or display a "next problem" CTA.
- Do not add `ReviewQueue`, `PracticeQueue`, `NextRecommendedTarget`,
  `UnresolvedTarget`, `RemediationState`, `problem.sequence`, or
  `next_problem_id` until a user-initiated feature such as "practice all problem
  positions" is explicitly designed.

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
- `initial_alignment_manifest.json` now includes wrong C4 followed by correct Once Again restart after 1, 4, 8, and 12 repeated wrong-note attempts.
- The 1/4/8/12 wrong-note matrix was replayed only after the engine warmup had armed; all cases start on the later correct restart and the first emitted alignment remains anchored to the first playable score beat.

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
- Added component-level fake-timer coverage for uncertainty hysteresis: transient uncertainty keeps showing the last stable state, sustained uncertainty shows the user-facing prompt, and reliable following recovers immediately.
- Verified with:
  - `npm run typecheck` in `apps/customer-web`.
  - `npm run test -- src/lib/practice/follow-controller.test.ts src/lib/practice/protocol.test.ts src/components/practice/practice-session-status.test.ts`.

## P4 - Superseded Four-Mode Taxonomy

Earlier planning considered four peer practice modes: Free Follow, Wait For
Note, Assessment, and Performance. That model has been superseded by the R0
session-policy model below.

Decision:

- Do not expose or persist a four-mode `PracticeMode` taxonomy.
- Use user-facing presets:
  - Step-by-step practice
  - Full performance
- Use internal orthogonal policy fields:
  - `progression_mode`
  - `realtime_guidance`
  - `evaluation_profile`
  - `input_source`
- Treat Assessment as report/evaluation behavior, not a progression mode.
- Treat Performance as the Full performance preset unless a future fixed-clock
  or accompaniment-driven mode is intentionally designed.

Implementation status:

- The four-mode enum and `practice_mode` column/API/WebSocket contract were not
  retained.
- The concrete implementation is tracked in R0.

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
- If `display_anchor.render_note_ids` is present, those render IDs are the authoritative render projection for the current Verovio highlight path.
- Backend score groups/events remain the authoritative musical identity; render note IDs are only the concrete SVG anchors used by the current page.
- This phase is the first visual-following semantics slice, not the full phrase/fingering/rhythm assessment model.
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

Goal: prepare the practice system for microphone and MIDI input without binding product logic to one raw input shape.

Tasks:

1. Define input source abstractions without forcing every source into one raw frame shape.

```text
PerformanceInputSource
  -> AudioInputSource
  -> MidiInputSource
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

- Added `PracticeInputSource` with `MICROPHONE` and `MIDI`.
- Added persisted `input_source` to `PracticeSession` plus Alembic migration `0042_practice_input_source`.
- Added `input_source` to session creation request and session detail response.
- The frontend creates practice sessions with `input_source=MICROPHONE`.
- WebSocket `client.init` now includes `input_source`.
- The websocket validates `client.init.input_source` against the server-owned runtime source.
- Runtime registration carries `input_source` into the alignment engine.
- Matchmaker live alignment explicitly accepts only `MICROPHONE` input and fails clearly for unsupported sources.
- MIDI is represented in the API/database/runtime contract, but session creation still rejects it until the MIDI adapter and normalized evidence path are implemented.
- File replay is intentionally kept as a test harness capability, not a product input source.
- Verified with:
  - `ruff check` for changed backend input-source/protocol/runtime files and related tests.
  - `pytest tests/test_practice_service_access.py tests/test_practice_read_model.py tests/test_practice_api_smoke.py tests/test_practice_websocket_flow.py tests/test_practice_runtime_regressions.py::test_practice_runtime_registry_registers_and_releases_sessions tests/test_practice_runtime_regressions.py::test_practice_runtime_emits_ready_notification_once -q` -> 25 passed.
  - `pytest tests/test_storage_usage.py::test_score_delete_removes_practice_sessions -q` -> 1 passed.
  - `docker compose -f docker-compose.backend-dev.yml run --rm --no-deps --entrypoint python practice scripts/export_openapi.py practice-api`.
  - `npm run generate:practice-api-types` in `apps/customer-web`.
  - `npm run typecheck` in `apps/customer-web`.

Note:

- `tests/test_service_regressions.py` could not be collected in the `practice-quality` container because that image does not install `celery`; the relevant touched cases were reviewed and updated, but not executed in that container.

## Long-Term Practice and Report Roadmap

This section supersedes the earlier "four practice modes" product framing. The
earlier `PracticeMode` enum has been removed; the session policy fields are the
source of truth for new work.

Long-term product shape:

```text
User-facing entries:
  1. Step-by-step practice
  2. Full performance

Internal session configuration:
  progressionMode = WAIT_FOR_NOTE | CONTINUOUS
  realtimeGuidance = STATUS_ONLY | GUIDED
  evaluationProfile = LEARNING | PERFORMANCE
  inputSource = MICROPHONE | MIDI
```

Principles:

- Users should not need to choose between `FREE_FOLLOW`, `WAIT_FOR_NOTE`,
  `ASSESSMENT`, and `PERFORMANCE`.
- `Assessment` is an evaluation/summary capability, not a progression mode.
- `Performance` should not be a core mode unless it later means fixed-clock,
  metronome, accompaniment, or backing-track-driven performance.
- System analysis and displayed feedback are separate. Turning off realtime
  feedback reduces interruption during playing; it must not disable background
  observation or post-session analysis.
- Matchmaker provides position evidence. It must not be the sole authority for
  whether the current expected note or chord was played correctly.
- `ExpectedEventEvaluator` is the authority for normal Wait For Note progression.
  Matchmaker remains useful for relocalization, restart detection, and broader
  context.

Target data flow:

```text
Performance Input
  -> AudioObservation | MidiObservation
  -> EvaluatorEvidence
       -> observed pitches/chords
       -> onset/timing evidence
       -> Matchmaker position context
       -> confidence
  -> FollowPolicy
  -> AlignmentDecision / PracticeDecision
  -> UI highlight, feedback, and report event log
```

### Roadmap R0 - Replace Mode Taxonomy with Session Policy

Goal: keep product behavior out of a single overloaded mode enum.

Tasks:

1. Introduce a durable `PracticeSessionConfig` or equivalent policy object:

```ts
type ProgressionMode = "WAIT_FOR_NOTE" | "CONTINUOUS";
type RealtimeGuidance = "STATUS_ONLY" | "GUIDED";
type EvaluationProfile = "LEARNING" | "PERFORMANCE";

type PracticeSessionConfig = {
  progressionMode: ProgressionMode;
  realtimeGuidance: RealtimeGuidance;
  evaluationProfile: EvaluationProfile;
  inputSource: "MICROPHONE" | "MIDI";
};
```

2. Map current product presets to the policy object:
   - Step-by-step practice:
     - `progressionMode=WAIT_FOR_NOTE`
     - `realtimeGuidance=GUIDED`
     - `evaluationProfile=LEARNING`
   - Full performance:
     - `progressionMode=CONTINUOUS`
     - `realtimeGuidance=STATUS_ONLY` by default
     - `evaluationProfile=PERFORMANCE`

3. Keep compatibility with existing stored sessions while migrating new code to
   the policy object.
4. Update product copy and technical docs so `Assessment` and `Performance` are
   no longer described as peer realtime follower modes.

Acceptance criteria:

- The backend can derive the same existing Free Follow behavior from
  `progressionMode=CONTINUOUS`.
- New Wait For Note work can be implemented without adding another monolithic
  mode enum branch.
- User-facing copy uses "Step-by-step practice" and "Full performance" concepts,
  not technical follower taxonomy.

R0 implementation status:

- Added explicit session policy enums and fields:
  - `PracticeProgressionMode`: `WAIT_FOR_NOTE`, `CONTINUOUS`
  - `PracticeRealtimeGuidance`: `STATUS_ONLY`, `GUIDED`
  - `PracticeEvaluationProfile`: `LEARNING`, `PERFORMANCE`
- Added persisted `progression_mode`, `realtime_guidance`, and
  `evaluation_profile` to `PracticeSession` via Alembic migration
  `0041_practice_session_policy`.
- Session creation, session detail, WebSocket `client.init`, runtime registry,
  and generated customer-web API types now use the new policy fields.
- Current production behavior maps to:
  - `progression_mode=CONTINUOUS`
  - `realtime_guidance=STATUS_ONLY`
  - `evaluation_profile=PERFORMANCE`
- The old four-mode enum and `practice_mode` database/API/WebSocket contract were
  removed rather than retained as compatibility scaffolding.
- `WAIT_FOR_NOTE` is represented in the new policy contract but still rejected
  at session creation until R1/R1.5/R2 are implemented.
- Verified with:
  - OpenAPI export and customer-web practice API type generation.
  - `ruff check` for changed backend practice policy/runtime/protocol files and
    related tests.
  - `python -m mypy --config-file pyproject.toml` in `practice-quality` -> no
    issues in 350 source files.
  - `pytest tests/test_practice_service_access.py tests/test_practice_read_model.py tests/test_practice_api_smoke.py tests/test_practice_websocket_flow.py tests/test_practice_runtime_regressions.py tests/test_practice_follow_policy.py -q`
    -> 87 passed.
  - `npm run lint`, `npm run typecheck`, and
    `npm run test -- src/components/practice/practice-session-status.test.ts src/lib/practice/follow-controller.test.ts src/lib/practice/protocol.test.ts`
    in `apps/customer-web` -> 11 frontend tests passed.

### Roadmap R1 - Build Practice Targets and ExpectedEventEvaluator Contract

Goal: create the correctness evaluator required by Wait For Note and reports.

Tasks:

1. Define expected musical targets from `PracticeScoreTimeline`.
   The normal Wait For Note target is an `ExpectedPracticeGroup`, not simply the
   next raw timeline event:
   - playable entry group
   - pitches
   - staff/voice context
   - render anchors
   - chord membership
   - same-onset two-hand membership
   - tie/rest behavior
2. Define typed observations before normalization:
   - `AudioObservation`
   - `MidiObservation`
3. Define `EvaluatorEvidence` as the normalized musical input to evaluators:
   - observed pitches
   - chord evidence
   - onset/timing evidence
   - Matchmaker alignment context
   - confidence
4. Implement `ExpectedEventEvaluator` with conservative outcomes:

```text
MATCH
PARTIAL
MISMATCH
UNCERTAIN
```

5. Define the minimum runtime event contract used by both behavior and later
   reports:
   - `PracticeObservation`
   - `PracticeEventEvaluation`
   - `PracticeProgressionDecision`
   - evaluator/policy/profile provenance
6. Add synthetic evaluator tests for:
   - single notes
   - chords
   - same-onset two-hand groups
   - partial chords
   - wrong notes
   - pure tie continuations
   - rests followed by the first playable event

Acceptance criteria:

- Correctness decisions do not depend on `matchmaker.beat > expectedBeat`.
- `MATCH` is strong enough to advance Wait For Note.
- `PARTIAL`, `MISMATCH`, and `UNCERTAIN` are distinct and testable.
- Rests and pure tie continuations do not become expected user-played targets.
- The runtime contract exists before persistence and report aggregation are built.

R1 implementation status:

- Added `ExpectedPracticeGroup` to the practice score timeline.
- `PracticeScoreTimeline` can now project playable entry groups into expected
  practice targets with pitches, render anchors, staff/voice identity, measure
  numbers, and tie/rest-safe entry semantics.
- Added `ExpectedEventEvaluator` contract with:
  - `AudioObservation`
  - `MidiObservation`
  - `EvaluatorEvidence`
  - `PracticeObservation`
  - `PracticeEventEvaluation`
  - `PracticeProgressionDecision`
- Added conservative evaluator results:
  - `MATCH`
  - `PARTIAL`
  - `MISMATCH`
  - `UNCERTAIN`
- The evaluator does not inspect or trust Matchmaker beat advancement as proof
  of correctness; it compares normalized observed pitches against the expected
  practice group.
- Added synthetic tests for exact matches, partial chords, wrong/extra pitches,
  low-confidence acoustic uncertainty, runtime event contract shape, same-onset
  expected group projection, and pure tie-continuation suppression.
- Verified with:
  - `ruff check app/processing/engines/practice_alignment/score_timeline.py app/processing/engines/practice_alignment/expected_event_evaluator.py tests/test_practice_score_timeline.py tests/test_practice_expected_event_evaluator.py`.
  - `pytest tests/test_practice_score_timeline.py tests/test_practice_expected_event_evaluator.py -q`
    -> 7 passed.

### Roadmap R1.5 - Add Minimum Microphone Correctness Evidence

Goal: provide enough conservative acoustic evidence for the first Wait For Note
MVP before richer microphone analysis or MIDI input exists.

Tasks:

1. Add a minimal microphone pitch/chord observation layer that can feed
   `EvaluatorEvidence`.
2. Support high-confidence single-note evidence first.
3. Support only the simplest chord evidence when confidence is high.
4. Treat octave ambiguity, weak pitch confidence, noisy input, and complex chords
   as `UNCERTAIN`.
5. Add real-recording and synthetic tests for:
   - high-confidence single note match
   - wrong single note
   - uncertain low-confidence note
   - simple chord match when evidence is strong
   - partial chord
   - octave-ambiguous input

Acceptance criteria:

- Wait For Note has a usable microphone evidence source before its MVP ships.
- The first acoustic evaluator prefers `UNCERTAIN` over false wrong-note claims.
- More advanced polyphonic piano inference remains explicitly deferred to R8.

R1.5 implementation status:

- Added `AcousticEventObserver` and `AcousticPitchCandidate` in the backend
  practice-alignment domain.
- The observer converts normalized acoustic pitch candidates, or frequency
  estimates, into `AudioObservation` for `ExpectedEventEvaluator`.
- High-confidence single notes and simple high-confidence chords can produce
  evaluator evidence.
- Weak pitch confidence, invalid pitch names, octave-ambiguous input, and
  complex/noisy pitch sets return low-confidence empty observations so the
  evaluator reports `UNCERTAIN`.
- The observer is intentionally conservative and is not wired into live
  Wait For Note progression yet; R2 owns the runtime behavior.
- Added synthetic tests for:
  - high-confidence single-note match
  - wrong single note
  - uncertain low-confidence note
  - simple chord match
  - partial chord
  - octave-ambiguous input
  - complex noisy pitch sets
  - frequency-to-pitch candidate conversion
- Added a real-recording smoke test using the public Iowa C4 piano fixture and
  the production frequency-to-observation path.
- Verified with:
  - `ruff check app/processing/engines/practice_alignment/acoustic_event_observation.py tests/test_practice_acoustic_event_observation.py`.
  - `pytest tests/test_practice_acoustic_event_observation.py tests/test_practice_expected_event_evaluator.py tests/test_practice_score_timeline.py -q`
    -> 16 passed.
  - `python -m mypy --config-file pyproject.toml` in `practice-quality` -> no
    issues in 352 source files.

### Roadmap R2 - Implement Wait For Note MVP

Goal: deliver the first step-by-step practice experience.

Tasks:

1. Add `progressionMode=WAIT_FOR_NOTE` behavior.
2. Drive the current expected event/group from `PracticeScoreTimeline`.
3. Advance only on `ExpectedEventEvaluator` `MATCH`.
4. Wait on `PARTIAL`, hold on `MISMATCH`, and wait on `UNCERTAIN`.
5. Keep Matchmaker as auxiliary evidence for:
   - restarting from an earlier location
   - jumping to another section
   - recovering from lost context
6. Treat strong distant alignment conservatively in the first version:
   - hold the current expected group
   - tell the user the system may have detected a restart elsewhere
   - relocalize only after explicit user confirmation or a clearly defined
     product action
7. Update frontend highlighting so the expected group remains highlighted while
   the user is trying to play it.
8. Add calm user-facing states:
   - waiting for the correct note
   - heard something, keep playing
   - partial chord
   - finding your place
9. Add regression tests for:
   - correct single note advances
   - wrong note does not advance
   - repeated wrong notes followed by correct note advances
   - partial chord does not advance
   - long pause then correct note advances
   - restart/relocalization behavior

Acceptance criteria:

- Wait For Note never advances because Matchmaker drifted past the expected beat.
- The user can recover after long pauses and repeated mistakes without restarting
  the session.
- Highlight behavior remains stable and understandable during mistakes.
- Distant Matchmaker relocalization does not secretly move the lesson cursor.

R2 implementation status:

- Added `WaitForNoteFollowPolicy` as a separate step-by-step progression policy
  instead of mixing beginner-practice semantics into the existing Continuous
  follow policy.
- `WAIT_FOR_NOTE` now holds the current expected practice group when only raw
  Matchmaker alignment is available; Matchmaker beat advancement alone cannot
  move the step-by-step cursor.
- `WaitForNoteFollowPolicy.decide_evidence()` advances only when
  `ExpectedEventEvaluator` returns `MATCH`.
- `PARTIAL` waits at the current expected group with `reason=partial_match` and
  `experience_state=partially_matched`; this lets chord users complete the
  target without seeing a wrong-note state.
- `MISMATCH` holds the current expected group with `reason=entry_mismatch`.
- `UNCERTAIN` waits at the current expected group with
  `reason=low_alignment_confidence`.
- Backend session creation now accepts the coherent step-by-step preset:
  - `progression_mode=WAIT_FOR_NOTE`
  - `realtime_guidance=GUIDED`
  - `evaluation_profile=LEARNING`
  - `input_source=MICROPHONE`
- Incoherent Wait For Note presets are rejected explicitly, and MIDI remains
  rejected until R7 implements MIDI transport.
- Added policy tests for:
  - factory selection of Wait For Note policy
  - no advancement from raw alignment without evaluator evidence
  - correct note advances
  - wrong note holds
  - partial chord holds
  - uncertain audio waits
- Added the first live microphone decision path for `WAIT_FOR_NOTE`:
  - the runtime buffers a short recent PCM window for step-by-step sessions
  - onset frames are converted through the conservative R1.5 monophonic acoustic
    observer
  - the resulting `AudioObservation` is normalized into evaluator evidence
  - the policy advances only on `MATCH`
  - frames without a fresh onset keep waiting at the current target and do not
    repeatedly advance from a sustained note
- This live microphone path is intentionally limited to conservative single-note
  evidence. Richer polyphonic piano/chord inference remains R8.
- Current microphone pitch observation is not a piano note-recognition engine.
  The live PCM path uses a conservative dominant-frequency observer, which is
  suitable only for MVP single-note evidence and diagnostics. It can misread
  real piano fundamentals when harmonics dominate, and it cannot reliably prove
  true simultaneous polyphonic chords.
- Added runtime tests for:
  - live C4 PCM advancing the first Wait For Note target
  - live wrong-note PCM holding the first target
  - sustained/no-new-onset frames not repeatedly advancing the cursor
- Added the customer-web practice preset mapping:
  - Step-by-step practice creates `WAIT_FOR_NOTE + GUIDED + LEARNING +
    MICROPHONE` sessions.
  - Full performance creates `CONTINUOUS + STATUS_ONLY + PERFORMANCE +
    MICROPHONE` sessions.
- The practice settings panel now exposes the two user-facing practice entries
  instead of technical follower modes.
- The practice page defaults to Step-by-step practice and rebuilds the prepared
  session when the user changes the preset before starting.
- Frontend highlight behavior now allows backend `wait`/`hold` decisions with a
  `display_anchor` to show the current step-by-step target before the first
  accepted advance, while ordinary `wait` without an anchor still shows no
  note.
- Added frontend tests for:
  - step-by-step preset request mapping
  - full-performance preset request mapping
  - wait display anchors showing the current step-by-step target
- Remaining R2 work:
  - run browser-level manual/E2E validation against a live backend session
  - tune user-facing text and status behavior after real piano testing

### Roadmap R3 - Productize Continuous Full Performance

Goal: turn the current Free Follow behavior into the "Full performance" product
entry.

Tasks:

1. Map existing Free Follow behavior to `progressionMode=CONTINUOUS`.
2. Default to `realtimeGuidance=STATUS_ONLY`.
3. Always show system state:
   - current followed position
   - finding your place
   - input health
   - connection/session status
4. Make `realtimeGuidance=GUIDED` optional for lightweight live hints:
   - possible wrong note
   - possible missed note
   - rhythm running early/late
5. Ensure mistakes do not interrupt the performance flow.
6. Add replay tests for:
   - continuous correct performance
   - wrong notes in the middle followed by correct continuation
   - long pauses
   - restart from earlier measures
   - ending/completion boundary

Acceptance criteria:

- Full performance never behaves like Wait For Note.
- Turning guided realtime feedback off changes display behavior only; analysis
  continues.

### Roadmap R4 - Add Minimal Persistent Evaluation Model

Goal: persist event-level semantic records and provenance, not low-level audio
frames or every transient acoustic feature.

Tasks:

1. Persist durable event-level records derived from the R1 runtime contract:
   - `PracticeEventEvaluation`
   - `PracticeProgressionDecision`
   - `PracticeEventResult`
   - session summary payload
2. Record:
   - expected event/group
   - observed evidence
   - alignment beat
   - evaluator result
   - decision/action
   - timestamp
   - confidence
   - input source
   - evaluator version
   - policy profile version
   - score revision
   - audio/MIDI profile version
3. Keep transient low-level evidence out of durable storage by default:
   - do not permanently store every PCM frame
   - do not permanently store every 33ms chroma/acoustic feature
   - persist event-level semantic records instead
4. Treat `PracticeAttempt` as primarily a Wait For Note concept; do not force it
   onto Continuous sessions where an "attempt" may not be meaningful.
5. Make recording independent from realtime guidance visibility.

Acceptance criteria:

- Both step-by-step practice and full performance can produce reports.
- Reports can be regenerated or retuned from structured evidence.
- Turning off guided realtime feedback does not remove data needed for the final
  report.
- Persistent records include enough provenance to interpret old reports after
  evaluator or policy changes.

### Roadmap R5 - Build Learning Reports

Goal: generate reports for step-by-step practice sessions.

Initial metrics:

- total practice time
- completion progress
- attempts per event/group
- first-pass success rate
- longest dwell positions
- most difficult measures
- frequent wrong/partial events

UI targets:

- summary cards
- difficult-measure list
- score annotations for problem positions
- suggested measures to practice again

Acceptance criteria:

- A beginner can understand where they struggled without interpreting raw
  alignment data.
- Reports handle repeated wrong notes, partial chords, long pauses, early exit,
  and complete sessions.

R5 implementation status:

- Completed the first report UI pass on the product-facing
  `/score/[id]/practice/summary?sessionId=...` route.
- Renamed the route and copy from "performance" to "Practice summary" so this
  screen is not confused with the Full performance practice preset.
- The page now renders structured summary cards for:
  - target completion based on all reached targets;
  - match accuracy based on scorable attempts;
  - scoring coverage based on scorable attempts versus all attempts.
- The page now renders per-attempt rows using `attempt_uid`,
  `completion_status`, `scoring_included`, `resolution_reason`, confidence,
  result, measure numbers, and render-note anchors.
- Resolved attempts now persist `measure_numbers` from the expected practice
  group, so reports do not need to reverse-map note ids back into MusicXML at
  read time.
- Reports now include first-version `targets` and `difficult_measures`
  rollups:
  - target rollups aggregate attempts by expected group, including completion,
    partial/mismatch/interrupted counts, render-note ids, and measure numbers;
  - difficult-measure rollups aggregate those targets by measure number and sort
    by scorable musical difficulty. Session/system interruptions are reported as
    coverage/diagnostic facts, but they must not make a measure look musically
    harder;
  - the report page renders the top difficult measures as a review list.
- Added first-version score annotations on the Practice summary page:
  - the report page must load the exact `PracticeSession.revision_id` MusicXML,
    not the score's current head revision. Historical report evidence and
    rendered score annotations must refer to the same revision;
  - a narrow `PracticeSummaryAnnotationController` marks review/problem
    render-note ids from target aggregate status;
  - static report annotations are separate from realtime following state, so
    post-session review cannot mutate practice cursor behavior.
- Completed report correctness fixes:
  - the report page now loads MusicXML through the finished practice session's
    persisted `score_id` and `revision_id`, so historical annotations are pinned
    to the exact revision that produced the evidence;
  - the report route now rejects a `sessionId` whose `PracticeSession.score_id`
    does not match the score id in the route. A stale or wrong report link must
    fail explicitly instead of silently rendering evidence from a different
    score;
  - target locator metadata such as `measure_numbers` is kept on resolved
    attempt/summary semantics. Realtime `PracticeDisplayAnchor` stays a narrow
    cursor/render anchor and is not used as a general report metadata bag;
  - difficult-measure ranking now uses normalized scorable target difficulty
    rather than raw count totals that favor long or interrupted measures;
  - the report UI presents measure review reasons such as unresolved targets,
    wrong notes, or partial notes instead of exposing a raw difficulty score as
    if it were a precise learner-facing grade;
  - interrupted attempts remain visible in report coverage/diagnostics, but do
    not increase musical difficulty or learning accuracy penalties;
  - score annotations distinguish "completed after retries" review notes from
    unresolved wrong/partial problem notes instead of coloring every historical
    issue the same.
- Completed first report navigation interaction:
  - clicking a recommended measure selects the highest-priority problem/review
    target in that measure, then scrolls and transiently focuses its
    `render_note_ids`;
  - focus state is intentionally separate from static report annotations, so
    `problem` / `review` remains the semantic historical state and `focused`
    remains a temporary interaction state;
  - visual DOM ids are used only for score positioning. Future "practice this
    measure/target" commands should use domain locators such as `score_id`,
    `revision_id`, `measure_number`, and `expected_group_id`.
- Completed first scoped practice loop:
  - `PracticeSession` now stores an optional `practice_scope` with
    `start_expected_group_id`, `end_expected_group_id`,
    `start_measure_number`, and `end_measure_number`;
  - the report page's "practice" action sends users back to
    `/score/[id]/practice` with a domain locator contract, not with a rendered
    SVG DOM id;
  - the practice page loads the requested historical revision, shows a focused
    practice banner, keeps the session in Step-by-step practice, and sends
    `practice_scope` when creating the next practice session;
  - the backend accepts scoped sessions only for `WAIT_FOR_NOTE`, persists the
    scope, exposes it in session detail, and passes the start expected group to
    the runtime;
  - `WaitForNoteFollowPolicy` initializes from the scoped expected group,
    stops after the scoped end expected group, and rejects unknown target ids
    instead of silently falling back to the beginning.
- Current scoped-practice follow-up conclusions:
  - the first scoped loop briefly shipped as V1 open-ended scope: "start from
    this expected target and continue". It has now been upgraded to bounded
    target range semantics for report-driven measure practice;
  - `expected_group_id` is now a revision-local persistent practice target
    identity because it is used by historical reports to start future practice
    sessions. It must be deterministic for the same revision and timeline
    algorithm version;
  - `measure_number` remains display/analytics context only. It must not become
    a server fallback when `expected_group_id` is missing or invalid;
  - the backend already validates score/revision access during session creation,
    and scoped target membership now produces clear practice-specific domain
    errors rather than generic alignment-engine initialization failures;
  - bounded scope uses target identity through `start_expected_group_id` and
    `end_expected_group_id`, with measure numbers kept as display context.
- Completed scoped-practice hardening:
  - `PracticeScoreTimeline` now generates entry group ids from onset beat and
    stable event ids instead of pure traversal indexes such as `entry-0`;
  - regression coverage locks the invariant that the same revision/timeline
    input produces the same expected group ids;
  - invalid scoped target ids surface as `practice_scope_target_not_found`;
  - reversed scoped target ranges surface as `practice_scope_invalid`;
  - the report page sends both start and end target ids when launching measure
    practice, so the practice session completes after the selected measure
    range instead of automatically continuing into following measures.
- The page keeps raw diagnostic metrics in a compact secondary section instead
  of asking users to read an unstructured key/value dump.
- Added English and Chinese report labels for attempt result, completion status,
  resolution reason, and difficult-measure summaries.
- Added frontend coverage for summary loading and rendering states:
  - generated report rendering with summary cards, recommendations, metrics, and
    explicit attempt resolution semantics plus difficult-measure display;
  - loading the backend-authored summary artifact through a single GET request;
  - missing-session error handling without API calls;
  - empty attempts and empty recommendations.
- Completed browser E2E coverage for selected-section practice:
  - the E2E flow opens Practice with explicit `practiceRevisionId`,
    `practiceStartGroup`, `practiceEndGroup`, and display measure context, then
    starts the selected Step-by-step session;
  - the test verifies the created session request preserves the historical
    revision, MIDI input source, and bounded `practice_scope`;
  - the WebSocket mock verifies the selected session initializes as MIDI and can
    receive a `client.midi_event` without falling back to microphone frames;
  - the selected-section completion path is now covered: the mock emits a
    completed alignment plus `session.finished`, and the page shows a
    selected-section completion dialog with local practice choices only.
- Completed backend bounded-scope boundary coverage:
  - a multi-target policy invariant now locks `G2..G4` behavior over a
    five-target timeline;
  - the policy starts at the scoped start target, advances through middle
    targets, treats the end target as the final exposed target, and never
    exposes the following out-of-scope target.

### Roadmap R6 - Build Performance Reports

Goal: generate reports for full performance sessions.

Initial metrics:

- pitch accuracy
- missed notes
- extra notes
- rhythm deviation
- tempo stability
- continuity and pauses
- problem measures
- analysis coverage
- evaluation confidence

First version guidance:

- Prefer diagnostic reporting over a single high-stakes score.
- Keep confidence visible internally; low-confidence areas should be labeled as
  uncertain rather than confidently wrong.
- Do not report a simple accuracy percentage without showing how much of the
  performance was confidently analyzable.
- Avoid forcing a single unified score across Learning and Performance reports;
  their metric semantics are different.
- Suggest returning to step-by-step practice for difficult measures.

Acceptance criteria:

- The report identifies musical problem areas without requiring the performance
  to stop during playback.
- It handles wrong notes, missed notes, extra notes, tempo variance, pauses, and
  jumps/restarts.

### Roadmap R7 - Implement MIDI Input

Goal: make `inputSource=MIDI` a real product path.

Tasks:

1. Add MIDI event transport:
   - note on
   - note off
   - velocity
   - timestamp
2. Convert MIDI events into `EvaluatorEvidence`.
3. Use MIDI evidence as the primary source for Wait For Note correctness.
4. Use MIDI evidence for summary generation and optional continuous-follow
   assistance.
5. Add tests for single notes, chords, wrong notes, missed notes, sustain/tie
   behavior, and latency.

Acceptance criteria:

- MIDI sessions can use both step-by-step practice and full performance flows.
- MIDI correctness does not depend on acoustic pitch inference.

### Roadmap R8 - Improve Microphone Correctness Evidence

Goal: improve beyond the minimum R1.5 acoustic evidence without using
chroma-style position evidence as a precise correctness evaluator.

Tasks:

1. Add richer polyphonic piano evidence.
2. Improve chord and octave disambiguation.
3. Keep treating octave ambiguity and low confidence as `UNCERTAIN`.
4. Expand real-recording fixtures for:
   - single notes
   - chords
   - wrong notes
   - missed notes
   - noisy rooms
   - different speakers/microphones
5. Tune with false-positive prevention as the first priority.

Acceptance criteria:

- Microphone Wait For Note is useful without overclaiming wrong notes.
- Reports distinguish confident mistakes from uncertain evidence.

### Roadmap R9 - Update Practice UI

Goal: make the product model visible and simple.

Tasks:

1. Replace technical mode choices with two primary entries:
   - Step-by-step practice
   - Full performance
2. In Full performance, provide a light setting:
   - show live mistake hints: off by default
3. Expose input source:
   - microphone
   - MIDI
4. Keep in-session status calm and compact.
5. Route completed sessions into the appropriate report view.

Acceptance criteria:

- Users do not see `Free Follow`, `Assessment`, or `Performance` as technical
  choices.
- The UI matches the underlying `PracticeSessionConfig` presets.

### Roadmap R10 - Future Extensions

Do not start these until the two main flows and reports are stable:

- fixed-clock/accompaniment/metronome-driven progression
- hand-specific practice
- measure loop practice
- automatic difficult-section recommendations
- practice plans
- long-term learning trends
- teacher/student report views

## 2026-08-24 Latest Refactor and Improvement Backlog

This section records the latest priorities after the real page failure where
Step-by-step practice reached `session.armed` but produced no visible response
when the user played. The downloaded browser recording
`f34f5d02-aea9-4740-82a0-2f34748911b4.weba` proved that the microphone captured
real piano input, while offline replay showed that `WAIT_FOR_NOTE` was blocked
behind the continuous follower startup gate. The first fix decoupled
`WAIT_FOR_NOTE` from `continuous started`, but the input and decision layers
still need to be tightened.

### Latest P0 - Immediate Correctness Work

1. Directly replay the real recording through `CONTINUOUS`.
   - Use the same decoded 16 kHz mono PCM from
     `f34f5d02-aea9-4740-82a0-2f34748911b4.weba`.
   - Run it through the Full performance / `CONTINUOUS` engine path.
   - Record whether startup reaches `start_confirmed`, when the first alignment
     appears, and which gate reasons dominate failures.
   - This must replace indirect inference from `WAIT_FOR_NOTE`; the current
     evidence only proves that `CONTINUOUS` is at risk, not that it definitely
     fails for this recording.

   Execution status, 2026-08-24:
   - Added `backend/scripts/diagnose_practice_recording.py` to replay one
     browser recording through the live engine and emit fixed diagnostics.
   - Replayed
     `f34f5d02-aea9-4740-82a0-2f34748911b4.weba` against the
     `d18c0e98-1dfd-4102-b89c-4612fda238e0` score in `CONTINUOUS` mode.
   - Result: `start_confirmed=false`, `emitted_updates=0`,
     `final_stream_state=armed`, `final_gate_reason=not_tonal`.
   - Gate distribution: `not_tonal=380`, `low_start_rms=4`,
     `not_tonal_frame_ratio=0.9896`.
   - This confirms the recording is blocked before initial alignment; the
     dominant failure is the MusicalActivity/start-admission layer, not a later
     Matchmaker alignment failure.
   - `WAIT_FOR_NOTE` replay of the same recording emits decisions after the
     decoupling fix, but it still reports the same low-level gate distribution;
     this reinforces that Step-by-step and Full performance need separate
     admission semantics.

2. Move `WAIT_FOR_NOTE` from frame-level updates to a minimal event-level
   attempt model.
   - The current unblock changes real recording replay from `updates=0` to
     many backend decisions, which is a necessary improvement.
   - P0 must not include the full persistence or report attempt model.
   - The immediate invariant is: one user performance intention produces at
     most one evaluator result and at most one progression decision.
   - Minimal target model:

```text
PCM frames
  -> AcousticEventSegment
  -> short AcousticEventObservation window
  -> one ExpectedEventEvaluator result
  -> one PracticeDecision
```

   - Onset or a strong musical activity candidate starts one candidate event.
   - Sustain frames must not create repeated attempts.
   - A silence or release boundary is required before the next attempt.
   - Chord notes that arrive a few frames apart should be collected in a short
     observation window rather than treated as separate attempts.
   - A correct event can advance the expected group exactly once.

   Execution status, 2026-08-24:
   - Added a minimal in-memory acoustic event state machine for
     `WAIT_FOR_NOTE`.
   - The engine now opens one candidate event, collects a short observation
     window, emits at most one evaluator/progression decision, and waits for a
     release boundary before allowing the next candidate event.
   - Replayed
     `f34f5d02-aea9-4740-82a0-2f34748911b4.weba` in `WAIT_FOR_NOTE` mode after
     the change: backend decision updates dropped from `44` to `8`, matching the
     real recording's event-level shape much more closely while still producing
     feedback.
   - This is still not the final persistent `PracticeAttempt` model; it is the
     minimum realtime exactly-once progression layer.

3. Add missing `WAIT_FOR_NOTE` regression tests before or alongside the event
   segmentation implementation.
   - Wrong pitch after `armed` holds the current expected group and emits
     `possible_wrong_note`.
   - Wrong pitch followed by the correct pitch advances exactly once.
   - Noisy or low-confidence input produces `UNCERTAIN` / `heard_but_uncertain`
     rather than a confident wrong-note claim.
   - High-confidence non-musical transient input is ignored rather than emitted
     as repeated `UNCERTAIN` updates.
   - Partial chord does not advance.
   - Chord notes arriving within the collection window are evaluated as one
     candidate chord.
   - Long pause after `armed` followed by the correct note still works.
   - `WAIT_FOR_NOTE` progression must not depend on Matchmaker continuous
     `started` / initial-alignment confirmation.

   Execution status, 2026-08-24:
   - Added regression coverage for sustained correct events: one sustained
     correct note advances exactly once.
   - Added regression coverage for sustained wrong events: one sustained wrong
     note emits one `entry_mismatch` decision until release.
   - Added release-and-retry coverage: after a release boundary, the correct
     note can produce the next decision.

4. Add a real browser end-to-end smoke test.
   - Verify the actual transport chain:

```text
AudioWorklet
  -> downsample
  -> PCM16 encode
  -> WebSocket
  -> backend decision
  -> frontend status/highlight
```

   - WebM replay is valuable for backend semantics but is not equivalent to the
     real browser PCM stream because MediaRecorder uses WebM/Opus and a separate
     recording pipeline.

   Execution status, 2026-08-24:
   - Added `apps/customer-web/tests/e2e/practice-step-by-step-smoke.spec.ts`.
   - The test runs the real practice page with mocked score/session API
     responses, mocked browser microphone/AudioWorklet/MediaRecorder APIs, and a
     mocked practice WebSocket.
   - It verifies that clicking Start sends `client.init`, starts PCM frame
     transmission over WebSocket, accepts `session.ready`, `session.armed`, and
     `alignment.update`, and moves the visible status from first-note waiting to
     realtime following with Pause/Finish enabled.
   - This is a frontend transport/UI smoke, not an acoustic recognition accuracy
     test; backend recognition semantics remain covered by replay and runtime
     regression tests.

5. Add PCM residual buffer lifecycle invariants.
   - Partial PCM buffered before `pause` must not be stitched to post-`resume`
     audio as if it were one continuous analysis frame.
   - `finish`, `disconnect`, runtime release, and new session creation must clear
     pending analysis buffers.
   - These tests should cover both transport chunk buffering and
     `WAIT_FOR_NOTE` event-observation buffers.

   Execution status, 2026-08-24:
   - `PracticeSessionRuntime.reset_input_buffer()` now clears both the bounded
     transport `AudioChunkBuffer` and the alignment engine's internal input
     buffers.
   - `PracticeSessionRuntime.close()` continues to route through
     `reset_input_buffer()` before closing the engine, so finish, disconnect,
     registry release, and registry clear share the same cleanup semantics.
   - Added regression coverage proving runtime reset clears transport and engine
     buffers.
   - Added regression coverage proving runtime close clears input buffers before
     closing the engine.
   - Added regression coverage proving `MatchmakerLiveEngine.reset_input_buffer()`
     clears partial transport audio plus `WAIT_FOR_NOTE` event audio, open/event
     frame counters, evaluated flags, and release counters.
   - Verified with the full runtime regression suite:
     `pytest tests/test_practice_runtime_regressions.py -q` -> 67 passed.

6. Decide and fix immediate `CONTINUOUS` startup-admission risk.
   - Replay and browser smoke results showed that Step-by-step transport/UI was
     working, while Full performance / `CONTINUOUS` could still remain stuck at
     `armed` for the downloaded browser recording.
   - The correct P0 fix is not broad threshold lowering. Startup admission must
     let credible musical candidates reach score-start validation while keeping
     speech, typing, knocks, and mixed non-music negatives blocked.

   Execution status, 2026-08-24:
   - Confirmed this is a P0 issue: before the fix,
     `f34f5d02-aea9-4740-82a0-2f34748911b4.weba` in `CONTINUOUS` mode produced
     `start_confirmed=false`, `emitted_updates=0`, and
     `final_gate_reason=not_tonal`.
   - Added a narrow `focused_musical_start` candidate path. Frames with slightly
     too-high spectral flatness but strong, focused peak prominence can now
     reach score-start feature validation instead of being rejected immediately
     as `not_tonal`.
   - Kept ordinary tonal `strong_start` conservative: a single high score-start
     feature match is not enough for the tonal path, because mixed non-music can
     occasionally look like the score in chroma space.
   - Allowed a single near-certain score-start feature match only for the
     `focused_musical_start` path; otherwise startup still requires repeated
     matching candidates.
   - Restricted initial startup validation to the first playable score beat.
     Later-entry relocalization should be handled after startup, not by silently
     anchoring initial start to a later beat.
   - After the fix, the downloaded browser recording in `CONTINUOUS` mode
     produces `start_confirmed=true`, `start_confirmed_seconds=3.36`,
     `first_update_seconds=3.36`, `first_alignment_beat=3.0`, and
     `emitted_updates=1`.
   - Remaining limitation: this fixes the start-admission blocker, but this
     particular recording still falls to `lost` later and emits no reliable
     high-confidence alignment after startup. That follow-quality issue belongs
     to the dedicated `CONTINUOUS` replay suite and follower-quality work, not
     the immediate startup gate.
   - Verified with:
     - `pytest tests/test_practice_runtime_regressions.py -q` -> 69 passed.
     - `scripts/evaluate_practice_replay.py --manifest initial_alignment_manifest.json`
       -> passed.
     - `scripts/evaluate_practice_replay.py --manifest profile_manifest.json`
       -> passed, including speech, cough, keyboard, desk-knock, and mixed
       non-music negatives.

### Latest P1 - Step-by-step Practice Architecture

1. Introduce explicit `AcousticEventObservation` / `PracticeAttempt` semantics.
   - Separate event segmentation from pitch/chord observation.
   - Keep pitch evidence conservative; a low-confidence observation should not
     become a confident wrong note.
   - Preserve enough attempt data for future learning reports.
   - Do not treat `PracticeAttempt` / attempt accumulation as proof that
     microphone chord recognition is solved. Attempt accumulation only decides
     which observations belong to the same user attempt and when the attempt is
     finalized. Acoustic observation / expected-group verification decides
     whether the real sound actually contains enough evidence for each expected
     pitch.
   - Distinguish internal collection from finalized `PARTIAL`: during the short
     chord/grace collection window, partial evidence should remain internal and
     should not immediately become user-visible feedback. Only after the attempt
     is finalized and still missing expected pitches should it emit `PARTIAL`.
   - Normal chord onset spread, for example C/E/G arriving tens of milliseconds
     apart, should be collected as one attempt and can advance exactly once when
     the expected group is complete.
   - A finalized partial attempt should keep the current expected group stable.
     The product should prefer allowing the user to complete the same expected
     group within a clear grace policy over forcing a full release/retry for
     every partial chord.

   Current decision, 2026-08-24:
   - Next implementation work should focus on an explicit
     `ExpectedGroupAttemptAccumulator` or equivalent runtime object.
   - The accumulator should cover:
     - one attempt per normal chord gesture;
     - delayed finalization until the collection/grace window closes;
     - observation merging across frames/onsets;
     - exactly-once advancement on `MATCH`;
     - no repeated attempts for sustain;
     - no user-visible `PARTIAL` while the system is still collecting a normal
       chord gesture.
   - This is an attempt-lifecycle correctness task, not a claim that microphone
     polyphonic chord recognition is complete.

   Execution status, 2026-08-24:
   - Added `ExpectedGroupAttemptAccumulator` as an explicit runtime object for
     Wait For Note attempt lifecycle state.
   - `MatchmakerLiveEngine` now delegates Wait For Note attempt audio, open
     state, release state, and exactly-once evaluation gating to this
     accumulator instead of owning scattered private counters.
   - The accumulator observes each candidate frame conservatively and merges
     pitch evidence across the collection window. This lets rolled or slightly
     spread chord gestures become one finalized attempt when the observer can
     identify the pitches in separate frames.
   - The accumulator emits no finalized observation before the collection window
     closes, preventing normal early partial evidence from immediately becoming
     user-visible feedback.
   - Sustained input after the finalized observation does not produce repeated
     decisions until a release boundary resets the attempt.
   - Explicit limitation: this does not solve simultaneous microphone chord
     transcription. If the acoustic observer only returns one dominant pitch for
     a real simultaneous chord, the accumulator cannot infer the missing pitches.
   - Added tests for:
     - rolled C/E/G evidence collected across the window and finalized as one
       `MATCH`;
     - no repeated observation for sustained input before release;
     - runtime buffer reset clearing accumulator state;
     - existing Wait For Note live single-note and wrong-note behavior after the
       accumulator integration.
   - Verified with:
     - `pytest tests/test_practice_expected_group_attempt_accumulator.py tests/test_practice_runtime_regressions.py -q`
       -> 72 passed.
     - `ruff check app/processing/engines/practice_alignment/expected_group_attempt_accumulator.py app/processing/engines/practice_alignment/matchmaker_live.py tests/test_practice_expected_group_attempt_accumulator.py tests/test_practice_runtime_regressions.py`
       -> passed.
     - `mypy app/processing/engines/practice_alignment/expected_group_attempt_accumulator.py app/processing/engines/practice_alignment/matchmaker_live.py`
       -> no issues.

2. Define low-confidence and non-musical behavior consistently.
   - Credible pitch mismatch -> `MISMATCH` / `possible_wrong_note`.
   - Audible but unclear event -> `UNCERTAIN` / `heard_but_uncertain`.
   - Clearly non-musical transient -> `IGNORE`; it should not become a practice
     attempt and should not repeatedly disturb the UI.
   - Avoid false wrong-note feedback as the higher-priority product risk.
   - `UNCERTAIN` means "possibly user performance, but not reliably
     interpretable"; `IGNORE` means "not worth treating as a practice attempt".

3. Establish a microphone capability matrix before claiming strict microphone
   chord support.
   - Synthetic evaluator tests prove business logic for known pitch sets, but
     they do not prove that real microphone PCM can produce those pitch sets.
   - Add real or authorized fixture coverage for:
     - single notes: pitch accuracy, octave errors, uncertain rate;
     - repeated single notes: attempt duplication risk;
     - two-note and three-note chords: whether all expected pitches are observed;
     - rolled chords: whether accumulation helps;
     - same-onset two-hand groups;
     - sustain pedal: repeated/contaminated evidence;
     - background noise and different microphone distances.
   - If real microphone data shows reliable single-note behavior but weak chord
     behavior, ship microphone Wait For Note as strict for single notes and
     best-effort/uncertain-friendly for chords. MIDI should become the high
     reliability path for strict chord verification.

   Execution status, 2026-08-24:
   - Added the first capability baseline in
     `tests/test_practice_microphone_capability_matrix.py`.
   - The matrix currently proves:
     - real public Iowa C4/C5 piano single notes match through the production
       `observe_mono_pcm` path;
     - synthetic rolled C/E/G frames can be merged by
       `ExpectedGroupAttemptAccumulator` into one expected-group `MATCH`;
     - simultaneous synthetic C/E/G and real C4+C5 octave mixtures are not
       classified as strict microphone chord matches, documenting the current
       dominant-frequency observer's limitation.
   - This baseline intentionally separates acoustic capability from evaluator
     unit tests. Known pitch-set tests can prove `ExpectedEventEvaluator`
     semantics, but only PCM/fixture tests prove microphone recognition
     capability.
   - Verified with:
     - `pytest tests/test_practice_microphone_capability_matrix.py -q` -> 4
       passed.
     - `ruff check tests/test_practice_microphone_capability_matrix.py` ->
       passed.

   Execution status, 2026-08-24:
   - Added the first microphone-specific chord policy in
     `WaitForNoteFollowPolicy`.
   - Single-note microphone targets remain strict: only `MATCH` advances.
   - Multi-note microphone targets now use best-effort advancement when the
     acoustic evidence produces a confident `PARTIAL`. This prevents the current
     dominant-frequency observer from blocking a chord target forever when it
     can only identify one expected pitch.
   - `MISMATCH` and `UNCERTAIN` still do not advance.
   - MIDI remains strict: a MIDI `PARTIAL` still waits at the current target
     because MIDI note evidence is expected to be reliable enough for exact
     chord verification once MIDI transport is implemented.
   - This is a product fallback for the current microphone reliability tier, not
     proof of strict microphone chord recognition.
   - Verified with:
     - `pytest tests/test_practice_follow_policy.py tests/test_practice_runtime_regressions.py tests/test_practice_microphone_capability_matrix.py -q`
       -> 87 passed.
     - `ruff check app/processing/engines/practice_alignment/follow_policy.py app/processing/engines/practice_alignment/matchmaker_live.py tests/test_practice_follow_policy.py`
       -> passed.

4. Explore expected-conditioned acoustic verification separately from attempt
   accumulation.
   - Wait For Note knows the expected group, so the long-term microphone problem
     is closer to closed-set verification than open-world transcription.
   - Candidate directions include CQT or harmonic-salience checks conditioned on
     the expected pitches, plus unexpected-evidence scoring.
   - Full polyphonic transcription models such as Basic Pitch or
     Onsets-and-Frames style approaches should be evaluated as experiments or
     benchmarks before being added to the realtime backend. Measure latency,
     CPU/GPU cost, false positives, chord recall, and browser streaming fit.

   Model research decision, 2026-08-24:
   - There is no currently identified open-source model that clearly wins all
     four product dimensions at once:
     - real piano microphone accuracy;
     - strict streaming/causal inference;
     - low interactive latency;
     - mature production-ready maintenance.
   - Do not keep extending the current dominant-FFT observer into a full piano
     recognizer. Keep it as a transparent baseline for single-note MVP behavior
     and diagnostics.
   - Do not replace `CONTINUOUS` score following with an AMT/transcription model.
     Matchmaker remains the right primary engine for position following.
   - Do not adopt `qiuqiangkong/piano_transcription_inference` as the live
     `WAIT_FOR_NOTE` engine. It is valuable as an offline high-accuracy
     piano-reference transcriber and report/benchmark oracle, but its standard
     inference path is segment/offline oriented.
   - Do not prioritize MT3 / YourMT3-style models for this product path. They
     solve a broader multi-instrument transcription problem and are not a good
     fit for low-latency solo-piano expected-note interaction.
   - Treat Basic Pitch as a useful offline/reference benchmark and possible
     sliding-window experiment, not as the default live engine.
   - Prioritize causal/online piano transcription candidates for the realtime
     spike:
     - `huispaty/rtt`: minimum-latency causal piano transcription research
       baseline; promising for low-latency experiments, not automatically the
       most accurate production model.
     - `jdasam/online_amt`: older but direct online piano transcription
       baseline with realtime demo structure.
     - Transkun V2 or `qiuqiangkong/piano_transcription_inference` as offline
       oracle/reference, not live engines.
   - Prefer extracting onset/pitch probabilities or normalized pitch evidence
     into NoteVerse's own `ExpectedGroupEvaluator` over blindly consuming a
     third-party "audio -> MIDI" output. The product needs
     expected-group-conditioned decisions:

```text
PCM
  -> causal acoustic model / baseline observer
  -> expected pitch evidence
  -> ExpectedGroupAttemptAccumulator
  -> ExpectedGroupEvaluator
  -> MATCH / PARTIAL / MISMATCH / UNCERTAIN
```

   - Benchmark metrics must be product metrics, not only AMT leaderboard F1:
     - expected-group correct-match recall;
     - false advance rate;
     - failure-to-advance rate;
     - false mismatch rate;
     - uncertain rate;
     - p50/p95 decision latency;
     - chord-completion latency;
     - duplicate attempt rate;
     - CPU, memory, and model warmup cost.
   - This benchmark should run on the same authorized microphone capability
     fixture matrix used by the current observer, then expand to real laptop mic
     captures before any live-engine replacement decision.

5. Split continuous startup state instead of relying on one overloaded boolean.
   - Current `started` means the continuous follower has confirmed initial
     alignment, not that the user has started practicing.
   - The long-term state model should separate at least:
     - `performance_armed`
     - `initial_alignment_confirmed`
     - `continuous_follower_running`
   - This avoids future bugs where `WAIT_FOR_NOTE` accidentally depends on
     continuous follower state.

6. Revisit protocol naming.
   - `alignment.update` can carry current decisions for compatibility, but it is
     no longer semantically ideal for `WAIT_FOR_NOTE`.
   - Longer-term protocol should expose a general `PracticeDecision` with
     optional `alignment` and optional `evaluation`.
   - `WAIT_FOR_NOTE` should be event-evaluation-driven; `CONTINUOUS` should be
     alignment-driven.

### Latest P2 - Input Calibration and Health

1. Replace or extend `environment_quality` with `InputHealth`.
   - Current `good/noisy/poor` is a calibration-time RMS/peak heuristic, not a
     full environment-quality judgment.
   - Do not model input health as a single long-term severity enum because
     `NOISY`, `TOO_QUIET`, and `CLIPPING` can overlap.
   - Prefer a structured model, for example:

```ts
type InputHealth = {
  available: boolean;
  level: "good" | "too_quiet" | "clipping";
  noise: "good" | "elevated" | "high";
  confidence: number;
};
```

   - A first implementation can still project this to simple UI copy, but the
     domain model should preserve separate causes.

2. Improve environment-noise UX.
   - `NOISY`: allow continuation, but warn that accuracy may be reduced.
   - `POOR` or future high-risk input states: recommend recalibration and offer
     an explicit choice such as `Recalibrate` / `Continue`.
   - Do not hard-block practice from one noisy calibration unless input is
     unavailable or severely clipped.

3. Protect the calibration window from user playing.
   - The first warmup frames are around one second of input.
   - If the user plays during that period, the system can treat piano sound as
     environmental baseline and show misleading noisy/poor warnings.
   - The UI should make the boundary explicit:

```text
Checking microphone. Please do not play.
  -> session.armed
You can start playing.
```

4. Make calibration more than absolute RMS/peak.
   - Add clipping ratio, spectral characteristics, and runtime signal-to-noise
     evidence.
   - Update the noise baseline only when the system has strong evidence that the
     input is inactive or non-musical.
   - Combine calibration risk with runtime recognition behavior before escalating
     UX warnings.

### Latest P3 - Full Performance / CONTINUOUS Admission

1. Build a dedicated `CONTINUOUS` startup-admission replay suite.
   - Positive examples:
     - real piano at multiple microphone distances
     - single notes
     - chords
     - soft and loud dynamics
     - different rooms and reverb profiles
     - weak pickup / anacrusis-like entry
     - repeated-note openings
     - rest followed by first note
     - two hands or chord tones entering tens of milliseconds apart
   - Negative examples:
     - speech
     - typing
     - table taps
     - coughs
     - pedal noise
     - ambient noise
   - Transport/device variation:
     - browser sample rates `44.1 kHz -> 16 kHz` and `48 kHz -> 16 kHz`
     - different PCM chunk sizes and chunk phases

2. Measure startup behavior rather than tuning blindly.
   - Track start recall, false-start rate, time-to-start, dominant gate reasons,
     and first-alignment beat.
   - Do not simply lower `max_spectral_flatness`, `min_peak_prominence`, RMS, or
     peak thresholds without positive and negative replay evidence.

3. Split continuous startup admission into separate concepts.

```text
InputHealth
  -> MusicalActivity
  -> InitialAlignmentEvidence
  -> FollowerStart
```

   - The current gate is doing too many jobs at once: "is there input?", "does it
     sound musical?", "does it resemble the opening?", and "may the follower
     start?".

4. Build a separate `CONTINUOUS` follow-quality replay baseline.
   - Startup admission answers "may the follower begin?". It does not prove that
     the follower stays useful after it starts.
   - Track at minimum:
     - time to first reliable alignment
     - reliable alignment update count and ratio
     - following / holding / lost state coverage
     - first lost time and lost episode count
     - alignment advance and large false-jump count
     - recovery latency after pauses or wrong-note sections
   - First-pass diagnostics can use engine output without ground-truth beat/time
     labels. Later, fixture-specific reference timelines should add median/p95
     alignment error and completion success.
   - Cover normal continuous playing, soft playing, long pauses, mid-piece wrong
     notes, restart from the last reliable position, chords/two-hand entries,
     noisy rooms, and different microphone distances.

### Latest P4 - Product and Reporting Follow-through

1. Keep the user-facing model to two primary flows.
   - Step-by-step practice -> `WAIT_FOR_NOTE + GUIDED + LEARNING`.
   - Full performance -> `CONTINUOUS + STATUS_ONLY + PERFORMANCE`.
   - Do not expose technical mode names or deprecated four-mode taxonomy to
     users.

2. Define highlight behavior from decisions.
   - Wrong note: keep the current expected anchor visible.
   - Uncertain input: do not advance and avoid confident wrong-note language.
   - Correct event: advance to the next expected anchor exactly once.
   - Recovery/restart behavior should be explicit rather than an accidental
     Matchmaker jump.

3. Build reports from attempts and decisions, not raw frames.
   - Store event-level semantic records:
     - expected group
     - attempts
     - result: correct, wrong, partial, uncertain, missed
     - first-pass time
     - repeated errors
     - confidence
   - Full performance reports can include continuous alignment diagnostics, but
     Step-by-step learning reports need attempt-level correctness records.

4. Keep Matchmaker as optional localization evidence for `WAIT_FOR_NOTE`.
   - `ExpectedEventEvaluator` remains the progression authority.
   - Matchmaker may later help detect that the user restarted from another
     section, but it should not silently advance Step-by-step practice without a
     clear product decision.

### Latest Recommended Execution Order

1. Direct `CONTINUOUS` replay of the real downloaded recording.
2. Failing event-level `WAIT_FOR_NOTE` regression tests, especially
   wrong-then-correct, uncertain/noisy inputs, chord collection, and exactly-once
   progression.
3. Minimal `WAIT_FOR_NOTE` AcousticEvent segmentation and duplicate decision
   suppression.
4. Browser end-to-end smoke test for AudioWorklet/WebSocket/page behavior.
   - Completed 2026-08-24 for Step-by-step practice transport/UI smoke.
5. PCM residual buffer lifecycle tests for pause/resume/finish/disconnect/new
   session.
   - Completed 2026-08-24 for runtime transport buffer and `WAIT_FOR_NOTE`
     event-buffer cleanup.
6. Use E2E and replay results to decide whether `CONTINUOUS` startup admission
   needs immediate P0 treatment.
   - Completed 2026-08-24. Decision: yes, it needed P0 treatment. Minimal
     startup-admission fix implemented and replay-verified.
   - The fix is intentionally narrow: a focused musical candidate may start on a
     single near-certain first-anchor match, but ordinary tonal starts still
     require repeated evidence. Treat this as a P0 safety patch, not the final
     startup architecture.
   - Current initial validation is scoped to the first playable score event
     because the current Full performance entry starts from the beginning. The
     long-term model should expose an explicit `expectedStartAnchor` /
     `session.startAnchor`, defaulting to the first playable event only when the
     user chooses full-piece start.
   - The real downloaded recording should not be committed as a fixture. Add a
     privacy-safe authorized or synthesized regression fixture with the same
     failure shape: focused piano energy, higher-than-strict tonal flatness,
     strong peak prominence, and high confidence against the expected start
     anchor.
   - Chroma start confidence is startup-local similarity evidence, not a
     probability of correctness and not an absolute-pitch verdict. Keep
     `CONTINUOUS` localization evidence separate from `WAIT_FOR_NOTE`
     correctness evidence.
7. Add `CONTINUOUS` follow-quality diagnostics to the local replay tooling.
   - Measure startup and post-start tracking separately.
   - Track reliable update count, reliable-update ratio, time to first reliable
     alignment, stream-state coverage, first lost time, lost episode count, and
     alignment advance.
   - This remains local regression/diagnostic tooling, not production
     observability.
   - Completed first local diagnostic pass on 2026-08-24 in
     `scripts/diagnose_practice_recording.py`. The report now emits
     `follow_quality` fields for reliable updates, time to first reliable
     alignment, following/holding/lost ratios, first lost time, lost episodes,
     and alignment beat advance.
   - Completed replay-baseline pass on 2026-08-24 in
     `scripts/evaluate_practice_replay.py`. Positive `CONTINUOUS` scenarios can
     now assert reliable-update ratio, time to first reliable alignment,
     following/lost coverage, and lost episode count. `profile_manifest.json`
     and `initial_alignment_manifest.json` both enforce conservative
     follow-quality thresholds for their Once Again positive scenarios.
8. Structured `InputHealth` design and calibration UX update.
   - Completed first implementation on 2026-08-24.
   - Replaced the old `environment_quality=good/noisy/poor` armed-session field
     with structured `input_health`:
     - `available`
     - `level=good | too_quiet | clipping`
     - `noise=good | elevated | high`
     - `confidence`
   - The backend now emits `input_health` from the practice audio stream,
     runtime, and WebSocket protocol without keeping a compatibility
     `environment_quality` field.
   - The frontend now maps `input_health` to clearer user guidance. Elevated and
     high background noise warn that accuracy may be reduced but still allow the
     user to continue. Clipping and unavailable input are treated as stronger
     input-health risks.
   - The Practice WebSocket contract was regenerated and checked.
   - Completed runtime update pass on 2026-08-24. `alignment.update` now carries
     the same structured `input_health` object, so the UI can show ongoing input
     hints during practice rather than relying only on the one-time
     `session.armed` calibration result.
   - Runtime `InputHealth` combines calibration baseline with current-frame
     evidence:
     - clipping is detected immediately from the current peak level;
     - `too_quiet` is emitted only after practice has started and sustained
       no-input frames accumulate;
     - runtime noise updates are taken only from non-musical frames, avoiding
       false "background noise" warnings while the user is playing piano.
   - The practice status bar now reads `alignment.input_health` for microphone
     hints such as low input, clipping, elevated noise, and high noise.
9. Dedicated `CONTINUOUS` startup-admission and follow-quality replay suite.
   - Completed first privacy-safe baseline on 2026-08-24 in
     `tests/fixtures/practice_audio/continuous_follow_quality_manifest.json`.
   - The suite covers:
     - a clean Once Again continuous excerpt;
     - the same excerpt mixed with authorized background speech;
     - the same excerpt followed by explicit synthetic tail silence.
   - `scripts/evaluate_practice_replay.py` now supports explicit `silence`
     frame segments and `tail_ignore_seconds`, so phrase-quality metrics can
     ignore intentionally appended post-performance silence without weakening
     startup or active-following checks.
   - The baseline asserts startup latency, first alignment anchor, alignment
     advance, reliable-update ratio, time to first reliable alignment,
     following coverage, lost-frame ratio, and lost episode count.
   - Current validation result:
     - clean excerpt: starts at 0.466s, first alignment beat 3.0, advances
       21.07 beats, no lost episodes;
     - background speech mix: starts at 0.466s, first alignment beat 3.0,
       advances 9.87 beats, no lost episodes;
     - tail silence scenario: starts at 0.466s, first alignment beat 3.0,
       advances 21.07 beats, no lost episodes after excluding the explicit
       post-performance silence window.
   - This does not replace broader `CONTINUOUS` product validation. It is the
     first committed regression baseline for the startup-admission fix and
     post-start follow-quality metrics.
10. Attempt/decision persistence for reports.

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

The original correctness phases P0-P6 have established the realtime foundation,
decision contract, visual anchor model, and microphone/MIDI-ready input contract.
The next implementation sequence is:

1. R0: replace the four-mode taxonomy with `PracticeSessionConfig` and user-facing
   presets for Step-by-step practice and Full performance.
2. R1: build the expected practice target and `ExpectedEventEvaluator` contract.
3. R1.5: add minimum conservative microphone correctness evidence.
4. R2: implement Wait For Note / Step-by-step practice MVP.
5. R3: productize the current Free Follow behavior as Continuous / Full
   performance.
6. R4: add the minimal persistent evaluation model.
7. R5: build Learning reports for step-by-step practice.
8. R6: build Performance diagnostic reports with analysis coverage/confidence.
9. R7: implement MIDI input as a real product path.
   - Completed first implementation pass on 2026-08-24.
   - Backend:
     - Added strict `client.midi_event` WebSocket control messages for
       `note_on` / `note_off`.
     - Added `MidiPracticeEngine` for `WAIT_FOR_NOTE + MIDI` sessions.
     - MIDI sessions use score-timeline expected groups and
       `ExpectedEventEvaluator.from_midi(...)`; they do not pretend to be audio
       frames.
     - `WAIT_FOR_NOTE + MIDI` is accepted by session policy.
     - `CONTINUOUS + MIDI` is still rejected explicitly because MIDI continuous
       score following has not been implemented.
     - MIDI runtimes are armed immediately after `client.init`; microphone
       sessions still wait for audio calibration.
   - Frontend:
     - Added a Web MIDI input hook.
     - Added a step-by-step input selector for Microphone vs MIDI.
     - Full performance remains microphone-only.
     - MIDI note messages are sent as JSON control frames, not binary audio.
   - Current MIDI behavior:
     - single-note expected targets advance strictly on exact MIDI `MATCH`;
     - MIDI partial chords wait until the expected chord is complete;
     - if a chord attempt is incomplete, releasing and replaying the full chord
       still advances once all expected MIDI notes are active;
     - `note_off` updates release state and do not advance progression.
   - Additional implementation status on 2026-08-24:
     - Added browser E2E coverage for the Web MIDI path. The smoke test selects
       MIDI, verifies `client.init.input_source=MIDI`, sends a Web MIDI
       `note_on`, and verifies the page sends `client.midi_event` without
       sending binary microphone PCM frames.
     - Hardened frontend WebSocket close handling so stale closed sockets cannot
       reset the active practice session after switching input source.
     - Added accessible labels for the practice settings/maximize icon buttons.
     - Added report payload provenance fields:
       `progression_mode`, `realtime_guidance`, `evaluation_profile`,
       `input_source`, `evidence_profile`, and `correctness_scope`.
     - Reports now identify `MIDI_STRICT` separately from
       `MICROPHONE_BEST_EFFORT` / `MICROPHONE_ALIGNMENT`.
     - Completed first user-facing MIDI permission/error polish:
       - unsupported browsers show a MIDI-specific unsupported message;
       - permission denial shows a MIDI permission message;
       - successful permission with no connected MIDI input is treated as
         `no input`, not as permission denial;
       - settings panel can show no connected MIDI input;
       - active MIDI sessions return to a recoverable idle/disconnected state
         if all MIDI inputs disconnect.
     - Completed first attempt/summary persistence pass:
       - Added `practice_attempts` for event-level Wait For Note records.
       - Persisted semantic attempt data from `alignment.update` decisions,
         including expected group/event anchors, render note ids, action,
         reason, result, confidence, input source, evidence profile, and
         correctness scope.
       - Reports now aggregate attempt counts and include an `attempts` array
         instead of relying only on session-level last beat/confidence.
     - Reclassified the earlier DB-level deduplication as a provisional cleanup,
       not as final attempt semantics:
       - `same target + same wait result + same reason` is not a valid long-term
         definition of one user attempt because it can collapse two real
         release-and-replay attempts that happen to produce the same result.
       - The long-term invariant is `one acoustic/MIDI gesture -> one
         PracticeAttempt`, not `one emitted realtime decision -> one
         PracticeAttempt`.
       - Persistence should store resolved semantic attempts. Pending realtime
         feedback can still be sent to the UI, but it should not inflate report
         attempt counts.
       - Releasing/silence after an incomplete attempt must form a boundary; a
         later attempt with the same target/result/reason is still a new attempt.
       - A normal spread chord should be collected as one attempt and may resolve
         to `MATCH` if completed inside the allowed collection window.
       - Result vocabulary should stay close to evaluator evidence:
         `MATCH`, `PARTIAL`, `MISMATCH`, `UNCERTAIN`; avoid presenting
         microphone evidence as confident user-facing blame.
     - Completed first target rollup pass:
       - Decision records without an expected group anchor are not persisted as
         `PracticeAttempt` rows; attempts are target-specific semantic records,
         not generic listening frames.
       - Report metrics now include target-level rollups:
         `target_count`, `completed_targets`, `targets_with_partial`,
         `targets_with_mismatch`, and `target_completion_rate`.
     - Completed first lifecycle-aligned persistence correction:
       - `alignment.decision.attempt_state=pending` is treated as realtime UI
         feedback only and is not persisted as a report attempt.
       - `alignment.decision.attempt_state=resolved` is persisted as a
         `PracticeAttempt`.
       - MIDI partial/mismatch note-on updates are emitted as pending decisions;
         releasing all active notes resolves the incomplete gesture as one
         attempt.
       - MIDI `MATCH` resolves immediately and advances exactly once.
       - `hold + entry_mismatch` decisions are now persistable as `MISMATCH`
         attempts instead of being silently excluded from reports.
       - This is still not the final cross-input AttemptAssembler; it is the
         first correction that moves persistence away from database-level
         duplicate-decision guessing.
     - Added the first shared attempt lifecycle identity layer:
       - `PracticeAttemptLifecycle` assigns stable per-session attempt identity,
         sequence, started time, and resolved time.
       - Microphone `ExpectedGroupAttemptAccumulator` now composes this lifecycle
         identity and exposes the resolved attempt snapshot when it emits a
         collected observation.
       - MIDI Wait For Note now uses the same lifecycle identity for note-on /
         note-off gesture boundaries.
       - `alignment.decision` can carry optional attempt metadata:
         `attempt_id`, `attempt_sequence`, `attempt_started_at_ms`,
         `attempt_resolved_at_ms`, `evaluator_version`, and
         `policy_profile_version`.
       - `PracticeAttempt` persists that metadata for future report
         regeneration, learning analytics, and evaluator-version auditability.
     - Added the first shared attempt outcome assembly layer:
       - `PracticeAttemptAssembler` combines lifecycle identity with
         `PracticeEventEvaluation` into a `PracticeAttemptOutcome`.
       - MIDI Wait For Note now creates pending/resolved outcomes through the
         shared assembler instead of attaching lifecycle fields locally.
       - Microphone Wait For Note uses the same assembler after
         `ExpectedGroupAttemptAccumulator` emits collected acoustic evidence.
       - `attach_attempt_outcome(...)` is the single place that projects attempt
         outcome metadata onto realtime `AlignmentDecision` payloads.
       - This keeps resolved attempt identity/evaluator metadata out of raw
         database deduplication logic and gives both input paths the same
         semantic bridge from observation/evaluation to decision/persistence.
     - Moved attempt persistence to the resolved attempt boundary:
       - Engines cache resolved `ResolvedPracticeAttempt` objects separately
         from WebSocket JSON payloads.
       - `ResolvedPracticeAttempt` is now the domain name for a resolved
         practice attempt; the earlier report-oriented naming was removed so
         summary generation remains a downstream consumer, not the owner of the
         realtime attempt model.
       - `PracticeSessionRuntime.drain_resolved_practice_attempts()` is the
         internal boundary used by the router.
       - The WebSocket route now sends realtime `alignment.update` to the UI and
         separately persists any resolved `ResolvedPracticeAttempt`.
       - `PracticeService.persist_practice_attempt(...)` accepts the resolved
         attempt DTO directly and no longer reconstructs attempt rows from
         `AlignmentDecision` dictionaries.
       - Runtime attempt consumption drains all resolved attempts in one call
         and a second drain returns empty, so reconnects, batching, and future
         multi-attempt events do not depend on an implicit "at most one attempt
         per update" assumption.
       - Attempt identity is now a UUID generated by the attempt lifecycle.
         Per-session `attempt_sequence` and persisted `attempt_index` remain
         the ordering fields used for display and report ordering.
       - Persistence is idempotent on `(session_id, attempt_uid)`, with a
         database unique index plus repository lookup before insert. This makes
         retry/reconnect behavior safe without restoring old duplicate-decision
         heuristics.
     - Completed first outcome-before-UI-decision refactor:
       - `WaitForNoteFollowPolicy` now exposes separate `evaluate_evidence(...)`
         and `decide_evaluation(...)` steps; the old combined
         `decide_evidence(...)` entry point was removed.
       - MIDI and microphone Wait For Note engines now create
         `PracticeAttemptOutcome` from `PracticeEventEvaluation` before the
         evaluation is projected into a realtime UI decision.
       - Resolved attempt anchors now come from the expected group being
         evaluated, not from the UI decision's next display anchor. This avoids
         recording a completed attempt against the next highlighted target.
       - `partial -> release -> partial` now produces two resolved attempts even
         when target/result are identical.
       - `partial -> complete match` inside the same MIDI gesture produces one
         resolved `MATCH` attempt.
       - The MIDI regression suite now covers the initial invariants for
         replayed incomplete chords, in-gesture completion, and drain semantics.
       - Follow-policy tests were updated to verify evaluation and decision
         projection as separate responsibilities.
     - Completed first extra-note and lifecycle-finalization pass:
       - `ExpectedEventEvaluator` keeps conservative extra-note semantics:
         any observed pitch outside the expected group is a `MISMATCH`, even if
         some expected pitches were also played.
       - MIDI Wait For Note holds position on extra-note mismatch, records a
         resolved `MISMATCH` attempt after release, and allows the user to
         replay the correct target afterward.
       - Runtime/service lifecycle now finalizes pending attempts before
         `pause` and `finish`, using explicit reasons `practice_paused` and
         `practice_finished`.
       - WebSocket disconnect/failure finalizes pending attempts with
         `connection_closed` without changing the session state.
       - `reset_input_buffer()` clears transient input only; it is no longer the
         hidden owner of attempt finalization. `close()` closes resources and
         clears the audio buffer after explicit finalization has had a chance to
         run.
       - Microphone Wait For Note can finalize a pending acoustic collection
         before the normal collection window completes, producing conservative
         resolved evidence instead of silently dropping the attempt.
     - Completed first resolved-attempt pipeline simplification:
       - `ResolvedPracticeAttemptBuffer` now owns the "resolved outcome +
         expected group + update confidence -> persisted-domain DTO" projection.
       - MIDI and microphone engines no longer keep local
         `_append_resolved_attempt(...)` helpers or duplicate the rule that
         resolved attempts must be anchored to the expected group, not the UI's
         next display anchor.
       - Engine responsibilities are now narrower: collect input evidence,
         evaluate the expected group, ask follow policy for a realtime decision,
         and hand resolved outcomes to the buffer.
     - Completed first report-safety and idempotency hardening pass:
       - Report attempt payloads now expose `completion_status`,
         `scoring_included`, and `resolution_reason`.
       - Attempts resolved because of `practice_paused`, `practice_finished`,
         or `connection_closed` remain visible as historical facts but are
         excluded from learning accuracy. They must not be treated as user
         mistakes, but they also must not disappear from completion/coverage
         semantics.
       - Report metrics now include raw totals plus scorable totals:
         `attempt_count`, `scorable_attempt_count`, `interrupted_attempts`,
         `target_count`, and `scorable_target_count`.
     - Completed second report-semantics cleanup:
       - `PracticeAttempt` now persists `completion_status` explicitly as
         `COMPLETED` or `INTERRUPTED`.
       - `PracticeAttempt` now persists `resolution_reason` explicitly instead
         of leaving report/persistence semantics on an overloaded `reason`
         column.
       - `attempt_uid` is non-null and remains protected by
         `UNIQUE(session_id, attempt_uid)`. This is a data invariant for
         resolved attempt identity, not a multi-device lock.
       - Duplicate attempt persistence handling moved behind
         `PracticeRepository.create_attempt_if_absent(...)`; the service layer
         no longer owns unique-constraint rollback and retry details.
       - Report scoring inclusion is now computed by
         `practice_scoring_policy.py`, giving learning-report scoring a named
         policy boundary.
       - `target_completion_rate` now means completed targets divided by all
         reached targets. The former scorable denominator is preserved under
         `scorable_target_completion_rate`.
       - Report metrics now also expose `scoring_policy_version`,
         `scoring_coverage`, `scorable_completed_targets`, and
         `interrupted_target_count`.
   - Remaining R7 work:
     - add broader microphone extra-note/recovery fixtures once the AMT
       benchmark spike chooses a better microphone evidence provider;
     - add reconnect-specific E2E coverage to verify finalized attempts are not
       duplicated and active sessions remain recoverable;
     - build the frontend learning-report view for per-target attempts;
     - optional E2E coverage for MIDI device disconnection and reconnect flows.
10. R7.5: build the realtime/offline AMT benchmark spike for microphone
    correctness candidates, using the product metrics and capability fixtures
    described in Latest P1. Include the current FFT observer, `huispaty/rtt`,
    `jdasam/online_amt`, and an offline oracle such as Transkun V2 or
    `qiuqiangkong/piano_transcription_inference`.
11. R8: improve richer microphone correctness evidence based on benchmark data,
    preferably through expected-group-conditioned acoustic evidence rather than
    unbounded heuristics around dominant FFT.
12. R9: update the Practice UI around the two user-facing entries.
13. R10: consider fixed-clock, accompaniment, hand-specific practice, loops,
    recommendations, trends, and teacher/student views.

## Verification Checklist

Backend:

- `pytest backend/tests/test_practice_audio_replay_evaluation.py`
- Real-engine replay for `profile_manifest.json`
- Real-engine replay for `continuous_follow_quality_manifest.json`
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
- The same ordered evidence/alignment stream with the same session policy profile
  produces the same decision stream.
- Wait For Note progression is driven by `ExpectedEventEvaluator`, not by
  Matchmaker beat advancement alone.
- Full performance continues analyzing even when realtime feedback is set to
  `STATUS_ONLY`.
- Persistent report records are event-level semantic records, not permanent
  storage of every PCM frame or acoustic feature frame.

Manual:

- Start practice and play normally.
- Start practice, wait several seconds, then play correctly.
- Play wrong notes at the beginning, then restart correctly.
- Play correctly, make several wrong notes, then continue correctly.
- Pause/resume while listening and while following.

## Next Product IA Task Plan

This section records the next execution order after the product/architecture
rules were frozen. The project is still pre-launch, so avoid compatibility
layers, transitional aliases, unused fallback paths, and dead code. Prefer clean
renames and clear ownership boundaries over preserving confusing historical
terms.

### P0 - Rename the User-Facing Continuous Preset

Goal: stop conflating `CONTINUOUS` with "full piece".

Tasks:

1. Rename frontend preset terminology from `FULL_PERFORMANCE` to a
   continuous-performance/continuous-playing concept.
2. Update settings copy from "Full performance / 完整演奏" to
   "Continuous performance / 连贯演奏".
3. Keep the backend enum `PracticeProgressionMode.CONTINUOUS`; that name is
   already the correct domain term.
4. Use "Full performance / 完整演奏" only when scope is full piece.
5. Update unit and E2E tests to assert the new product copy.

Acceptance criteria:

- The practice settings UI exposes two practice styles: Step-by-step practice
  and Continuous performance.
- The code no longer treats "full performance" as the name of the generic
  `CONTINUOUS` preset.
- `CONTINUOUS + RANGE` can be represented without contradictory copy.

Implementation status:

- Completed the frontend preset rename from `FULL_PERFORMANCE` to
  `CONTINUOUS_PLAY`.
- Updated customer-web practice settings copy:
  - English: `Continuous performance`
  - Chinese: `连贯演奏`
- Removed the old `settingModeFullPerformance`, `viewPerformance`,
  `canViewPerformance`, and `onViewPerformance` names from customer-web code and
  message files.
- Kept the backend `PracticeProgressionMode.CONTINUOUS` enum unchanged because
  it already expresses the domain progression behavior cleanly.
- Verified with:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run check:i18n-errors`
  - `npm run test -- src/lib/practice/session-policy.test.ts`

### P0 - Make Scope a First-Class Practice Page Concept

Goal: make selected-section practice a real range selection concept instead of
only a report deep-link side effect.

Tasks:

1. Introduce a small frontend practice range model:
   - full piece
   - selected expected-group range
   - display measure labels
2. Replace ad hoc `scopedPractice` naming with `practiceScopeSelection` or
   equivalent product/domain wording.
3. Keep route params as domain locators:
   - `practiceRevisionId`
   - `practiceStartGroup`
   - `practiceEndGroup`
   - display-only measure context
4. Keep `measure_number` as display context only. Do not use it as a backend
   fallback for invalid expected-group ids.
5. Keep Summary-to-Practice navigation as positioning only. Summary must not
   create a session or infer a point-to-range remediation plan.
6. Leave manual score-range selection for a later UI pass unless needed for the
   current selected-section flow.

Acceptance criteria:

- The practice page can explain whether the current session is full-piece or
  selected-section practice.
- Range state is independent of progression mode.
- Selected-section practice remains bounded and deterministic.
- If Summary later links back into Practice, it may focus a score location or
  seed range-selection mode, but the user still chooses START and END.

Implementation status:

- Introduced a first-class frontend `PracticeScopeSelection` model with
  `FULL_PIECE` and `SELECTED_RANGE` variants on the practice page.
- Replaced page-level `scopedPractice` state with `practiceScopeSelection` and
  `selectedRangePractice`, so the UI now models range selection directly instead
  of treating it as a report-only side effect.
- Renamed focused/scoped user copy to selected-section copy:
  - English: `Section practice`
  - Chinese: `选段练习`
- Kept the API route parameters as domain locators:
  `practiceRevisionId`, `practiceStartGroup`, `practiceEndGroup`, and display
  measure context. Removed return-to-source-summary context from Practice.
- Kept backend `practice_scope` naming unchanged because it is the persisted API
  domain field; no measure-number fallback was introduced.
- Verified with:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run check:i18n-errors`
  - `npm run test -- src/hooks/practice/use-practice-session.test.tsx src/lib/practice/session-policy.test.ts 'src/app/[locale]/(workspace)/score/[id]/practice/summary/page.test.tsx'`
  - `npm run test:e2e -- tests/e2e/practice-step-by-step-smoke.spec.ts`

### P1 - Split Completion Outcomes from Full Reports

Goal: avoid generating the same full report artifact for every finished
session.

Tasks:

1. Add a backend-authored completion outcome model derived from:
   - `progression_mode`
   - `practice_scope`
   - `evaluation_profile`
   - `input_source`
2. Render selected-section completion as a lightweight sheet, not as a full
   report prompt.
3. For selected sections, offer local practice choices only:
   - retry this section
   - adjust the selected section
   - return to the score workspace
4. Hide the playback loading placeholder when there is no recording to play,
   especially for MIDI sessions.
5. Keep full summary generation as the primary CTA only for
   `CONTINUOUS + FULL_PIECE`.
6. Decide whether `WAIT_FOR_NOTE + FULL_PIECE` should route to an optional
   learning-details page or stay as a richer completion sheet for MVP.

Acceptance criteria:

- `WAIT_FOR_NOTE + RANGE` and `CONTINUOUS + RANGE` do not prompt users to
  generate a formal full report by default.
- `CONTINUOUS + FULL_PIECE` still clearly offers the Performance Report.
- Completion UI actions match the user's immediate next choices.

Implementation status:

- Completed the first completion-outcome cleanup.
- `PracticeCompletionDialog` now distinguishes full-piece completion from
  selected-section completion through `variant='full' | 'selected-section'`.
- The dialog no longer shows an indefinite playback-loading placeholder when no
  playback is expected, especially for MIDI selected-section sessions.
- Selected-section completion should offer only local choices for the current
  practice session. It must not preserve a hidden "return to source Summary"
  workflow.
- Added `practicePreset=CONTINUOUS_PLAY` as the clean full-piece
  continuous entry parameter. The selected-section page navigates back to a
  full-piece practice URL before synchronizing that preset, avoiding accidental
  `CONTINUOUS + RANGE` session creation while the backend still only supports
  ranged sessions for `WAIT_FOR_NOTE`.
- Remaining P1 work:
  - restrict the full report CTA to `CONTINUOUS + FULL_PIECE` once the backend
    outcome/summary split is ready;
  - decide whether `WAIT_FOR_NOTE + FULL_PIECE` should open an optional learning
    details page or remain as a richer completion sheet for MVP.
- Verified with:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run check:i18n-errors`
  - `npm run test -- src/hooks/practice/use-practice-session.test.tsx src/lib/practice/session-policy.test.ts 'src/app/[locale]/(workspace)/score/[id]/practice/summary/page.test.tsx'`
  - `npm run test:e2e -- tests/e2e/practice-step-by-step-smoke.spec.ts`

Additional implementation status:

- Added a formal backend `PracticeSessionCompletionOutcomeRead` model on
  finished `PracticeSessionDetailRead`.
- REST finish and realtime `session.finished` now expose the same backend
  completion outcome. The frontend no longer re-derives selected-section,
  learning, or performance semantics from raw session fields.
- Customer-web keeps only a thin `PracticeCompletionOutcome` UI view model,
  mapping backend outcome classification to Web presentation.
- `PracticeCompletionDialog` now consumes the outcome object instead of
  receiving separate ad hoc props such as variant, playback expectation, and
  report availability.
- Full-piece Wait For Note completion is now explicitly modeled as
  `full-piece-learning`: it offers retry and a full-piece continuous performance
  CTA, but does not present the formal full report CTA.
- Full-piece Continuous completion is explicitly modeled as
  `full-piece-performance`: it keeps the formal report CTA.
- Added outcome unit coverage for selected-section, full-piece performance, and
  full-piece learning sessions, plus backend read-model and WebSocket protocol
  coverage.
- Verified with:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run check:i18n-errors`
  - `npm run test -- src/lib/practice/completion-outcome.test.ts src/hooks/practice/use-practice-session.test.tsx src/lib/practice/session-policy.test.ts 'src/app/[locale]/(workspace)/score/[id]/practice/summary/page.test.tsx'`
  - `npm run test:e2e -- tests/e2e/practice-step-by-step-smoke.spec.ts`

### P1 - Align Report Page Semantics

Goal: make the existing report route explicitly represent the artifact it is
showing.

Tasks:

1. Treat the current report page as a Learning Report only when its payload is
   built from wait-for-note attempts.
2. Avoid generic "Practice summary" copy that hides whether the artifact is a
   learning summary or a performance report.
3. Keep report annotations semantics clear:
   - review/problem targets for learning summaries
   - performance/timing problems for future performance reports
4. Keep report actions user-directed. Summary actions may focus problem
   positions inside the annotated score, but must not infer a `PracticeScope`
   or default a selected-section practice session from a single problem target.

Acceptance criteria:

- Users can tell whether they are reading a learning summary or a performance
  report.
- The report page does not become a practice control center or remediation
  queue.

Implementation status:

- Added a formal customer-web `PracticeSummaryArtifact` view model.
- `practiceReportArtifactForSession(...)` now classifies report-like artifacts
  as:
  - `learning-summary` for full-piece `WAIT_FOR_NOTE` sessions;
  - `performance-report` for full-piece `CONTINUOUS` sessions;
  - `section-summary` for any selected-range session.
- The report page now derives title, subtitle, primary metric labels, problem
  measure section labels, and empty recommendation copy from the report artifact
  instead of using one generic "Practice summary" semantic for all sessions.
- Current `WAIT_FOR_NOTE` report UI now presents as `Learning Summary` /
  `学习总结`.
- Future full-piece `CONTINUOUS` artifacts have explicit `Performance Report` /
  `演奏报告` copy keys without introducing a separate route or overbuilding the
  backend API.
- Selected-range artifacts have explicit `Section Summary` / `选段总结` copy keys
  for future section-summary routing, while current selected-section completion
  still uses the lightweight dialog path by default.
- `PracticeSummaryArtifact` now keeps the selected artifact shape separate from
  `evaluationProfile` and `scopeKind`. This preserves the distinction between a
  learning section summary and a performance section summary without introducing
  extra artifact enum variants such as `section-learning-summary` and
  `section-performance-summary`.
- Added unit coverage for learning-summary, performance-report, and
  section-summary classification, including selected-range learning versus
  selected-range performance semantics.
- Updated browser E2E coverage so the report-driven practice flow expects the
  learning-summary title before launching selected-section practice.
- Verified with:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run check:i18n-errors`
  - `npm run test -- src/lib/practice/summary-artifact.test.ts src/lib/practice/completion-outcome.test.ts 'src/app/[locale]/(workspace)/score/[id]/practice/summary/page.test.tsx'`
  - `npm run test:e2e -- tests/e2e/practice-step-by-step-smoke.spec.ts`

### P1 - Define Backend Summary vs Formal Report Boundary

Goal: make backend artifacts match the product semantics without losing useful
selected-section data.

Decision:

```text
All finished sessions -> SessionSummary
Eligible full-piece performance sessions -> FormalReport
```

`SessionSummary` is a lightweight aggregation that can be built for every
session type:

- `WAIT_FOR_NOTE + FULL_PIECE`
- `WAIT_FOR_NOTE + RANGE`
- `CONTINUOUS + FULL_PIECE`
- `CONTINUOUS + RANGE`

It should contain cheap completion and evidence rollups such as:

- completion state;
- attempt totals;
- target totals;
- first-pass or retry-oriented learning metrics when available;
- coverage and confidence;
- selected-section range context.

`FormalReport` is a heavier, standalone, historically meaningful artifact. For
the MVP, reserve it for:

```text
CONTINUOUS + FULL_PIECE + PERFORMANCE
```

Do not implement the next backend step as a blanket `RANGE -> report forbidden`
rule. Selected-section sessions still need summaries; they should simply avoid
the full formal report pipeline by default.

Tasks:

1. Audit the existing `request_practice_session_summary` path and document whether it is
   currently acting as a lightweight summary builder, a formal report builder,
   or both.
2. Decide the minimal API contract:
   - `GET /practice/sessions/{id}/summary` for all sessions, or
   - keep the existing route temporarily but rename internal builder/domain
     types before exposing a new endpoint.
3. Make the formal report eligibility explicit in backend code:
   - `progression_mode=CONTINUOUS`
   - no `practice_scope`
   - `evaluation_profile=PERFORMANCE`
4. Keep event-level attempts/evaluations as reusable evidence records.
5. Do not add ReviewQueue, remediation state, or automatic next-target tables.

Acceptance criteria:

- Backend code has a named distinction between session summaries and formal
  reports.
- Selected-section sessions can still produce a lightweight summary.
- Formal summary generation is not accidentally available for every finished
  session just because evidence exists.

Implementation status:

- Completed the first backend boundary cleanup:
  - renamed the current backend artifact from practice report to practice
    session summary across service, repository, read model, schemas, builder,
    success/error codes, persisted session fields, and the practice OpenAPI
    contract;
  - replaced `/practice/sessions/{id}/report` with
    `/practice/sessions/{id}/summary` instead of keeping a compatibility
    endpoint;
  - renamed the current frontend route from `/practice/report` to
    `/practice/summary`;
  - renamed frontend summary view helpers from report-oriented names to
    summary-oriented names, including summary artifacts and static score
    annotations.
- FormalReport remains a future standalone artifact. The current summary
  endpoint still supports all finished session types, including selected
  sections.
- Verified with:
  - `docker compose -f docker-compose.backend-dev.yml run --rm --no-deps quality bash -lc "python -m pytest tests/test_practice_api_smoke.py tests/test_practice_read_model.py tests/test_practice_service_access.py tests/test_service_regressions.py -q"`
  - `docker compose -f docker-compose.backend-dev.yml run --rm --no-deps quality bash -lc "python -m ruff check app tests scripts && python -m mypy --config-file pyproject.toml"`
  - `docker compose -f docker-compose.backend-dev.yml run --rm --no-deps quality bash -lc "python -m mypy --config-file mypy-model-layer.ini"`
  - `docker compose -f docker-compose.backend-dev.yml run --rm --no-deps practice-quality bash -lc "python scripts/export_openapi.py practice-api --check"`
  - `npm run generate:practice-api-types`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test -- src/lib/practice/summary-artifact.test.ts src/lib/practice/summary-annotation-controller.test.ts src/lib/practice/completion-outcome.test.ts src/lib/practice/session-policy.test.ts 'src/app/[locale]/(workspace)/score/[id]/practice/summary/page.test.tsx'`
  - `npm run test:e2e -- tests/e2e/practice-step-by-step-smoke.spec.ts`

API naming invariant:

- Creation-time connection data is `PracticeSessionStartRead`, not a session
  summary. `SessionSummary` names are reserved for post-session result
  aggregation.
- Keep this distinction frozen:

```text
PracticeSessionStartRead
  -> transient create-session response: session id, state, websocket URL

PracticeSessionResultSummaryRead / PracticeSessionSummaryPayloadRead
  -> persisted post-session result summary built from attempts/session evidence

FormalReport
  -> future standalone historical artifact, initially eligible only for
     CONTINUOUS + FULL_PIECE + PERFORMANCE
```

- Continuous selected-section support is valid only while these invariants stay
  covered by tests:
  - follower/reference search is confined to the selected range, or hypotheses
    outside the range are never accepted;
  - range start is an alignment/reference boundary for continuous following,
    not a required expected-note target;
  - range completion is based on stable, policy-approved position evidence
    reaching the resolved terminal reference region, not a raw one-frame
    beat-position comparison.

Current domain invariants:

- `PracticeScope.start_expected_group_id` and
  `PracticeScope.end_expected_group_id` identify an inclusive playable expected
  group range. The end group is part of the selected musical target set.
- Expected group identity is deterministic within the same score revision and
  timeline parsing semantics. It is not a cross-revision or cross-algorithm
  permanent identifier.
- `PracticeScope` answers what playable targets are selected. It does not mean
  continuous end beat, note duration end, measure boundary, or reference
  terminal boundary.
- `WAIT_FOR_NOTE` completes when the final selected expected group is matched.
  It must not wait for nominal duration, note release, audio decay, or pedal
  release.
- `CONTINUOUS` completes when an accepted follower state reaches the selected
  range's resolved terminal reference region. Raw follower estimates,
  low-confidence hypotheses, out-of-range hypotheses, and unaccepted
  relocalizations must not complete the scope.
- The current MVP range boundary snaps only to `ExpectedPracticeGroup`. The
  selected range is therefore a playable-target range, not an arbitrary
  rhythmic-time range. Future support for rests, barlines, or onset-free
  rhythmic locations should add a stable `RhythmicTimelineAnchor` boundary
  model rather than persisting naked beat values or interaction-source types.
- Practice selected-range UI must not derive backend group ids from Verovio
  render ids or frontend timemap beats. The frontend should consume a backend
  practice target catalog built from the same `PracticeScoreTimeline` semantics
  used by the realtime engines.
- Catalog ordering is part of the API contract. Frontend range validation should
  compare catalog `index` values, not floating-point `onset_beat` values.
- Practice render-note identity must be generated from one shared rule. Original
  MusicXML files may not contain note ids; before building the target catalog,
  MIDI timeline, or Matchmaker timeline, the backend prepares a temporary
  practice render copy with deterministic `nv-*` note/forward ids. The
  canonical stored MusicXML is not mutated.
- Long-term practice rendering should not rely on duplicated frontend/backend
  stable-id generators. The Practice page must consume backend-generated
  practice-ready MusicXML, and the target catalog plus realtime engines must be
  built from the same prepared representation. Editor and ordinary preview
  surfaces may keep frontend temporary id generation because they edit or render
  canonical revision content outside the practice runtime contract. The frontend
  helper is a generic/editor render utility only; it is not the Practice render
  identity authority.
- Practice frontend rendering must not invent or repair ids for backend-prepared
  Practice XML. If a Practice XML response lacks usable Verovio `data-id`
  values, that is a backend projection contract failure, not a frontend fallback
  case.
- The practice-ready MusicXML id format should be based on stable structural
  position within the revision render copy rather than display measure text.
  The current canonical shape is `nv-p{partOrdinal}-m{measureOrdinal}-{tag}{eventOrdinal}`;
  display measure numbers remain user-facing context, not technical identity.
- `render_note_ids` are a render/hit-test bridge only. They must never become
  persisted selected-scope identity; persisted practice scope remains
  `start_expected_group_id` and `end_expected_group_id`.
- `PracticeTimelineEvent.event_id` is semantic timeline identity, not render
  identity. It is derived from musical position evidence such as onset,
  duration, staff, voice, and a backend structural MusicXML locator. It must not
  include `render_note_ids`.
- `ExpectedPracticeGroup.group_id` is semantic playable-target identity derived
  from semantic event ids. Changing the practice render-note projection must not
  change event ids, group ids, persisted selected scope, or attempt group
  identity.
- During development, old practice history created before this timeline/render
  identity split may be deleted rather than supported through compatibility
  lookup or conversion logic. Once historical practice data matters,
  projection/timeline identity changes must be versioned or backed by immutable
  prepared artifacts.
- Rendered score click handling must use Verovio `data-id` for practice
  hit-testing. Child SVG shapes may have their own graphical `id` attributes;
  those ids are not semantically equivalent to `data-id` and must not be used as
  a fallback.

### P2 - Add Continuous Selected-Section Support

Goal: allow `CONTINUOUS + RANGE` after the scope and completion semantics are
clean.

Tasks:

1. Remove the backend restriction that scoped sessions are only accepted for
   `WAIT_FOR_NOTE` once the continuous runtime can honor bounded ranges.
2. Teach continuous follow policy/runtime to stop at the scoped end target or
   equivalent musical range boundary.
3. Add replay and websocket tests for continuous selected-section sessions.
4. Keep selected-section entry in the Practice page. A Summary problem target
   may be used by a future "select from here" flow only after the user chooses
   or confirms START and END.
5. Keep user override available for practice style and selected range.

Acceptance criteria:

- `CONTINUOUS + RANGE` can be created, followed, finished, and summarized.
- It does not generate a full-piece performance report.

P2 implementation status:

- Added a backend practice target catalog endpoint:
  `GET /practice/scores/{score_id}/revisions/{revision_id}/targets`. It returns
  legal `ExpectedPracticeGroup` selection anchors, including catalog index,
  group id, onset beat, render note ids, pitch labels, and measure/staff/voice
  context. This is the source of truth the future Practice selected-range UI
  should use for START/END handles.
- The practice OpenAPI contract and customer-web generated practice API types
  now include the target catalog, and `practiceApi.getPracticeTargets(...)`
  exposes it through the frontend API facade.
- Added a backend practice-ready MusicXML endpoint:
  `GET /practice/scores/{score_id}/revisions/{revision_id}/content`. Practice
  and Practice Summary render from this prepared XML, so the Verovio `data-id`
  values and backend catalog `render_note_ids` come from the same practice
  projection. Editor and ordinary preview surfaces continue to render canonical
  revision content with frontend temporary ids where needed.
- Renamed the frontend temporary-id helper to `generic-render-ids` and changed
  `PracticeVerovioAdapter` to disable generic frontend id generation. This keeps
  Practice render identity owned by backend preparation while preserving local
  editor/ordinary-preview rendering support.
- `PracticeScoreTimeline` event and group ids no longer depend on
  `render_note_ids`. Render ids remain only highlight/hit-test anchors, while
  event/group ids remain stable when the prepared render-note projection changes.
- Added backend invariant coverage proving that changing render note ids does
  not change `PracticeTimelineEvent.event_id` or `ExpectedPracticeGroup.group_id`.
- Added development migration `0046_clear_practice_history` to clear old
  PracticeSession/PracticeAttempt data created before the timeline/render
  identity split. This is a development-only cleanup because the project has no
  production practice history yet.
- Added a thin customer-web `usePracticeTargets(scoreId, revisionId)` hook. It
  only handles target catalog fetching/cache identity and intentionally does not
  own range selection policy or hit testing.
- Added a pure customer-web range-selection helper in
  `src/lib/practice/range-selection.ts`. It models only transient UI intent:
  full piece, pending selected-range start, or completed selected-range
  START/END. It creates a `PracticeSessionScope` only after both boundaries are
  known, normalizes reverse selections by catalog `index`, supports single-target
  ranges, and maps rendered chord note ids back to backend catalog targets
  without making Verovio ids the domain identity.
- The selected-range helper is intentionally not a persisted model and does not
  introduce `MEASURE_RANGE`, `GROUP_RANGE`, `selectionKind`, or any
  interaction-source type. If a future UI shortcut selects a measure, it should
  only move START/END handles to legal catalog targets and still produce the
  same ordinary selected range.
- The Practice score UI now has a minimal selected-section interaction:
  - the controls expose a real "Select section" action instead of a disabled
    loop placeholder;
  - while idle, clicking rendered notes maps Verovio render ids back to backend
    practice catalog targets;
  - the first click sets START, the second click sets END, and the helper derives
    the inclusive `PracticeSessionScope`;
  - pending selection blocks session preparation, while completed selection uses
    the selected scope for the next created practice session;
  - selected START/END anchors are highlighted separately from the orange
    realtime-following highlight.
- Browser smoke coverage now verifies that a user can enter selected-section
  mode, click rendered score notes for START and END, and create a practice
  session whose `practice_scope` comes from backend catalog targets. This also
  caught and fixed a real SVG hit-testing issue by making selectable rendered
  notes use `pointer-events: bounding-box`.
- Selected-section visual feedback now distinguishes:
  - the selected playable-target range;
  - the START anchor;
  - the END anchor;
  - the current realtime-following highlight.
  Range styling is driven from backend catalog render-note ids through React
  state and dynamic CSS selectors, rather than requiring the page to mutate
  Verovio DOM identity into domain state. The viewer also exposes
  `data-practice-range-*` attributes for stable browser-level regression tests.
- The earlier range-decoration DOM fallback/class-label experiment has been
  removed. Selected-section highlighting now has a single frontend rendering
  path: backend catalog render-note ids -> React state -> Verovio `data-id`
  selectors. Keep this single path unless a real renderer compatibility issue
  is proven by tests.
- The Practice score UI still needs a later polish pass for keyboard
  accessibility, touch ergonomics, and richer handle affordances. The core scope
  semantics should remain in the helper and backend catalog, not in the page
  component.
- Backend service validation now accepts scoped `CONTINUOUS` sessions only for
  `MICROPHONE`; `CONTINUOUS + MIDI` remains explicitly rejected until a real
  MIDI continuous-following engine exists.
- Continuous follow policy now resolves selected-section start/end entries as
  inclusive selected playable groups, rejects policy decisions outside the
  selected range, and marks completion only when policy-approved evidence
  reaches the resolved terminal reference region for the selected range.
- `MatchmakerLiveEngine` now trims generated reference features to the selected
  beat range and fails fast when the selected section produces no reference
  frames, instead of silently falling back to full-piece reference features.
- Targeted backend coverage now includes service creation, policy invariants,
  reference trimming, and scoped-completion behavior.
- Frontend selected-section practice now respects an explicit
  `practicePreset=CONTINUOUS_PLAY` URL parameter while forcing microphone input,
  so the UI can create `CONTINUOUS + RANGE` sessions without implying MIDI
  continuous-following support.
- Browser smoke coverage now verifies:
  - Summary problem positions can be focused without creating a selected-section
    practice session;
  - explicit continuous selected-section practice with microphone input,
    `CONTINUOUS + STATUS_ONLY + PERFORMANCE`, and a bounded scope.
- The real-engine replay runner now accepts manifest-level selected-section
  scope declarations, resolves them to current expected-group ids, passes them to
  `MatchmakerLiveEngine`, and can assert accepted-anchor bounds plus
  selected-section completion.
- Selected-section replay baselines now prefer `practice_scope_by_beat`
  (`start_beat` / `end_beat`) and resolve those beats through the current backend
  target catalog at runtime. Tests therefore encode the fixture's musical range
  intent instead of hardcoding a previous `ExpectedPracticeGroup.group_id` hash.
- `continuous_follow_quality_manifest.json` now includes
  four selected-section `CONTINUOUS + RANGE` replay baselines:
  - `once_again_continuous_selected_section_completes_at_range_end` verifies
    that the Once Again excerpt starts inside the selected range, does not accept
    anchors outside beat 3.0-12.0, and completes when accepted alignment reaches
    the resolved terminal reference region;
  - `once_again_continuous_selected_section_early_stop_does_not_complete`
    verifies that stopping around beat 10 does not complete a range ending at
    beat 12;
  - `once_again_continuous_selected_section_outside_audio_does_not_start`
    currently verifies that later, selected-range-external audio does not pass
    selected-range startup admission or accept outside anchors. The stronger
    domain invariant is that outside-range material must not accept anchors
    outside the selected range or complete merely because it matches full-score
    material; false in-range startup belongs to the follower-quality baseline.
  - `once_again_continuous_later_section_completes_at_range_end` verifies a
    second positive selected-section completion from a later part of the same
    real recording. A trial `12.0 -> 24.0` range reached only beat 23.75 and did
    not complete, which is the correct result for insufficient source material;
    the accepted positive range is therefore `12.0 -> 23.75`, the final reliable
    playable target covered by this excerpt.
- Scoped continuous completion no longer treats a fixed beat tolerance as a
  business rule. The continuous runtime derives a terminal reference region from
  a `ReferenceTimelineSlice` produced by reference-feature slicing, then passes
  it to `FollowPolicy` as a `ResolvedContinuousScope`, not as an unnamed
  tolerance number.
  `FollowPolicy` can complete only after normal confidence/input/continuity
  gates accept an update in that terminal region. Any endpoint quantization
  remains an adapter detail for `CONTINUOUS + RANGE`, not a general allowance to
  stop early.
- The Once Again selected-section replay now records the resolved reference
  endpoint metadata in the replay report. For the current reference profile, the
  `3.0 -> 12.0` selected range resolves diagnostic metadata
  `ReferenceTimelineSlice(start=3.0, end=12.0, terminalRegionStart=11.93,
  frameStep=0.07)`. The stable semantic invariant is not those exact endpoint
  numbers; it is that `accepted_completion_beat` is present only after the
  policy accepts the completion decision and that it falls within the resolved
  terminal region and reference end.
- The Once Again fixture now also has an independent performance-time
  annotation file, `once_again_performance_annotation.json`, recording
  human-reviewed `performance_seconds -> score_beat` anchors for selected range
  boundaries. Continuous selected-section tests compare accepted completion
  against this annotated terminal time, so endpoint validation is no longer only
  self-referential to the generated reference frame grid. These annotations are
  fixture-specific evidence, not a general tempo rule or a replacement for the
  runtime terminal-region policy. The later-section test starts from a sliced
  part of the source recording, so the assertion converts scenario-relative
  completion time back to the original source time before comparing it with the
  annotation.
- Realtime protocol completion naming has been cleaned up: alignment updates now
  use `scope_completed` plus `completion_reason`. `scope_completed` means the
  current practice scope is complete; `completion_reason` distinguishes
  `SCOPE_END_REACHED`, `FULL_SCORE_END_REACHED`, and
  `FINAL_EXPECTED_GROUP_MATCHED`.
- Do not add report-page defaulting rules that choose step-by-step versus
  continuous selected-section practice from a Summary problem target. A target is
  a point, while `PracticeScope` is a range; the user must choose or confirm the
  selected range in Practice before a session is created.
- Selected-section completion UI does not auto-advance to another segment and
  does not present the full-piece performance CTA. It offers local choices:
  retry the same section or adjust the selected range. Full-piece performance
  remains a separate user choice, not a selected-section completion default.
- Frontend completion handling now treats `alignment.update.scope_completed` as
  a terminal event for the active practice scope. The page captures the running
  session scope before streaming starts, so the completion dialog is based on
  the completed session's scope rather than transient UI selection state.
- Practice session preconnect now ignores stale create-session responses after a
  range/input/mode reset. This prevents an older full-piece preconnect from
  overwriting the currently selected scoped session.
- Database migration history now has an explicit forward migration for the
  report-to-summary rename. Existing databases upgrade through
  `0045_practice_summary_columns`, which renames `report_status/report_payload`
  to `summary_status/summary_payload` and converts the enum type to
  `practicesessionsummarystatus`. The application does not keep compatibility
  columns or dual read paths.

### P2 - Report/Outcome API Cleanup

Goal: make backend APIs reflect artifact semantics without overbuilding.

Tasks:

1. Consider adding a lightweight session outcome read model separate from
   formal summary generation.
2. Keep persisted attempts and decisions as reusable evidence records.
3. Reserve full summary generation for artifacts that need asynchronous
   aggregation and standalone historical review.
4. Avoid new ReviewQueue tables, recommendation status machines, or remediation
   workflow state until there is a validated product need.

Acceptance criteria:

- The API separates "what happened at completion" from "generate a full
  historical report".
- The data model remains suitable for future learning analytics and performance
  diagnostics.

Implementation status:

- Added `PracticeSessionCompletionOutcomeRead` as the lightweight session
  completion outcome. It is derived in the backend read model and is present as a
  required nullable field on `PracticeSessionDetailRead`: unfinished sessions
  return `null`, finished sessions return the outcome.
- `finish_session` still returns `PracticeSessionDetailRead`, but finished
  details now include the lightweight outcome needed by the completion dialog:
  outcome kind, scope kind, summary artifact kind, playback expectation, and
  summary availability. Backend completion outcome must not carry Web-specific
  CTA/action policy.
- Realtime `session.finished` now carries the same completion outcome. The
  browser waits for this message instead of closing the WebSocket immediately
  after `scope_completed`, so automatic and manual finishes use one backend
  domain result.
- Customer-web `resolvePracticeCompletionOutcome(...)` now maps backend outcome
  into dialog behavior. It no longer infers outcome kind from `progression_mode`
  and `practice_scope`, and it does not carry return-to-source-summary context.
- `alignment.update.scope_completed` is not a completion-dialog authority. The
  browser enters a finishing state and waits for `session.finished`. If the final
  WebSocket message is missed, the browser recovers by reading
  `GET /practice/sessions/{session_id}` and using backend
  `completion_outcome`; it must not reconstruct outcome locally.
- Summary lifecycle belongs to the backend. The frontend should read
  `GET /sessions/{session_id}/summary`; it should not POST to request summary
  generation or use a request-null-then-get fallback. Summary generation failure
  must not prevent the session from becoming `FINISHED`.

## Summary

The current practice following feature now has a strong realtime foundation:
initial alignment replay coverage, `PracticeScoreTimeline`, backend-owned
decisions, user-understandable states, render-anchor projection, and a
microphone/MIDI input contract.

The next work should keep the product centered on two user-facing entries:

1. Step-by-step practice, backed by `progressionMode=WAIT_FOR_NOTE`.
2. Continuous performance, backed by `progressionMode=CONTINUOUS`.

Realtime guidance and post-session evaluation are orthogonal capabilities. The
largest next architectural step is the expected practice target plus
`ExpectedEventEvaluator` contract; it lets Wait For Note and reports answer
"was the expected group played?" without asking Matchmaker to be a correctness
judge. Before shipping Wait For Note, add minimum conservative microphone
correctness evidence. After that, add the minimal persistent evaluation model and
build Learning and Performance reports on top of event-level semantic records.
