# STEP Score Semantics Audit

Date: 2026-09-14

Scope:

- Read-only audit of the current score-to-STEP pipeline.
- No production parser refactor.
- No ByteDance runtime integration.
- No model search, threshold tuning, cadence tuning, frozen evaluation, O&V, RTT, or velocity/onset-shape rules.

Current research conclusion carried forward:

```text
ByteDance score-aware rolling STEP
= KEEP_CANDIDATE_FORMULATION
```

This document defines the score semantics boundary that must exist before that candidate can be productized.

## Current Score Path

Actual product flow:

```text
uploaded/imported score
-> review/editor-confirmed MusicXML revision source
-> canonical ScoreRevisionSource(format=MUSICXML)
-> practice-ready MusicXML with stable note ids
-> PracticeScoreTimeline
-> ExpectedPracticeGroup
-> WaitForNoteFollowPolicy.current_expected_group
-> ExpectedEventEvaluator
```

Relevant code:

- Import/review confirmation stores the accepted MusicXML as `ScoreRevisionSource(format=MUSICXML)` in `backend/app/modules/review/service.py`.
- Score revision creation/editing also stores a canonical MusicXML source in `backend/app/modules/revisions/service.py`.
- `ScoreAssetRepository.canonical_source()` selects the MusicXML source in `backend/app/modules/score_assets/repository.py`.
- Practice service materializes that canonical source and exposes:
  - `/practice/scores/{score_id}/revisions/{revision_id}/content`
  - `/practice/scores/{score_id}/revisions/{revision_id}/targets`
  in `backend/app/modules/practice/service.py` and `backend/app/modules/practice/router.py`.
- `prepare_musicxml_ids_for_practice()` ensures stable selectable MusicXML ids for note/forward elements in `backend/app/processing/engines/practice_alignment/musicxml_stable_ids.py`.
- `practice_score_timeline_from_musicxml()` loads MusicXML through Partitura and builds `PracticeScoreTimeline` in `backend/app/processing/practice_score/score_loader.py`.
- STEP runtime uses the same `PracticeScoreTimeline` in `MatchmakerLiveEngine` and `MidiPracticeEngine`.

Frontend consumption:

- `usePracticeReadyScoreContent()` fetches prepared MusicXML for Verovio rendering.
- `usePracticeTargets()` fetches target groups.
- `PracticeScoreViewer` renders MusicXML and highlights `render_note_ids`.
- `range-selection.ts` uses `PracticeTargetRead` only for section selection and `start_expected_group_id` / `end_expected_group_id`.

## Current Data Retention

Current internal `PracticeScoreTimeline` keeps these fields:

```text
PracticeScoreEvent:
  event_id
  onset_beat
  duration_beats
  pitches
  render_note_ids
  measure_numbers
  staff_ids
  voice_ids
  tie_types
  playable
  entry_candidate

ExpectedPracticeGroup:
  group_id
  onset_beat
  event_ids
  expected_notes
  strike_targets
  render_note_ids
  pitches
  measure_numbers
  staff_ids
  voice_ids
```

The MusicXML metadata reader also extracts:

```text
staff
voice
measure number
stable semantic locator
tie type: start / stop
```

Current public practice target API exposes:

```text
index
group_id
onset_beat
event_ids
render_note_ids
pitches
measure_numbers
staff_ids
voice_ids
```

It does not expose:

```text
duration
tie start/stop/continue
attack_required
continuation
per-note staff/voice/tie mapping
```

So the backend currently has enough information to avoid many incorrect STEP prompts, but the public/current STEP contract is still pitch-group oriented rather than action-semantics oriented.

## Current Tie Behavior

Current implementation already treats MusicXML tie continuations as non-entry events:

```text
_is_tie_continuation(metadata)
= "stop" in tie_types
```

This means:

- A note with `<tie type="stop"/>` is not itself an entry candidate.
- A pure tie continuation position does not become an `ExpectedPracticeGroup`.
- A mixed tied chord keeps the new notes and filters the tied continuation from the expected group.

Existing tests cover the important current behavior:

- `test_practice_score_timeline_does_not_prompt_tie_continuations`
- `test_practice_score_timeline_follows_multi_fragment_tie_chain_end`
- `test_practice_score_timeline_keeps_new_onsets_in_mixed_tied_chord`

This is directionally correct, but the meaning is implicit:

```text
entry_candidate=false
```

is doing the work that a future score-aware runtime should see explicitly as:

