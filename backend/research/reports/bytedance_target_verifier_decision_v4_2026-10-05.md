# ByteDance Shared Target Verifier Decision v4

Generated: 2026-10-05  
Harness HEAD: `1054615c1491818baff3803e9dda95b7077b2171`  
Frozen evaluation used: `false`

## Phase 6C correction

The Phase 6C final model verdict `ByteDance Shared Target Verifier = FAIL` is **SUPERSEDED AS FINAL MODEL VERDICT**.

The Stage A paired context evidence remains valid. It answers only whether longer historical context changed the paired target decisions; it is not the full product-quality gate.

Current defensible verdict before Phase 6D was:

```text
ByteDance Shared Target Verifier = INCONCLUSIVE
```

## Preserved Stage A context finding

Source: `backend/research/reports/bytedance_target_verifier_dev_context_v3_2026-10-05.json`  
SHA256: `cf1287e1027110869e3dbec33f8737c62ab0fc7d52f64cf3851224e3931e90eb`

The 90-target paired context cohort produced identical decisions across `1.82s`, `3s`, `5s`, and `10s`:

```text
pairedDecisionDifferenceCount = 0 / 90
pairedObservedPitchDifferenceCount = 0 / 90
```

Context timing:

| Context | Median forward | p95 forward | Decision/pitch benefit |
|---:|---:|---:|---|
| 1.82s | 223.292ms | 252.921ms | none observed |
| 3s | 347.977ms | 418.309ms | none observed |
| 5s | 599.866ms | 665.867ms | none observed |
| 10s | 1223.395ms | 1364.298ms | none observed |

Phase 6D therefore provisionally selected `1820ms` total input context for the full Development gate because longer contexts showed no paired decision benefit and increased latency.

## Phase 6D evidence

| Artifact | Path | SHA256 |
|---|---|---|
| Policy | `backend/research/policies/bytedance_target_verifier_policy_v3_2026-10-05.json` | `1d26d176b6a95877175e130c11b287a40499e09a2b73c13f9991a5473aae7c1f` |
| Harness | `backend/scripts/evaluate_bytedance_shared_target_verifier_v3.py` | `aabffce8ea58c02839478ef0b035383af20b20ecc53bdad51c25f309e2f02199` |
| Development targets | `backend/research/reports/bytedance_target_verifier_dev_targets_v4_2026-10-05.json` | `4019633352aa471763b27fc2d380ce3bc87a3095543e5a4ecac62e0dd4da9597` |
| Calibration targets | `backend/research/reports/bytedance_target_verifier_calibration_targets_v4_2026-10-05.json` | `ff9c0ab56b1b26886f53dd17af493b50e610c89e9661fe917ea93c044d6940af` |
| Full Development | `backend/research/reports/bytedance_target_verifier_dev_full_v4_2026-10-05.json` | `66a1eb79b4159f48f5c38f1d356cfbfd696e287605d2a6afe4ac39186c76918e` |
| Full Development gate | `backend/research/reports/bytedance_target_verifier_dev_full_gate_v4_2026-10-05.json` | `7e2faf5d00cb2afc2587536cd220b14fbe1be130d1ecbdeacec91b2aa51e2aca` |

Gate semantics were corrected:

```text
sampleCount = 0 => NOT_EVALUATED
any valid hard criterion FAIL => FAIL
no hard FAIL but any required NOT_EVALUATED => INCONCLUSIVE
all required criteria PASS => PASS
```

## Full Development setup

```text
targetCount = 421
selectedTotalInputContextMs = 1820
historicalPastContextMs = 1600
postAttackContextCandidatesMs = [220, 350]
```

Family counts in the Development manifest:

| Family | Count |
|---|---:|
| correct_single | 37 |
| complete_chord | 16 |
| same_note_retrigger_second | 16 |
| dense_repeated_pitch | 24 |
| fast_adjacent_pitch | 24 |
| partial_overlapping_notes | 21 |
| soft_attack | 22 |
| loud_attack | 24 |
| wrong_semitone | 16 |
| wrong_octave | 16 |
| missing_chord_tone | 16 |
| long_held_no_retrigger | 48 |
| pedal_sustain_no_retrigger | 48 |

## 220ms post context

Forward timing:

```text
okCount = 256
medianForwardMs = 228.374
p95ForwardMs = 270.087
```

Hard gate results:

| Criterion | Value | Sample count | Verdict |
|---|---:|---:|---|
| correct_single recall | 1.000000 | 4 | PASS |
| complete_chord recall | 1.000000 | 12 | PASS |
| same_note_retrigger_second recall | 0.800000 | 15 | FAIL |
| dense_repeated_pitch recall | 1.000000 | 11 | PASS |
| fast_adjacent_pitch recall | 1.000000 | 14 | PASS |
| partial_overlapping_notes recall | 1.000000 | 11 | PASS |
| soft_attack recall | 0.700000 | 10 | FAIL |
| loud_attack recall | 1.000000 | 16 | PASS |
| wrong_semitone false accepts | 0 | 1 | PASS |
| wrong_octave false accepts | 0 | 1 | PASS |
| missing_chord_tone false accepts | 0 | 1 | PASS |
| verified long-held no-retrigger false accepts | 1 | 48 | FAIL |
| verified pedal no-retrigger false accepts | 2 | 47 | FAIL |

