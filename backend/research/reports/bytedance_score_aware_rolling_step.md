# ByteDance Score-Aware Rolling STEP

Date: 2026-09-14

Scope:

- Research-only formulation benchmark.
- Dataset: inspected development + calibration MAESTRO public paired cases.
- Frozen evaluation set: not used.
- Production parser/progression: not modified.
- Thresholds unchanged: `onset >= 0.2`, `frame >= 0.2`.
- Cadence unchanged: `150ms`.
- No threshold sweep, cadence sweep, velocity/onset-shape rejection, O&V, RTT, model training, browser optimization, or production integration.

Script:

```text
backend/scripts/evaluate_bytedance_score_aware_rolling_step.py
```

Output:

```text
backend/data/work/datasets/maestro-v3.0.0/bytedance_score_aware_rolling_step_dev_cal.json
```

## Contract

This benchmark changes the musical contract from:

```text
expected pitch set
```

to:

```text
ATTACK_REQUIRED
CONTINUATION
```

Only ATTACK_REQUIRED pitches can drive automatic STEP advancement.

```text
ATTACK_REQUIRED:
  must have new onset evidence

CONTINUATION:
  belongs to the score position
  does not require a new onset
  cannot advance by sustain alone
```

The current implementation still uses the same ByteDance rolling event stream:

```text
PCM
-> periodic ByteDance note_model
-> onset/frame events
-> consumed-event boundary
-> ATTACK_REQUIRED set
```

The `50ms` event dedupe remains only an overlapping-window identity boundary. It is not a long same-note cooldown.

## Case Families

Primary product metrics:

```text
single_new_attack
chord_new_attack
wrong_pitch
missing_chord_tone
same_note_rearticulation
shared_tone_rearticulation
shared_tone_continuation
```

Secondary safety stress:

```text
long_held_note_without_retrigger
pedal_sustain_tail_without_retrigger
```

`shared_tone_continuation` is not a notation-tie claim. MAESTRO MIDI does not reliably encode score ties. These cases are marked as:

```text
gt_note_span_synthetic_product_semantic_diagnostic
```

They are constructed when a note span remains active at the next physical strike while other notes attack.

## Results

### temporally_bound

| Family | Auto advance | Clean false automatic advance | Missed expected advance |
| --- | ---: | ---: | ---: |
| single new attack | 20 / 24 | 0 / 24 | 4 / 24 |
| chord new attack | 18 / 24 | 0 / 24 | 6 / 24 |
| wrong pitch | 0 / 48 | 0 / 43 | 0 / 48 |
| missing chord tone | 2 / 24 | 0 / 20 clean | 0 / 24 |
| same-note re-articulation | 17 / 20 eligible | 0 / 20 | 3 / 20 |
| shared-tone re-articulation | 36 / 50 eligible | 0 / 50 | 15 / 50 |
| shared-tone continuation | 76 / 77 eligible | 3 / 77 | 4 / 77 |

Secondary safety stress:

| Family | Auto advance | Clean false automatic advance |
| --- | ---: | ---: |
| long-held no-retrigger | 2 / 20 eligible | 2 / 20 |
| pedal-tail no-retrigger | 4 / 18 eligible | 4 / 18 |

### model_native_event_stream

| Family | Auto advance | Clean false automatic advance | Missed expected advance |
| --- | ---: | ---: | ---: |
| single new attack | 20 / 24 | 0 / 24 | 4 / 24 |
| chord new attack | 10 / 24 | 0 / 24 | 14 / 24 |
| wrong pitch | 0 / 48 | 0 / 43 | 0 / 48 |
| missing chord tone | 2 / 24 | 0 / 20 clean | 0 / 24 |
| same-note re-articulation | 17 / 20 eligible | 0 / 20 | 3 / 20 |
| shared-tone re-articulation | 36 / 53 eligible | 0 / 53 | 19 / 53 |
| shared-tone continuation | 57 / 57 eligible | 3 / 57 | 3 / 57 |

Secondary safety stress:

| Family | Auto advance | Clean false automatic advance |
| --- | ---: | ---: |
| long-held no-retrigger | 2 / 13 eligible | 2 / 13 |
| pedal-tail no-retrigger | 4 / 13 eligible | 4 / 13 |

## Interpretation

The score-aware contract improves the interpretation of the previous rolling results:

```text
wrong pitch clean false advance = 0
missing chord clean false advance = 0
same-note re-articulation is usable
shared-tone re-articulation is usable but has false negatives
```

This supports the idea that STEP should be driven by ATTACK_REQUIRED onsets, not by a flat expected pitch set.

However, this formulation is not yet clean enough to freeze:

```text
shared-tone continuation has 3 premature false advances
```

Those are synthetic product-semantic diagnostics, not proven notation-tie failures, but they show that the current score-aware formulation still needs a stricter definition of when a continuation diagnostic is eligible to count as a product transition.

The held/pedal no-retrigger families remain useful safety stress tests, but they should not be the primary product gate by themselves.

## Decision

Current decision:

```text
ByteDance score-aware rolling STEP = NEEDS_MORE_FORMULATION_WORK
```

This is not a model STOP. The important product-facing signal is:

```text
clean wrong/missing false advance is zero
same-note re-articulation works in most eligible cases
shared-tone re-articulation works without clean false automatic advance
```

The next step should be benchmark construction, not model tuning:

1. Rebuild held/pedal no-retrigger cases after the full-export-range same-pitch exclusion fix.
2. Refine score-aware shared-tone continuation case construction so it reflects a real score transition or remains clearly labeled as synthetic stress.
3. Only after the score-aware case semantics are clean should raw evidence separability or another model be reconsidered.