```text
continuation
```

## Semantics Boundary

Freeze these rules:

```text
tie
= no new physical key attack
```

```text
same pitch without tie
= new physical key attack
```

```text
slur
!= tie
```

```text
pedal sustain
!= score continuation
```

`CONTINUATION` must come from score structure, especially MusicXML tie information, not from microphone audio, pedal tail, or acoustic sustain.

## Proposed Minimal IR

Recommended long-term STEP score contract:

```text
PracticeAttackStep {
  step_id: string
  score_position: {
    onset_beat: number
    measure_numbers: string[]
    event_ids: string[]
    render_note_ids: string[]
  }
  attack_targets: PracticeAttackTarget[]
  continuation: PracticeStepNote[]
}

PracticeAttackTarget {
  attack_id: string
  pitch: string
  notes: PracticeStepNote[]
  event_ids: string[]
  render_note_ids: string[]
  measure_numbers: string[]
}

PracticeStepNote {
  step_note_id: string
  pitch: string
  render_note_id: string
  event_id: string
  staff_id?: string
  voice_id?: string
  measure_numbers: string[]
}
```

Rules:

```text
ATTACK_REQUIRED
= music-semantic set of notes at this score position that require a new physical key attack

Code contract:

```text
attack_targets
= pitch-consolidated physical targets for ATTACK_REQUIRED notes
```
```

```text
continuation
= notes sounding through this score position by score tie from an earlier position
```

Zero-attack positions:

```text
attack_required = []
continuation != []
```

These should be skipped or merged while building practice steps. Runtime must not wait for microphone input at a pure continuation position.

Mixed positions:

```text
attack_required != []
continuation != []
```

Create one practice step for the ATTACK_REQUIRED notes represented as `attack_targets`. Keep `continuation` as context metadata for display/reporting, but do not require new onset for continuation notes.

## Required Examples

### C4 -> D4

No tie. Two separate attacks:

```text
step 1:
  attack_required = [C4]
  continuation = []

step 2:
  attack_required = [D4]
  continuation = []
```

### C4 -> C4, no tie

Same pitch but new notation event without tie means re-articulation:

```text
step 1:
  attack_required = [C4]
  continuation = []

step 2:
  attack_required = [C4]
  continuation = []
```

### C4 --tie-- C4

Second note is continuation, not a new attack:

```text
step 1:
  attack_required = [C4]
  continuation = []

step 2:
  not created as a user-action STEP
```

If represented for analysis:

```text
position 2:
  attack_required = []
  continuation = [C4]
```

### C4 E4 G4 -> C4 F4 A4, shared C4 re-articulated

No tie on the second C4:

```text
step 1:
  attack_required = [C4, E4, G4]
  continuation = []

step 2:
  attack_required = [C4, F4, A4]
  continuation = []
```

### C4 E4 G4 -> tied C4 + new F4 A4

The shared C4 is not a new attack:

```text
step 1:
  attack_required = [C4, E4, G4]
  continuation = []

step 2:
  attack_required = [F4, A4]
  continuation = [C4]
```

This matches current internal behavior for mixed tied chords: the tied stop note is filtered from the expected group, while new chord tones remain expected.

### Multiple Voices At Same Score Position

If multiple voices/staves have new note-on events at the same onset:

```text
step:
  attack_required = all new attack notes at that onset
  continuation = tied-through notes at that onset
```

Current `ExpectedPracticeGroup` groups entry events by `onset_beat` across voices/staves. If two voices require the same pitch at the same score position, the current `strike_targets` consolidate by pitch while preserving multiple expected notes under that pitch. That is appropriate for physical-key semantics: one key attack can satisfy multiple notated same-pitch notes at the same onset.

## Current Support Matrix

Supported internally today:

```text
pitch: yes
onset position: yes, onset_beat
duration: yes internally on PracticeScoreEvent
voice/staff: yes internally and exposed on target groups
tie start/stop: yes internally via MusicXML metadata
chord membership: partially, represented as same onset/pitch group, not explicit MusicXML chord flag
measure / score position: yes, measure_numbers and onset_beat
pure tie continuation skipped: yes
mixed tie continuation + new chord tones: yes
```

Not yet explicit enough for a score-aware ByteDance runtime:

```text
attack_targets / ATTACK_REQUIRED: not exposed as a named contract
continuation: not exposed as a named contract
per-note tie/staff/voice in public target API: not exposed
zero-attack position contract: implicit, not named
slur-vs-tie boundary: not represented in practice target contract
pedal sustain boundary: not represented in practice target contract
```

