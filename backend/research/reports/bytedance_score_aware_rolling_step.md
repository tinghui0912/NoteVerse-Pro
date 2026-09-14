# ByteDance Score-Aware Rolling STEP

Date: 2026-09-14

Scope:

- Research-only formulation benchmark.
- Dataset: inspected development + calibration MAESTRO public paired cases.
- Frozen evaluation set: not used.
- Production parser/progression: not modified.
- Thresholds unchanged: `onset >= 0.2`, `frame >= 0.2`.
- Cadence unchanged: `150ms`.
- Event dedupe unchanged: `50ms`.
- No threshold sweep, cadence sweep, velocity/onset-shape rejection, O&V, RTT, model training, browser optimization, or production integration.

Scripts:

```text
backend/scripts/build_maestro_multi_source_step_causal_cases.py
backend/scripts/extract_public_paired_step_causal_cases.py
backend/scripts/evaluate_bytedance_score_aware_rolling_step.py
```

Output:

```text
backend/data/work/datasets/maestro-v3.0.0/bytedance_score_aware_rolling_step_dev_cal.json
```

## Benchmark Fixes

### No-Retrigger Case Rebuild

The public paired case builder now applies full-export-range same-pitch exclusion to:

```text
long_held_note_without_retrigger
pedal_sustain_tail_without_retrigger
```

This generalizes the existing same-pitch guard previously used only by:

```text
same_note_retrigger
```

The development/calibration manifests were rebuilt from the same source recordings. Source filename + audio SHA256 stayed unchanged for both sets.

Case counts stayed:

```text
development: 128
calibration: 64
```

Held/pedal replacements occurred only within the same source recordings. The largest change was in pedal-tail cases, where previous exported clips could contain uncounted same-pitch note-ons near the end of the clip.

### Adjacent Transition Semantics

The score-aware transition builder no longer searches for an arbitrary later suitable group.

Every score-aware transition is now based only on adjacent GT physical strike groups:

```text
group[i] -> group[i+1]
```

For `group[i+1]`:

```text
ATTACK_REQUIRED =
  pitches with physical note-on in group[i+1]

CONTINUATION =
  pitches whose earlier note span remains active across group[i+1]
  and which do not have a new note-on in group[i+1]
```

This is physical-action GT semantics, not notation-tie ground truth. MAESTRO MIDI does not reliably encode score ties.

Transitions are deduplicated by:

```text
source_recording_id
first_group_source_time
second_group_source_time
```

so overlapping extracted clips do not multiply-count the same real source transition.

## Runtime Contract

The simulated STEP runtime remains:

```text
PCM
-> periodic ByteDance note_model
-> new onset events
-> consumed-event boundary
-> ATTACK_REQUIRED set only
```

CONTINUATION:

```text
does not require a new onset
does not itself drive advancement
```

## Results

`temporally_bound` remains the main candidate because `model_native_event_stream` has weaker chord recall.

### temporally_bound

Primary product metrics:

| Family | Total | Legitimate/auto advance | Clean false automatic advance | Missed / unresolved |
| --- | ---: | ---: | ---: | ---: |
| single attack | 24 | 24 / 24 | 0 / 24 | 0 / 24 |
| chord attack | 24 | 21 / 24 | 0 / 24 | 3 / 24 |
| wrong pitch | 48 | 0 / 48 | 0 / 43 clean | 0 / 48 |
| missing chord tone | 24 | 2 / 24 raw | 0 / 20 clean | 0 / 24 |
| same-note re-articulation | 24 | 20 / 23 eligible | 0 / 23 | 3 / 23 |
| adjacent transitions, all | 985 | 813 / 895 eligible | 0 / 895 | 125 / 895 |
| adjacent single attack | 726 | 625 / 669 eligible | 0 / 669 | 68 / 669 |
| adjacent multi-note attack | 259 | 188 / 226 eligible | 0 / 226 | 57 / 226 |
| same-pitch re-articulation | 28 | 19 / 23 eligible | 0 / 23 | 4 / 23 |
| shared-pitch re-articulation | 65 | 42 / 50 eligible | 0 / 50 | 12 / 50 |
| mixed continuation + attack | 399 | 328 / 356 eligible | 0 / 356 | 44 / 356 |

Adjacent transition classifications:

```text
LEGITIMATE_ADVANCE: 770
LATE_OR_STALE_MATCH: 43
PREMATURE_FALSE_ADVANCE: 0
```

Secondary safety stress:

| Family | Auto advance | Clean false automatic advance |
| --- | ---: | ---: |
| long-held no-retrigger | 1 / 23 eligible | 1 / 23 |
| pedal-tail no-retrigger | 0 / 20 eligible | 0 / 20 |

### model_native_event_stream

Diagnostic comparison only:

| Family | Total | Legitimate/auto advance | Clean false automatic advance | Missed / unresolved |
| --- | ---: | ---: | ---: | ---: |
| single attack | 24 | 24 / 24 | 0 / 24 | 0 / 24 |
| chord attack | 24 | 12 / 24 | 0 / 24 | 12 / 24 |
| wrong pitch | 48 | 0 / 48 | 0 / 43 clean | 0 / 48 |
| missing chord tone | 24 | 2 / 24 raw | 0 / 20 clean | 0 / 24 |
| same-note re-articulation | 24 | 20 / 23 eligible | 0 / 23 | 3 / 23 |
| adjacent transitions, all | 985 | 795 / 900 eligible | 0 / 900 | 133 / 900 |
| adjacent single attack | 726 | 620 / 672 eligible | 0 / 672 | 71 / 672 |
| adjacent multi-note attack | 259 | 175 / 228 eligible | 0 / 228 | 62 / 228 |
| same-pitch re-articulation | 28 | 22 / 26 eligible | 0 / 26 | 4 / 26 |
| shared-pitch re-articulation | 65 | 41 / 53 eligible | 0 / 53 | 14 / 53 |
| mixed continuation + attack | 399 | 322 / 358 eligible | 0 / 358 | 43 / 358 |

Secondary safety stress:

| Family | Auto advance | Clean false automatic advance |
| --- | ---: | ---: |
| long-held no-retrigger | 1 / 14 eligible | 1 / 14 |
| pedal-tail no-retrigger | 0 / 16 eligible | 0 / 16 |

## Interpretation

The corrected adjacent-transition benchmark changes the conclusion:

```text
primary clean false automatic advance = 0
```

across:

```text
wrong pitch
missing chord tone
same-note re-articulation
shared-pitch re-articulation
mixed continuation + attack
all adjacent physical transitions
```

Remaining product-facing failures are mostly:

```text
false negatives
late/stale matches
unresolved attempts
```

This is compatible with explicit Skip as the recovery path.

The secondary held/pedal stress cases are much cleaner after rebuilding:

```text
pedal-tail false = 0
long-held false = 1
```

They remain useful stress tests, but they no longer dominate the product decision.

## Decision

For the current development/calibration formulation evidence:

```text
ByteDance score-aware rolling STEP = KEEP_CANDIDATE_FORMULATION
```

This is not production integration approval. It means the score-aware contract is now the right research direction:

```text
ATTACK_REQUIRED drives automatic progression.
CONTINUATION does not require onset and does not advance by sustain alone.
```

Next work should be about engineering the formulation toward runtime, not threshold or rejection-rule tuning:

1. Keep `temporally_bound` as the main candidate.
2. Treat `model_native_event_stream` as diagnostic because chord recall is lower.
3. Do not tune thresholds/cadence/dedupe on this inspected dev/cal evidence.
4. Before production integration, design the score parser contract that can mark ATTACK_REQUIRED vs CONTINUATION from actual score structure.
