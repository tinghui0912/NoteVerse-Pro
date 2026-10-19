# V15 Recognition Diagnosis

`DEVELOPMENT_ONLY_NOT_QUALIFICATION`

`STEP_ROBUST_A_V15_V13_PACED_REPLAY_COMPLETE_EXACT_SET_RECOGNITION_BLOCKER_REMAINS`

This is metadata interpretation of the completed single replay, not another replay or scoring execution. All verdicts below were obtained from actual production V13 `StepPracticeRuntime`, schema 5 / `step-paced-attempt-v5`. V9 verdicts were not inputs.

## Correct Chord

Frozen physical truth and expected target: MIDI `[56,64]` (`G#3`, `E4`).

Both source rates preserve the complete sealed H50 set `[52,56,64,68]` (`E3`, `G#3`, `E4`, `G#4`). Both actual V13 verdicts are **MISMATCH**. The extra pitches were not filtered or collapsed.

| Rate | Sealed observation ID | Pitch | Confidence | Original source sample | Original source ms |
|---:|---|---|---:|---:|---:|
| 44100 | j-345e4955170302c450281935:r0:w5:p52:f70240 | E3 / 52 | 0.8632820248603821 | 3142125 | 71250 |
| 44100 | j-345e4955170302c450281935:r0:w5:p64:f70400 | E4 / 64 | 0.8283321261405945 | 3142566 | 71260 |
| 44100 | j-345e4955170302c450281935:r0:w5:p68:f70560 | G#4 / 68 | 0.7813975214958191 | 3143007 | 71270 |
| 44100 | j-345e4955170302c450281935:r0:w5:p56:f70720 | G#3 / 56 | 0.3733293116092682 | 3143448 | 71280 |
| 48000 | j-5c9651201c93bc9e4a5a8b9c:r0:w5:p52:f70240 | E3 / 52 | 0.8645728230476379 | 3420000 | 71250 |
| 48000 | j-5c9651201c93bc9e4a5a8b9c:r0:w5:p64:f70400 | E4 / 64 | 0.8231516480445862 | 3420480 | 71260 |
| 48000 | j-5c9651201c93bc9e4a5a8b9c:r0:w5:p68:f70560 | G#4 / 68 | 0.7818601727485657 | 3420960 | 71270 |
| 48000 | j-5c9651201c93bc9e4a5a8b9c:r0:w5:p56:f70720 | G#3 / 56 | 0.3733627498149872 | 3421440 | 71280 |

The source interval is `[71250,71300)` ms at both rates. All four observations belong to it. Synthetic SessionTime projection preserves their 10ms within-gesture spacing; it does not replace these original source coordinates.

`ROBUST_A_CORRECT_CHORD_EXACT_SET_BLOCKED`

## Legitimate Paced Repeat

Target `[46,58]` is a legitimate octave chord, not a duplicate pitch to collapse.

At **both** rates, each gesture had a separate deterministic READY epoch:

1. Attempt 1: observed `[46,58,70,74]`; **MISMATCH**; explicit **POST_VERDICT**; explicit rearm; same target remains at generation 1.
2. Attempt 2: observed `[46,50,58]`; **MISMATCH**; explicit **POST_VERDICT**; explicit rearm; same target remains at generation 1.

`ROBUST_A_POST_READY_REPEAT_EXACT_SET_BLOCKED`

This is an exact-set recognition failure, not a failure to give gesture 2 a READY opportunity.

## Next Target Sequence

For `match_followed_by_next_target`, both rates use the same two frozen target sets `[46,58]`, `[46,58]`. Actual attempts are MISMATCH / MISMATCH. Both enter POST_VERDICT and explicitly rearm, but neither rearm advances generation: the prerequisite MATCH never happened. V15 does not fabricate target 2.

`NEXT_TARGET_SEQUENCE_BLOCKED_BY_FIRST_ATTEMPT_RECOGNITION`

