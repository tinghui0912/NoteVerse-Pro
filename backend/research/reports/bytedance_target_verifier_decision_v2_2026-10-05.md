# ByteDance Shared Target Verifier Decision v2

Generated: 2026-10-05

Harness git HEAD: `34d898014834d9589400d46eed7f69a79e234fda`

Final decision:

```text
ByteDance Shared Target Verifier = INCONCLUSIVE
```

Production microphone remains disabled after Phase 6B:

- STEP: `STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED`
- CONTINUOUS: `CONTINUOUS_ANALYSIS_UNAVAILABLE`

## Phase 6 Decision Status

The previous bounded Phase 6 final decision is now:

```text
SUPERSEDED / INVALID FINAL GATE
```

The raw bounded report is preserved as historical evidence, but it is not valid as a final shared-target verifier gate.

Invalidation reasons:

- Case-level positive/negative classification polluted group-level semantics.
- No-retrigger cases synthesized missing target timestamps.
- Continuous `legalEarlyMs` / `legalLateMs` policy was not used by the verifier.
- Requested 3s / 5s / 10s context was not proven to be physically present.
- Required families were missing.
- Only max 2 cases per kind were run.
- Offset results were aggregated away.
- Numeric acceptance criteria were not frozen.

## Phase 6B Repair Status

- Old Phase 6 FAIL invalidated: COMPLETED
- Group-level GT classification removed: COMPLETED
- Instance-level `shouldMatch`: COMPLETED
- Synthetic target timestamp fallback removed: COMPLETED
- Continuous `legalEarlyMs` / `legalLateMs` actually used: COMPLETED
- Real context duration recorded: COMPLETED
- Future duration recorded: COMPLETED
- Required families represented in bounded samples: COMPLETED
- Numeric gates frozen before run: COMPLETED
- Per-offset results preserved: COMPLETED
- Cross-mode agreement actually measured: NOT COMPLETED
- Complete development gate: NOT COMPLETED
- Calibration gate: NOT COMPLETED
- Browser gate: NOT COMPLETED

## Evidence Artifacts

- Policy: `backend/research/policies/bytedance_target_verifier_policy_v2_2026-10-05.json`
  - SHA256: `6c5ba1633f4d4593d504682a9e8243b14e584deb3269b3cc3960da88242c613e`
- Harness: `backend/scripts/evaluate_bytedance_shared_target_verifier_v2.py`
  - SHA256: `716e3fd592d72b66640daf2d79049e2aa6cc9933e262a610a4fa813b15b63b0a`
- Smoke report: `backend/research/reports/bytedance_target_verifier_dev_v2_smoke_2026-10-05.json`
  - SHA256: `e4323ffea1e745b56bc76d94bd2eb87c29423ca47955e7238c9fd38109311646`
- Context/future bounded sample: `backend/research/reports/bytedance_target_verifier_dev_v2_context_sample_2026-10-05.json`
  - SHA256: `7e2f62ed0e6eb45433c7588ad20c16ac38c1617cd770ed8be24116c6b0ea5d29`
- Offset bounded sample: `backend/research/reports/bytedance_target_verifier_dev_v2_offset_sample_2026-10-05.json`
  - SHA256: `7b989e3f5d8575f04bc52822b63b097724f194d237e70e6b94f8f1350baf6ff5`

## Bounded Context Sample

The v2 context sample used 52 target instances, with all required families represented by four instances each:

`correct_single`, `correct_chord`, `same_note_retrigger`, `dense_repeated_pitch`, `fast_adjacent_pitch`, `partial_overlapping_notes`, `soft_attack`, `loud_attack`, `wrong_semitone`, `wrong_octave`, `missing_chord_tone`, `long_held_no_retrigger`, and `pedal_sustain_no_retrigger`.

| Requested context | OK rows | Actual median input | Actual min input | Recall | False accept | Median forward | p95 forward |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.82s | 110 | 1820ms | 1820ms | 0.939024 | 0.0 | 271.889ms | 482.104ms |
| 3.0s | 66 | 3000ms | 3000ms | 0.92 | 0.0 | 422.503ms | 957.772ms |
| 5.0s | 52 | 5000ms | 5000ms | 0.888889 | 0.0 | 685.373ms | 1706.301ms |
| 10.0s | 52 | 10000ms | 10000ms | 0.888889 | 0.0 | 1476.527ms | 3591.781ms |

| Requested future | OK rows | Actual median future | Actual min future |
| --- | ---: | ---: | ---: |
| 220ms | 138 | 220ms | 220ms |
| 350ms | 142 | 350ms | 350ms |

Rows with insufficient real context or future context are preserved in the raw reports and excluded from the quality metrics above.

## Bounded Offset Findings

These are bounded samples, not a final gate:

- Continuous 1.82s / 220ms showed late-offset weakness. At +200ms and +250ms, several positive families had reduced or zero recall, including `correct_chord`, `same_note_retrigger`, `partial_overlapping_notes`, `soft_attack`, and `loud_attack`.
- Continuous `dense_repeated_pitch` showed 0.666667 recall at -250ms, -200ms, and -150ms.
- STEP 1.82s / 220ms showed early candidate-time weakness. At -120ms and -80ms, several positive families had zero recall, including `correct_chord`, `same_note_retrigger`, `partial_overlapping_notes`, `soft_attack`, and `loud_attack`.
- No-retrigger verifier safety in the bounded sample was 0.0 false accept for long-held and pedal sustain probes in both STEP and Continuous rows.

## Why The Verdict Is Inconclusive

The corrected v2 harness fixes the main semantic errors and shows that the old Phase 6 FAIL cannot stand as a final gate. However, Phase 6B did not complete the full required gate:

- The complete development matrix was not executed.
- Calibration was not executed.
- Cross-mode agreement was not actually measured with equivalent STEP and Continuous request builders; current reports have `comparedCount = 0` where the policies differ.
- Browser WebGPU was not run because the corrected PyTorch development gate was not completed.

Therefore the only defensible Phase 6B decision is:

```text
ByteDance Shared Target Verifier = INCONCLUSIVE
```