## Answer To The Core Question

Can the current pipeline reliably generate `ATTACK_REQUIRED / CONTINUATION`?

```text
Partially.
```

The backend timeline has enough raw score data to derive it for MusicXML tie-based cases:

- pitch
- onset
- duration
- staff
- voice
- measure
- tie start/stop
- render note ids

It already uses those data to remove tie continuations from expected STEP groups.

But the current product contract does not explicitly represent `ATTACK_REQUIRED` and `CONTINUATION`. Consumers see `pitches`, not action semantics. For ByteDance score-aware rolling STEP, that implicit contract should be replaced with a named IR before runtime integration.

## Recommended Next Boundary

Modify the score-normalization boundary, not the audio runtime first.

The smallest clean next step:

1. Extend `PracticeScoreTimeline` with an explicit `practice_attack_steps` projection.
2. Keep existing `expected_practice_groups` as a compatibility projection until callers migrate.
3. Add `PracticeAttackStepRead` / `PracticeStepNoteRead` to the practice API.
4. Update `PracticeTargetCatalog` to expose `attack_targets` and `continuation`.
5. Add tests for the six examples in this document.

Primary implementation point:

```text
backend/app/processing/engines/practice_alignment/score_timeline.py
```

API/read-model boundary:

```text
backend/app/processing/engines/practice_alignment/target_catalog.py
backend/app/modules/practice/schemas.py
backend/app/modules/practice/service.py
apps/customer-web/src/generated/practice-api/types.gen.ts
```

Runtime boundary after that:

```text
ExpectedEventEvaluator / future ByteDance rolling verifier
should consume `attack_targets` pitches only.
```

Do not infer continuation from audio, sustain, pedal, or observed frame energy.

## 2026-09-14 Internal Projection Implementation

Status:

```text
implemented internally
API/frontend migration not started
ByteDance runtime integration not started
```

Added backend-only projection:

```text
PracticeScoreTimeline.practice_attack_steps
```

New internal types:

```text
PracticeStepNote
PracticeAttackStep
```

Implementation file:

```text
backend/app/processing/engines/practice_alignment/score_timeline.py
```

Implementation semantics:

```text
For each score onset:
  collect all PracticeScoreEvent items at that onset
  partition:
    entry_candidate=True  -> attack_targets
    entry_candidate=False -> continuation

If no attack targets exist:
  do not create a user-action PracticeAttackStep

If attack targets exist:
  create one PracticeAttackStep for that onset
  preserve continuation notes as context metadata
```

Compatibility:

```text
ExpectedPracticeGroup remains unchanged.
Existing runtime/evaluator callers are unchanged.
```

### Tie Source Audit

Repository/local canonical MusicXML samples were audited for tie representation.

Observed:

```text
notes_with_tie: 88
notes_with_tied: 88
tied_without_tie: 0
```

The current available canonical/work samples consistently include operational MusicXML tie elements:

```xml
<tie type="start|stop"/>
```

alongside notation elements:

```xml
<notations><tied type="start|stop"/></notations>
```

No local canonical sample was found with only `<notations><tied .../>` and no sibling `<tie .../>`.

Compatibility gap:

```text
If a future importer provides only <notations><tied .../>
without <tie .../>, the current timeline metadata reader will not classify
that note as a tie continuation.
```

That gap is recorded but intentionally not fixed in this projection-only pass.

### Focused Tests

Updated test file:

```text
backend/tests/test_practice_score_timeline.py
```

Covered cases:

```text
C4 -> D4
C4 -> C4 without tie
C4 --tie-- C4
mixed chord: tied C4 + new E4/G4
shared C4 re-articulated without tie
multi voice/staff same onset
multi-fragment tie chain
```

Important assertions:

```text
pure tie continuation
-> no extra PracticeAttackStep

mixed tie position
-> attack_targets = new physical targets
-> continuation = tied notes

same pitch without tie
-> new PracticeAttackStep attack

same onset across voices/staves
-> one physical STEP projection
```

Verification:

```text
docker exec 10377603b8c2 bash -lc "cd /app && python -m pytest tests/test_practice_score_timeline.py -q"
```

Result:

```text
11 passed, 1 warning
```

The warning is an existing Starlette/httpx deprecation warning from test dependencies, not from this change.

