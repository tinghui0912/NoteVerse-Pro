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
  attack_required: PracticeStepNote[]
  continuation: PracticeStepNote[]
}

PracticeStepNote {
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
attack_required
= notes at this score position that require a new physical key attack
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

Create one practice step for `attack_required`. Keep `continuation` as context metadata for display/reporting, but do not require new onset for continuation notes.

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
attack_required: not exposed as a named contract
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
4. Update `PracticeTargetCatalog` to expose `attack_required` and `continuation`.
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
should consume attack_required pitches only.
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
    entry_candidate=True  -> attack_required
    entry_candidate=False -> continuation

If attack_required is empty:
  do not create a user-action PracticeAttackStep

If attack_required is non-empty:
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
-> attack_required = new notes
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
Expose attack_required / continuation in PracticeTargetCatalogRead
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

`attack_required` now contains physical attack targets rather than raw notation notes.

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

`PracticeAttackStep.attack_targets` is an alias for `PracticeAttackStep.attack_required`.

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

### Focused Verification

Additional coverage:

```text
step_id stable when render ids change
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

Next safe boundary:

```text
PracticeTargetCatalog/API migration can begin.
```

Still do not integrate ByteDance runtime until the catalog/API contract exposes the score-action semantics explicitly.
