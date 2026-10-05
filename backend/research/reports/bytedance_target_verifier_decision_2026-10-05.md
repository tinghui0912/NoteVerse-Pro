# ByteDance Shared Target Verifier Decision

- Verdict: `FAIL`
- Git HEAD: `905c9c138dd524d347b52fb42f19defae948fbcd`
- Frozen evaluation used: `false`
- Production state: STEP Mic remains `STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED`; Continuous Mic remains `CONTINUOUS_ANALYSIS_UNAVAILABLE`.

## Historical Scope Correction

The previous ByteDance Continuous `FAIL` applies to the 1.82s generic sliding-window transcription / trusted-region / one-owner architecture. It did not evaluate scheduled score-aware target verification.

## Harness Status

- Shared target-verifier harness: `backend/scripts/evaluate_bytedance_shared_target_verifier.py`
- Harness SHA256: `0e2c1a4bff282a84b4e866a0bb5135268bfbdb5e5aba3926ff98e43a648a8e58`
- `python -m py_compile`: `PASS`
- Smoke execution: `PASS`
- Development bounded matrix: `PASS`
- Smoke report: `backend/research/reports/bytedance_target_verifier_context_matrix_smoke_2026-10-05.json`
- Development bounded report: `backend/research/reports/bytedance_target_verifier_context_matrix_dev_bounded_2026-10-05.json`

## Phase 6 Gate Status

- 1.82s context: `EXECUTED_DEV_BOUNDED`
- 3s context: `EXECUTED_DEV_BOUNDED`
- 5s context: `EXECUTED_DEV_BOUNDED`
- 10s context: `EXECUTED_DEV_BOUNDED`
- 220ms future context: `EXECUTED_DEV_BOUNDED`
- 350ms future context: `EXECUTED_DEV_BOUNDED`
- Continuous timing-offset matrix: `EXECUTED_DEV_BOUNDED`
- STEP candidate-time robustness: `EXECUTED_DEV_BOUNDED`
- Cross-mode decision agreement: `SHARED_HARNESS`
- Browser WebGPU gate: `NOT_EXECUTED_AFTER_PYTORCH_QUALITY_FAIL`

## Evidence

The checkpoint is available at `models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth` with SHA256 `c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141`.

The Docker research container `noteverse-backend-dev-practice-quality-run-6abcabbb9028` executed the shared target-verifier harness over a bounded development matrix: max 2 cases per family, all 1.82s/3s/5s/10s contexts, both 220ms/350ms future contexts, all scheduled Continuous offsets, and all STEP candidate-time offsets.

Hard safety failures:

- STEP `long_held_note_without_retrigger`: false match rate `1.0` for every tested context/future combination.
- STEP `pedal_sustain_tail_without_retrigger`: false match rate `0.6` for every tested context/future combination.
- STEP `wrong_semitone`: false match rate `0.1` for every tested context/future combination.
- CONTINUOUS `correct_chord`: positive recall `0.363636` for every tested context/future combination.
- CONTINUOUS `long_held_note_without_retrigger`: false match rate `0.363636` for every tested context/future combination.

## Decision

`ByteDance Shared Target Verifier = FAIL`

The PyTorch quality gate fails before browser export or production integration. Production microphone remains disabled after this phase.