### Next Safe Boundary

The projection is now ready for the next migration step:

```text
PracticeTargetCatalog/API migration
```

Recommended next step:

```text
Expose attack_targets / continuation in PracticeTargetCatalogRead
while keeping existing pitches/render_note_ids fields for compatibility.
```

Do not integrate ByteDance runtime until the API/read-model contract can carry score-action semantics explicitly.

## 2026-09-14 Internal IR Contract Tightening

Status:

```text
PracticeAttackStep IR = READY_FOR_CATALOG_MIGRATION
```

Two internal contract issues were fixed before exposing the projection.

### Semantic Step Identity

`PracticeAttackStep.step_id` no longer depends on `render_note_id`.

Current identity input:

```text
onset_beat
stable event_ids
```

This matches the existing `ExpectedPracticeGroup` principle: rendering ids may change between revisions/renders, but the musical/event identity should remain stable when the underlying score position is unchanged.

Regression coverage:

```text
same musical structure
different MusicXML render note ids
-> PracticeAttackStep.step_id unchanged
-> event_ids unchanged
-> render_note_ids changed
```

### Physical Attack Targets

`PracticeAttackStep.attack_targets` contains physical attack targets rather than raw notation notes.

Internal target:

```text
PracticeAttackTarget {
  attack_id
  pitch
  notes
  event_ids
  render_note_ids
  measure_numbers
}
```

Semantics:

```text
same onset + same pitch across voices/staves
-> one physical attack target
-> multiple underlying PracticeStepNote items
```

```text
same onset + different pitches
-> one physical attack target per pitch
```

`continuation` remains notation-note metadata:

```text
continuation: tuple[PracticeStepNote, ...]
```

because continuation notes do not drive microphone MATCH.


### Canonical Field Name And Target Identity

The internal code contract now uses one canonical field name:

```text
PracticeAttackStep.attack_targets
```

There is no `attack_required` field or alias in the internal IR. `ATTACK_REQUIRED` remains only a music-semantics term in product/design language.

`PracticeAttackTarget.attack_id` is now unique across distinct score steps and stable across render-id changes.

Identity input:

```text
step_id
pitch
stable event_ids for that pitch target
```

It must not depend on `render_note_id`.

### Focused Verification

Additional coverage:

```text
step_id stable when render ids change
attack_id stable when render ids change
two different C4 attack steps have different attack_id values
same pitch in two voices/staves -> one attack target, two notation notes
mixed tied chord -> attack targets exclude tied note, continuation includes tied note
same pitch without tie at later onset -> new attack target
pure continuation -> no PracticeAttackStep
```

Verification:

```text
docker exec 10377603b8c2 bash -lc "cd /app && python -m pytest tests/test_practice_score_timeline.py -q"
```

Result:

```text
12 passed, 1 warning
```

The warning is the existing Starlette/httpx dependency deprecation warning.

Previous safe boundary:

```text
PracticeTargetCatalog/API migration can begin.
```

Still do not integrate ByteDance runtime until the catalog/API contract exposes the score-action semantics explicitly.


## Catalog/API Read-Model Migration

Status:

```text
Practice Target API semantics = READY_FOR_CONSUMER_MIGRATION
```

The backend target catalog still preserves the legacy catalog identity:

```text
PracticeTargetCatalog
<- PracticeScoreTimeline.expected_practice_groups
```

The following legacy fields remain sourced from `ExpectedPracticeGroup` and must remain unchanged:

```text
index
group_id
onset_beat
event_ids
render_note_ids
pitches
measure_numbers
staff_ids
voice_ids
```

The additive score-action fields are attached by matching each existing target to the unique
`PracticeAttackStep` at the same `onset_beat`:

```text
step_id
attack_targets
continuation
```

Catalog construction fails fast if the expected group pitch set differs from the corresponding
`PracticeAttackStep.attack_targets` pitch set. There is no fallback compatibility path, because that
would hide a score-semantics contract violation.

Read DTOs:

```text
PracticeStepNoteRead
PracticeAttackTargetRead
PracticeTargetRead.step_id
PracticeTargetRead.attack_targets
PracticeTargetRead.continuation
```

There is no public `attack_required` alias. `ATTACK_REQUIRED` remains a design term; the API field is
`attack_targets`.

Focused verification now covers:

```text
legacy target order/count/group_id unchanged
simple new attack exposes step_id and attack_targets
mixed tied chord keeps legacy pitches/render ids as new attacks only
mixed tied chord exposes tied notes through continuation
same pitch across voices/staves consolidates into one physical attack target
pure tie continuation creates no catalog target
step_id and attack_id remain stable across render-note id changes
OpenAPI serializes step_id / attack_targets / continuation
```

Verification:

```text
docker exec 10377603b8c2 bash -lc "cd /app && python -m pytest tests/test_practice_score_timeline.py tests/test_practice_target_catalog.py tests/test_practice_service_access.py::test_list_practice_targets_uses_practice_access_and_score_timeline tests/test_practice_api_smoke.py::test_practice_openapi_keeps_session_response_contracts_explicit -q"
```

Result:

```text
19 passed, 1 warning
```

Next safe boundary:

```text
frontend type regeneration / runtime consumer migration can begin.
```

Do not change session progression, matcher/evaluator behavior, or ByteDance runtime integration until
a consumer explicitly adopts `attack_targets` / `continuation`.


## STEP Progression Shadow Consumer

Status:

```text
STEP score-action consumer contract = READY_FOR_VERIFIER_MIGRATION
```

`WaitForNoteFollowPolicy` now reads both projections:

```text
score_timeline.expected_practice_groups
score_timeline.practice_attack_steps
```

and validates them once during initialization.

Contract:

```text
len(expected_practice_groups) == len(practice_attack_steps)
group.onset_beat == step.onset_beat
set(group.pitches) == set(target.pitch for target in step.attack_targets)
```

There is no fallback to pitch-only inference. A mismatch is an internal score-semantics contract
violation.

Runtime behavior remains legacy-authoritative:

```text
current_expected_group
-> ExpectedEventEvaluator.evaluate(...)
-> MATCH / PARTIAL / MISMATCH / UNCERTAIN
-> existing progression behavior
```

The new shadow property:

```text
WaitForNoteFollowPolicy.current_attack_step
```

uses the same `_current_index` and scope boundaries as `current_expected_group`. It does not maintain
a second progression index.

Verified lockstep behavior:

```text
initial target
MATCH advances once
explicit Skip advances once
PARTIAL / MISMATCH / UNCERTAIN do not advance
reset returns both projections to scoped start
start_expected_group_id starts both projections at the same score position
end_expected_group_id makes both projections None after the terminal target
```

Musical regression coverage:

```text
C4 -> C4 same-note re-articulation
tied C4 + new F4/A4 mixed chord
same-pitch multi-voice/staff consolidation
```

The mixed tied chord regression confirms:

```text
current_expected_group.pitches = [F4, A4]
current_attack_step.attack_targets = [F4, A4]
current_attack_step.continuation = [C4]
ExpectedEventEvaluator still receives only the legacy expected group [F4, A4]
```

Verification:

```text
docker exec 10377603b8c2 bash -lc "cd /app && python -m pytest tests/test_practice_follow_policy.py -q"
docker exec 10377603b8c2 bash -lc "cd /app && python -m py_compile app/processing/engines/practice_alignment/follow_policy.py"
docker exec 10377603b8c2 bash -lc "cd /app && python -m pytest tests/test_practice_midi_engine.py tests/test_practice_runtime_regressions.py::test_matchmaker_live_engine_reset_input_buffer_discards_wait_for_note_event_state -q"
```

Result:

```text
23 passed, 1 warning
9 passed, 1 warning
```

Next safe boundary:

```text
microphone verifier migration can read current_attack_step.attack_targets.
```

Do not alter progression decisions until the verifier boundary explicitly adopts score-action
semantics.


## STEP Microphone Verifier Boundary

Status:

```text
STEP microphone verifier boundary = READY_FOR_BYTEDANCE_ADAPTER
```

The backend now has a lightweight verifier boundary:

```text
StepVerifierTarget {
  step_id
  attack_pitches
  continuation_pitches
}
```

Construction is deterministic from `PracticeAttackStep`:

```text
attack_pitches = tuple(target.pitch for target in step.attack_targets)
continuation_pitches = tuple(note.pitch for note in step.continuation)
```

The boundary also defines a stateful protocol:

```text
observe_audio(chunk, *, target)
reset()
close()
```

Current integration is shadow-only in `MatchmakerLiveEngine`:

```text
policy.current_attack_step
-> StepVerifierTarget
-> optional verifier.observe_audio(...)
-> internal shadow observation buffer
```

The verifier is disabled by default. Verifier observations do not call:

```text
ExpectedEventEvaluator
decide_evaluation
advance
_current_index += 1
```

Score-action invariants covered:

```text
tied C4 + new F4/A4
-> attack_pitches = [F4, A4]
-> continuation_pitches = [C4]

C4 -> C4
-> both steps require C4 attack
-> distinct step_id values

same-pitch multi-voice/staff C4
-> one physical C4 attack target
```

Shadow lifecycle coverage:

```text
audio chunk receives current step target
MATCH moves later chunks to the next target
Skip moves later chunks to the next target
PARTIAL / MISMATCH / UNCERTAIN leave target unchanged
reset returns target to scoped start
scope terminal has no target
verifier observation cannot change progression
verifier reset/close are forwarded when the engine resets/closes
```

Verification:

```text
docker exec 10377603b8c2 bash -lc "cd /app && python -m py_compile app/processing/engines/practice_alignment/step_microphone_verifier.py app/processing/engines/practice_alignment/matchmaker_live.py"
docker exec 10377603b8c2 bash -lc "cd /app && python -m pytest tests/test_practice_runtime_regressions.py::test_step_microphone_verifier_receives_current_attack_step_target tests/test_practice_runtime_regressions.py::test_step_microphone_verifier_target_follows_match_and_skip_progression tests/test_practice_runtime_regressions.py::test_step_microphone_verifier_target_does_not_advance_on_non_match_results tests/test_practice_runtime_regressions.py::test_step_microphone_verifier_reset_returns_target_to_scoped_start tests/test_practice_runtime_regressions.py::test_step_microphone_verifier_target_uses_score_action_semantics tests/test_practice_runtime_regressions.py::test_matchmaker_live_engine_reset_input_buffer_discards_wait_for_note_event_state tests/test_practice_midi_engine.py -q"
```

Result:

```text
14 passed, 1 warning
```

Next safe boundary:

```text
ByteDance score-aware rolling adapter can implement StepMicrophoneVerifier.
```

Do not let verifier observations drive production progression until a dedicated migration explicitly
changes the evaluator/progression boundary.


## ByteDance StepMicrophoneVerifier Adapter

Status:

```text
ByteDance StepMicrophoneVerifier adapter = IMPLEMENTED_FOR_RESEARCH
dev/cal parity = BLOCKED_BY_MISSING_CHECKPOINT_IN_CURRENT_CONTAINER
```

The research-only adapter implements:

```text
StepVerifierTarget
+ PCM s16le stream
-> ByteDanceRollingStepVerifier
-> timestamped StepVerifierObservation
```

Fixed contract:

```text
sample_rate = 16000
mono PCM s16le
lookback = 1000ms
anchor = 1600ms
future = 220ms
onset threshold = 0.2
frame threshold = 0.2
cadence = 150ms
event dedupe = 50ms
event rule = temporally_bound
```

Observation event time is audio-stream time:

```text
event_sample_index
event_time_seconds = event_sample_index / sample_rate
onset_score
frame_score
```

Model compute latency remains separate from acoustic event time.

Rolling state currently tracks:

```text
PCM rolling buffer
absolute sample cursor
next inference anchor
deduplicated onset events
active step_id
step activation boundary
consumed-through sample
```

Important boundary:

```text
step_id change at chunk boundary
```

is only the research adapter contract. Production still needs an explicit accepted-event handoff design:

```text
accepted verifier event
-> consumed boundary
-> MATCH
-> policy advance
-> next STEP activation
```

The adapter uses only:

```text
reg_onset_output
frame_output
```

and the `temporally_bound` rule:

```text
onset_peak >= 0.2
frame_at_onset_peak >= 0.2
```

STEP activation event contract:

```text
A STEP may consume only an onset that occurred after that STEP became active.

effective event boundary =
max(previous consumed boundary, step activation boundary)

event_sample_index must be strictly greater than that boundary.
```

This is a deliberate formulation correction, not model tuning, threshold tuning, cadence tuning,
or an attempt to force zero diff with earlier saved research reports.

It does not use decoded MIDI, velocity rejection, onset-shape heuristics, model-native peak semantics,
O&V, RTT, frozen evaluation, production feature flags, or production session integration.

Research parity runner:

```text
backend/scripts/evaluate_bytedance_step_verifier_adapter_parity.py
```

The runner reuses existing dev/cal case manifests and compares adapter decisions against:

```text
backend/data/work/datasets/maestro-v3.0.0/bytedance_score_aware_rolling_step_dev_cal.json
```

Parity comparison rules:

```text
Rows are aligned by stable keys:
source_recording_id
case_id
case_kind
family
transition_key
```

The comparator fails fast on:

```text
missing_adapter_rows
extra_adapter_rows
duplicate_keys
```

The CLI now returns non-zero after still writing the report when:

```text
key_contract.failed == true
unexpected_adapter_mismatch_count > 0
```

Only pure expected activation-contract differences may exit successfully.

When `--case-limit` is used for a smoke run, the reference report is restricted to the same selected
case identities before row comparison. Coverage checks remain enabled; the limit does not silently
turn parity into a best-effort zip comparison.

Decision differences are separated into:

```text
EXPECTED_ACTIVATION_CONTRACT_DIFFERENCE
UNEXPECTED_ADAPTER_MISMATCH
```

The full GPU run target is:

```text
UNEXPECTED_ADAPTER_MISMATCH == 0
```

not necessarily:

```text
diff_count == 0
```

because pre-activation event rejections are now expected contract differences.

Activation-contract differences are narrowly classified. The reference selected match must have
accepted, the adapter must fail in the rejection direction, and at least one selected required attack
event in `events[].event_time` must convert to a sample strictly before the activation sample:

```text
event_sample < activation_sample
```

An event exactly at `activation_sample` is the first valid post-activation sample and is not an
expected activation-contract rejection. Other decision changes remain `UNEXPECTED_ADAPTER_MISMATCH`
even when the reference match contains an early event.

Attempted parity command:

```text
docker exec 10377603b8c2 bash -lc "cd /app && NOTEVERSE_BYTEDANCE_CHECKPOINT=/opt/noteverse/models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth python scripts/evaluate_bytedance_step_verifier_adapter_parity.py --policy research/policies/step_microphone_bytedance_v1.json --case-manifest data/work/datasets/maestro-v3.0.0/production_step_development_set/public_step_causal_cases_manifest.json --case-manifest data/work/datasets/maestro-v3.0.0/production_step_calibration_set/public_step_causal_cases_manifest.json --reference-report data/work/datasets/maestro-v3.0.0/bytedance_score_aware_rolling_step_dev_cal.json --output data/work/datasets/maestro-v3.0.0/bytedance_step_verifier_adapter_parity_dev_cal.json --device cuda"
```

Checkpoint status:

```text
/opt/noteverse/models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth
sha256 = c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141
```

The checkpoint identity matches the frozen policy. The script supports `NOTEVERSE_BYTEDANCE_CHECKPOINT`
so the container-local `/opt/noteverse/...` path can be used without committing local model links.

Current blocker:

```text
torch.cuda.is_available() == False
```

The container currently sees a CUDA build of PyTorch but no CUDA device. Full 192-case adapter parity
falls back to CPU and is not practical in this container. A CPU smoke run was started and stopped after
it exceeded the expected quick-check budget. Do not treat this as a model or checkpoint failure; rerun
the parity command in a container where CUDA is visible, or expect a long CPU-only research run.

Verification completed without loading the checkpoint:

```text
docker exec 10377603b8c2 bash -lc "cd /app && python -m py_compile app/processing/engines/practice_alignment/bytedance_step_verifier.py app/processing/engines/practice_alignment/step_microphone_verifier.py scripts/evaluate_bytedance_step_verifier_adapter_parity.py"
docker exec 10377603b8c2 bash -lc "cd /app && python -m pytest tests/test_bytedance_step_verifier.py tests/test_bytedance_adapter_parity_comparator.py tests/test_practice_runtime_regressions.py::test_step_microphone_verifier_receives_current_attack_step_target tests/test_practice_runtime_regressions.py::test_step_microphone_verifier_target_uses_score_action_semantics -q"
```

Result:

```text
fake-backend adapter tests passed
activation-boundary tests passed
parity comparator tests passed
shadow verifier wiring tests passed
CLI exit-code gate tests passed
```

Harness status:

```text
ByteDance adapter parity harness
= READY_FOR_FULL_GPU_RUN
```

Adapter runtime handoff status remains:

```text
ByteDance StepMicrophoneVerifier adapter
!= READY_FOR_RUNTIME_HANDOFF_DESIGN
```

It can only be promoted after dev/cal adapter parity runs against the expected checkpoint and any
decision/event diffs are either zero or explicitly explained.
