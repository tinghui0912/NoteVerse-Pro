# ByteDance Shared Target Verifier Decision v3

Generated: 2026-10-05

Harness git HEAD: `0f1f9207d0d13ec883dee4c3879bfe50cf9ebfc3`

Final decision:

```text
ByteDance Shared Target Verifier = FAIL
```

Production microphone remains disabled after Phase 6C:

- STEP: `STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED`
- CONTINUOUS: `CONTINUOUS_ANALYSIS_UNAVAILABLE`

Production behavior changed: NO.

## Gate Correctness

- STEP candidate direction fixed: COMPLETED
- Split isolation verified: COMPLETED
- Source SHA verified: COMPLETED
- Paired context cohort built: COMPLETED
- Future-context confound removed: NOT RUN
- Late Continuous geometry valid: COMPLETED
- Multiple no-retrigger probes: COMPLETED
- Cross-mode agreement measured: NOT RUN
- One-to-one onset reuse tested: NOT RUN
- Numeric gate evaluator executed: COMPLETED

The v3 policy uses directionally explicit STEP evidence bounds:

```text
stepEvidenceBeforeCandidateMs = 50
stepEvidenceAfterCandidateMs = 120
```

Therefore both diagnostic cases are included by construction:

```text
physical attack = 1000ms
candidate = 880ms  (-120) => search includes 1000ms
candidate = 1050ms (+50)  => search includes 1000ms
```

## Evidence Artifacts

- Policy: `backend/research/policies/bytedance_target_verifier_policy_v3_2026-10-05.json`
  - SHA256: `451e4c5df1b9bca3c27b76a178ae35d5e421321a262b709fbc4133006ab24864`
- Harness: `backend/scripts/evaluate_bytedance_shared_target_verifier_v3.py`
  - SHA256: `2de12bd94c48183d7a36818d86b8d2c419f8ccd87589dbf936fee537b8715875`
- Development targets: `backend/research/reports/bytedance_target_verifier_dev_targets_v3_2026-10-05.json`
  - SHA256: `96cef687ef33c0fd604da7b4ac062169fbf1a2686d6efb423767fc0fbf4fc08e`
- Calibration targets: `backend/research/reports/bytedance_target_verifier_calibration_targets_v3_2026-10-05.json`
  - SHA256: `175a1985d0fa70e340afc01fb09ab3f5e25b26bcf3885f0fe0e586d0096c32ce`
- Development Stage A context: `backend/research/reports/bytedance_target_verifier_dev_context_v3_2026-10-05.json`
  - SHA256: `cf1287e1027110869e3dbec33f8737c62ab0fc7d52f64cf3851224e3931e90eb`
- Development gate: `backend/research/reports/bytedance_target_verifier_dev_gate_v3_2026-10-05.json`
  - SHA256: `d3cd6257e936f85b4975ea9edf014ef838d9e855ebc022bf577ede4ffd168922`

## Targets

Development manifest:

- Target count: 421
- Unique source recordings: 8
- Source SHA verification: 8 verified, 0 missing hash
- Required families represented before paired-context filtering: yes

Calibration manifest:

- Target count: 195
- Unique source recordings: 4
- Source SHA verification: 4 verified, 0 missing hash
- Calibration was not evaluated because Development failed.

## Stage A: Paired Long-Context Development

Stage A compared total model input contexts with target offset 0 and model post-attack context 220ms:

```text
1820ms
3000ms
5000ms
10000ms
```

The paired cohort retained only target instances where all four contexts had sufficient real historical PCM and sufficient future PCM.

- Paired target count: 90
- Excluded for context reason: `INSUFFICIENT_REAL_CONTEXT = 331`
- Unique physical events: 42
- Unique source recordings: 8

Paired cohort family counts:

- `long_held_first_strike`: 11
- `long_held_no_retrigger`: 33
- `pedal_first_strike`: 4
- `pedal_sustain_no_retrigger`: 13
- `same_note_retrigger_first`: 7
- `same_note_retrigger_second`: 7
- `dense_repeated_pitch`: 1
- `fast_adjacent_pitch`: 4
- `soft_attack`: 3
- `loud_attack`: 7

The paired cohort had no `correct_single`, `complete_chord`, or `partial_overlapping_notes` samples after requiring all four long contexts.

| Context | OK rows | Actual median input | Actual min input | Diagnostic recall | Diagnostic false accept | Median forward | p95 forward |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.82s | 90 | 1820ms | 1820ms | 0.954545 | 0.065217 | 223.292ms | 252.921ms |
| 3.0s | 90 | 3000ms | 3000ms | 0.954545 | 0.065217 | 347.977ms | 418.309ms |
| 5.0s | 90 | 5000ms | 5000ms | 0.954545 | 0.065217 | 599.866ms | 665.867ms |
| 10.0s | 90 | 10000ms | 10000ms | 0.954545 | 0.065217 | 1223.395ms | 1364.298ms |

Aggregate recall is diagnostic only. It was not used to select a context.

## Development Gate

Development verdict:

```text
FAIL
```

No context passed the frozen hard gates.

Failing hard criteria, for every tested context:

- `correct_single.recall`: sample count 0 in the paired cohort.
- `complete_chord.recall`: sample count 0 in the paired cohort.
- `partial_overlapping_notes.recall`: sample count 0 in the paired cohort.
- `same_note_retrigger_second.recall`: 0.857143, threshold 0.9.
- `long_held_no_retrigger.falseAcceptCount`: 1, threshold 0.
- `pedal_sustain_no_retrigger.falseAcceptCount`: 2, threshold 0.

Because Stage A Development failed, the policy required stopping before Stage B, Stage C, Stage D, Calibration, and Browser gates.

## Not Run

- Stage B post-attack context comparison: NOT RUN
- Stage C Continuous timing-offset matrix: NOT RUN
- Stage D STEP candidate-error characterization: NOT RUN
- Cross-mode agreement: NOT RUN
- One-to-one onset reuse: NOT RUN
- Calibration: NOT RUN
- Browser WebGPU: NOT RUN

## Scope

This gate evaluates expected-strike target verification only:

```text
Did the expected pitch set occur near the expected/candidate target time?
```

Microphone extra-note detection parity is:

```text
OUT OF SCOPE / NOT VERIFIED
```

## Final Decision

```text
ByteDance Shared Target Verifier = FAIL
```

Production microphone remains disabled after Phase 6C.
