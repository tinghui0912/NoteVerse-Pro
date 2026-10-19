# V15 Robust A / V13 Paced Recognition Replay

`DEVELOPMENT_ONLY_NOT_QUALIFICATION`

STEP_ROBUST_A_V15_V13_PACED_REPLAY_COMPLETE_EXACT_SET_RECOGNITION_BLOCKER_REMAINS

Immutable V7 acoustic evidence only; actual V13 schema5 runtime recomputes all verdicts. No V9 verdicts used.

| Scenario | Rate | Actual sequence | Expected satisfied |
|---|---:|---|---|
| correct_single | 44100 | MATCH | True |
| correct_single | 48000 | MATCH | True |
| correct_chord | 44100 | MISMATCH | False |
| correct_chord | 48000 | MISMATCH | False |
| post_ready_repeat | 44100 | MISMATCH / MISMATCH | False |
| post_ready_repeat | 48000 | MISMATCH / MISMATCH | False |
| match_followed_by_next_target | 44100 | MISMATCH / MISMATCH | False |
| match_followed_by_next_target | 48000 | MISMATCH / MISMATCH | False |
| multiple_wrong_then_correct | 44100 | MISMATCH / MISMATCH / MATCH | True |
| multiple_wrong_then_correct | 48000 | MISMATCH / MISMATCH / MATCH | True |
| partial_then_full | 44100 | MISMATCH / MATCH | True |
| partial_then_full | 48000 | MISMATCH / MATCH | True |
| mismatch_same_target_rearm | 44100 | MISMATCH / MATCH | True |
| mismatch_same_target_rearm | 48000 | MISMATCH / MATCH | True |
| extra_chord_tone | 44100 | MISMATCH | True |
| extra_chord_tone | 48000 | MISMATCH | True |
| missing_chord_tone | 44100 | MISMATCH | True |
| missing_chord_tone | 48000 | MISMATCH | True |
| wrong_semitone | 44100 | MISMATCH | True |
| wrong_semitone | 48000 | MISMATCH | True |
| wrong_octave | 44100 | MISMATCH | True |
| wrong_octave | 48000 | MISMATCH | True |

## Key Diagnosis

Lifecycle isolation and atomic MATCH/rearm are independently tested product properties, not recognition repairs.
Old busy/late 0/0 denominators are excluded, never called PASS. Synthetic epochs are not microphone cooldown or device/UX latency.
Incorrect full acoustic sets remain MISMATCH under paced READY. Extras are not filtered; no target-conditioned repair is applied.

## Acoustic Witnesses

### correct_chord / 44100
Attempt 1: target ['G#3', 'E4']; observed [52, 56, 64, 68]; MISMATCH; rearm advancement=0.

### correct_chord / 48000
Attempt 1: target ['G#3', 'E4']; observed [52, 56, 64, 68]; MISMATCH; rearm advancement=0.

### post_ready_repeat / 44100
Attempt 1: target ['A#2', 'A#3']; observed [46, 58, 70, 74]; MISMATCH; rearm advancement=0.
Attempt 2: target ['A#2', 'A#3']; observed [46, 50, 58]; MISMATCH; rearm advancement=0.

### post_ready_repeat / 48000
Attempt 1: target ['A#2', 'A#3']; observed [46, 58, 70, 74]; MISMATCH; rearm advancement=0.
Attempt 2: target ['A#2', 'A#3']; observed [46, 50, 58]; MISMATCH; rearm advancement=0.

### match_followed_by_next_target / 44100
Attempt 1: target ['A#2', 'A#3']; observed [46, 58, 70, 74]; MISMATCH; rearm advancement=0.
Attempt 2: target ['A#2', 'A#3']; observed [46, 50, 58]; MISMATCH; rearm advancement=0.

### match_followed_by_next_target / 48000
Attempt 1: target ['A#2', 'A#3']; observed [46, 58, 70, 74]; MISMATCH; rearm advancement=0.
Attempt 2: target ['A#2', 'A#3']; observed [46, 50, 58]; MISMATCH; rearm advancement=0.

## Boundaries

V14 untouched, not resumed. Original excluded. Decoder A/B execution, model/session/Worker/PCM decode/fresh-holdout counts all zero.
Existing XC2 evidence does not justify decoder B specifically as an extra-pitch repair; not a universal quality claim and geometry differs.
Recommendation only: a new score-blind Robust readout candidate, with a new preregistered exposed-development protocol. No mechanism selected here.
Capabilities remain closed. No qualification or microphone integration. Actual GitHub evidence is separate; local tests are not CI.