## 350ms post context

Forward timing:

```text
okCount = 256
medianForwardMs = 239.244
p95ForwardMs = 276.500
```

Hard gate results:

| Criterion | Value | Sample count | Verdict |
|---|---:|---:|---|
| correct_single recall | 1.000000 | 4 | PASS |
| complete_chord recall | 1.000000 | 12 | PASS |
| same_note_retrigger_second recall | 0.866667 | 15 | FAIL |
| dense_repeated_pitch recall | 1.000000 | 11 | PASS |
| fast_adjacent_pitch recall | 1.000000 | 14 | PASS |
| partial_overlapping_notes recall | 1.000000 | 11 | PASS |
| soft_attack recall | 0.700000 | 10 | FAIL |
| loud_attack recall | 1.000000 | 16 | PASS |
| wrong_semitone false accepts | 0 | 1 | PASS |
| wrong_octave false accepts | 0 | 1 | PASS |
| missing_chord_tone false accepts | 0 | 1 | PASS |
| verified long-held no-retrigger false accepts | 2 | 48 | FAIL |
| verified pedal no-retrigger false accepts | 2 | 47 | FAIL |

## Failure diagnostics

### Same-note retrigger

The known Phase 6C miss remains traceable:

```text
targetId = causal:s08_same_note_retrigger_002:g1
postAttackContextMs = 220
missing pitch = G3
onsetActivation = 0.195858
frameActivation = 0.998251
onsetPeakTimeRelativeMs = 10
absoluteOnsetPeakTime = 16.9131
```

Other second-retrigger misses:

```text
causal:s03_same_note_retrigger_002:g1
  missing G4 at both 220ms and 350ms
  onsetActivation ~= 0.00087
  frameActivation ~= 0.992
  onsetPeakTimeRelativeMs = -170

causal:s04_same_note_retrigger_001:g1
  missing B4 at both 220ms and 350ms
  onsetActivation = 0.059040 / 0.065533
  frameActivation = 0.013680 / 0.028958
  onsetPeakTimeRelativeMs = -10
```

### Soft attack

Soft attack recall failed for both candidates:

```text
trusted:soft_attack_009
  missing B5 at 220ms and 350ms
  onsetActivation = 0.023964 / 0.020772
  frameActivation = 0.005827 / 0.006656

trusted:soft_attack_021
  missing B5 at 220ms and 350ms
  onsetActivation = 0.023964 / 0.020772
  frameActivation = 0.005827 / 0.006656

trusted:soft_attack_022
  missing G4 at 220ms and 350ms
  onsetActivation ~= 0.00079
  frameActivation ~= 0.991
```

### Verified no-retrigger false accepts

These probes were verified against source MIDI as having no same-pitch physical note-on inside the evidence window, so they are valid safety failures:

| Post | Probe | Pitch | Probe time | Nearest previous | Nearest next | Onset activation | Frame activation | Model peak |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 220 | `s03_long_held_note_without_retrigger_002:g1:probe400` | G5 | 45.1135 | 44.713542 | 58.950000 | 0.201410 | 0.979569 | 45.0535 |
| 350 | `s01_long_held_note_without_retrigger_001:g1:probe1000` | G3 | 16.3255 | 15.325521 | 17.207031 | 0.236345 | 0.989358 | 16.5155 |
| 350 | `s03_long_held_note_without_retrigger_002:g1:probe400` | G5 | 45.1135 | 44.713542 | 58.950000 | 0.247993 | 0.987933 | 45.0535 |
| 220 | `s02_pedal_sustain_tail_without_retrigger_002:g1:probe700` | A#3 | 29.9708 | 29.286458 | 35.118490 | 0.347323 | 0.951821 | 30.0408 |
| 350 | `s02_pedal_sustain_tail_without_retrigger_002:g1:probe700` | A#3 | 29.9708 | 29.286458 | 35.118490 | 0.509928 | 0.978427 | 30.0408 |
| 220 | `s02_pedal_sustain_tail_without_retrigger_002:g1:probe1000` | A#3 | 30.2708 | 29.286458 | 35.118490 | 0.595826 | 0.988557 | 30.0408 |
| 350 | `s02_pedal_sustain_tail_without_retrigger_002:g1:probe1000` | A#3 | 30.2708 | 29.286458 | 35.118490 | 0.588515 | 0.990610 | 30.0408 |

## Gates stopped after Development

Both post-context candidates failed the complete on-time Development gate. Therefore the following stages were correctly not run:

```text
Continuous offset gate: NOT RUN
STEP candidate interval: NOT RUN
Cross-mode agreement: NOT RUN
One-to-one onset reuse: NOT RUN
Calibration: NOT RUN
Browser: NOT RUN
```

## Final decision

```text
Development = FAIL
Calibration = NOT RUN
Browser = NOT RUN

ByteDance Shared Target Verifier = FAIL
```

Reason: the corrected full Development gate found valid hard failures for both post-attack context candidates: second same-note retrigger recall below threshold, soft attack recall below threshold, and verified no-retrigger false accepts.

Unexpected-note / microphone-extra parity remains:

```text
OUT OF SCOPE / NOT VERIFIED
```

Production microphone remains disabled after Phase 6D.
