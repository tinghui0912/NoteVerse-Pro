# ByteDance Shared Target Verifier Decision

- Verdict: `INCONCLUSIVE`
- Git HEAD: `fbf0ec9deea362fa563ee551d5d3e5cffb4b4545`
- Frozen evaluation used: `false`
- Production state: STEP Mic remains `STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED`; Continuous Mic remains `CONTINUOUS_ANALYSIS_UNAVAILABLE`.

## Historical Scope Correction

The previous ByteDance Continuous `FAIL` applies to the 1.82s generic sliding-window transcription / trusted-region / one-owner architecture. It did not evaluate scheduled score-aware target verification.

## Harness Status

- Shared target-verifier harness: `backend/scripts/evaluate_bytedance_shared_target_verifier.py`
- Harness SHA256: `f5a283999b7fc0b91ad96d5f978c4e95d4e56edc58e27bf72c8249bde10bfe86`
- `python -m py_compile`: `PASS`
- Smoke execution: `BLOCKED`
- Blocker report: `backend/research/reports/bytedance_target_verifier_context_matrix_smoke_blocked_2026-10-05.json`

## Phase 6 Gate Status

- 1.82s context: `NOT_EXECUTED`
- 3s context: `NOT_EXECUTED`
- 5s context: `NOT_EXECUTED`
- 10s context: `NOT_EXECUTED`
- 220ms future context: `NOT_EXECUTED`
- 350ms future context: `NOT_EXECUTED`
- Continuous timing-offset matrix: `NOT_EXECUTED`
- STEP candidate-time robustness: `NOT_EXECUTED`
- Cross-mode decision agreement: `NOT_EXECUTED`
- Browser WebGPU gate: `NOT_EXECUTED`

## Blockers

The checkpoint is available at `models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth` with SHA256 `c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141`.

The missing item is not the model file and no longer the harness itself. The harness now exists, but the default Python interpreter in this workspace lacks the research dependencies required to execute it:

```text
ModuleNotFoundError: No module named 'numpy'
```

Therefore the required 1.82s/3s/5s/10s context matrix, 220ms/350ms future comparison, score-scheduled timing-offset matrix, and cross-mode agreement report remain unexecuted.

## Decision

`ByteDance Shared Target Verifier = INCONCLUSIVE`

This is a research execution blocker, not a PASS and not a model-quality FAIL. Production microphone remains disabled after this phase.