The actual V13 advancement transition is independently exercised by the MATCH in correct_single and by the final MATCH of multiple_wrong_then_correct / partial_then_full / mismatch_same_target_rearm. CompleteAttempt retains the target; rearm commits advancement.

## Remaining Regressions

At both rates:

- correct_single: MATCH.
- multiple_wrong_then_correct: MISMATCH / MISMATCH / MATCH.
- partial_then_full: MISMATCH / MATCH.
- mismatch_same_target_rearm: MISMATCH / MATCH; no evidence accumulation across epochs.
- extra_chord_tone, missing_chord_tone, wrong_semitone, wrong_octave: all MISMATCH.

22 scenario-rate cells / 34 attempts were replayed once. 16 cells satisfy their frozen expected sequences; six recognition cells do not. Eight negative exact-set cells all reject MATCH. No unsupported MATCH was observed in these replay cells. This is not a global safety or physical-causality qualification.

## Lifecycle Versus Recognition

`V13_NON_READY_INPUT_ISOLATION`: local deterministic product tests PASS independently. CAPTURING outside the bounded gesture, ANALYZING, POST_VERDICT, late retired timestamps, exact watermark equality and stale target identities cannot open/rebind a new attempt.

The old busy/late failures were missing actual causal denominators, not observed dangerous events. V12/V13 reframe the intended product as paced interaction; V15 deliberately supplies synthetic READY epochs. It does **not** retroactively prove the old physical busy/late scenarios safe, nor measure a shipping microphone retirement policy.

`OLD_LIFECYCLE_CAUSAL_DENOMINATORS_NOT_APPLICABLE_TO_PACED_RECOGNITION_REPLAY`

Old 0/0 is excluded, never PASS. The three two-rate recognition blockers remain despite valid paced READY opportunities.

## Decoder B And Next Direction

`decoder-b-decision.json` preserves all four exact historical A/B metric rows. Old 600/220 geometry differs from current 600/170. The evidence does not establish B as an extra-pitch repair, and its onset proposal projection lacks A's frame-support suppression gate. This is not a universal quality ordering.

`DECODER_B_NEW_EXECUTION_NOT_JUSTIFIED_BY_EXISTING_EXTRA_PITCH_EVIDENCE`

Recommendation only: `NEW_SCORE_BLIND_ROBUST_READOUT_CANDIDATE_REQUIRED`. A future candidate must keep the shared Robust model/asset, Worker/session topology and raw onset/frame tensors; accept no target/score input; and improve polyphonic/octave exact-set precision without discarding legitimate chord/octave pitches. No mechanism, threshold, model candidate or survivor is selected here.

## Non-Execution And Verification

- V14 unchanged and not resumed; Original fully excluded; decoder B unexecuted.
- Neural, model/session/Worker, decoder A/B, PCM decode, warmup, unknown-run and fresh-holdout counters are all zero.
- Production unchanged; V3-V14 historical raw checkout hashes unchanged at closure; original V7 output/seal and V8 seal exact identities preserved.
- Local product tests: 315/315 across 30 files; replay tests: 24/24; research/app TypeScript checks PASS.
- ESLint: app 0 errors / 1 existing prefer-const warning; V15 tooling 0 errors / 0 warnings. jsdom emitted eight pause and eight load not-implemented notices. Two pre-freeze tooling/test-fixture failures are preserved, not hidden.
- Git warned that new LF files may be checked out as CRLF later under existing configuration. No historical bytes were normalized or changed. Frozen V15 raw hashes are verified fail-closed in the current checkout.
- Local tests are not GitHub CI. Actual GitHub evidence is in the remote receipt; empty pending evidence is NOT CI PASS.

No new decoder/tuning, microphone cooldown, detector, qualification, fresh holdout or microphone integration. Capabilities stay Continuous `MODEL_NOT_VALIDATED`, STEP `ATTEMPT_ANALYZER_NOT_VALIDATED`, productionMicrophone=false, D4=false.

STOP for independent audit.
