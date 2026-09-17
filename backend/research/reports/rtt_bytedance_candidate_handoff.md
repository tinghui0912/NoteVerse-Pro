# RTT Candidate to ByteDance Bounded Verifier Handoff

Date: 2026-09-13

Status: research-only. No production code, frozen evaluation set, RTT threshold,
ByteDance threshold, browser export, PARpiano, incremental runtime, or full STEP
state machine was used.

## Question

Keep the model-level conclusion:

```text
RTT raw pitch verifier = STOP
RTT onset candidate generator = KEEP for research
```

Then test one handoff:

```text
RTT causal onset candidate
→ candidate-anchored ByteDance bounded verifier
```

This is candidate-handoff research, not a complete STEP progression benchmark.
The case clips do not contain full score-state history.

## Semantic Fixes

Two benchmark semantics issues were fixed.

First, held/pedal no-retrigger cases intentionally have one real physical-strike
target and a second expected group without a physical retrigger. The benchmark
must not synthesize:

```python
target_relative_seconds = tuple(1.0 for _ in expected_groups)
```

Second, sequential replay must not use all candidates from clip start to
establish the first STEP state. The clip pre-context is only acoustic context;
it is not full score-state history.

The corrected benchmark now uses:

```text
first advance = oracle-initialized state establishment
post-advance = sequential runtime-like replay
```

For same-note and no-retrigger cases, the first group uses only chronological
candidates compatible with the first real GT strike:

```text
-120ms <= candidate - first_GT <= +50ms
```

If no first MATCH is established, the case is excluded from post-advance safety
denominators and counted separately.

## Runtime Contract

RTT runtime input:

```text
sequential 16 kHz mono PCM
```

RTT runtime does not read:

```text
MIDI
target timestamp
expected pitch
case kind
future PCM
```

ByteDance verifier input:

```text
candidate timestamp
expected pitch set
PCM available through candidate +220ms
```

ByteDance verifier contract:

```text
max real lookback = 1000ms
target anchor = 1600ms
future = 220ms
onset >= 0.2
frame >= 0.2
local evidence = -50ms..+120ms
```

## Evaluation Semantics

### Oracle Target-Local Diagnostics

These remain only diagnostics:

```text
correct_strike
correct_chord
wrong_semitone
wrong_octave
missing_chord_tone
```

They use:

```text
candidate_delta = candidate_time - GT_strike_time
-120ms <= candidate_delta <= +50ms
```

They are not a full runtime false-advance benchmark.

### Same-Note Retrigger Sequential Replay

STEP1 is established from first-GT-compatible candidates only.

After STEP1 matches:

```text
step2_activation_time = first_candidate_time + 220ms
```

STEP2 consumes all later RTT candidates in chronological order. The first STEP2
MATCH is classified by:

```text
delta = candidate_time - second_GT

delta < -120ms       => PREMATURE_FALSE_ADVANCE
-120ms..+50ms        => LEGITIMATE_RETRIGGER_ADVANCE
delta > +50ms        => LATE_OR_STALE_MATCH
no MATCH             => NO_SECOND_MATCH
```

### Held/Pedal No-Retrigger Sequential Replay

STEP1 is established from first-GT-compatible candidates only.

Then from first decision time until clip end:

```text
every subsequent RTT candidate
→ ByteDance verifier(expected group 2)
```

Any second-group `MATCH` is a false second advance.

## Artifacts

- Script: `backend/scripts/evaluate_rtt_bytedance_candidate_handoff.py`
- Full JSON: `backend/data/work/datasets/maestro-v3.0.0/rtt_bytedance_candidate_handoff_dev_cal.json`
- Case sets: current inspected development + calibration sources only.

## Results

### Oracle Target-Local Handoff Diagnostics

| Target family | Compatible targets |
| --- | ---: |
| Correct single | 16 / 24 |
| Correct chord | 23 / 24 |
| Correct single + chord | 39 / 48 |
| Target-local negatives | 48 / 72 |

Candidate delta:

```text
count = 124
median = 0ms
p05 = -90ms
p95 = +10ms
min/max = -120ms / +30ms
```

### Target-Local Wrong-Note Safety

| Negative family | Clean false MATCH |
| --- | ---: |
| Wrong semitone | 0 / 19 |
| Wrong octave | 0 / 24 |
| Missing chord tone | 0 / 20 |
| All clean wrong-note negatives | 0 / 63 |

This only says the target-local counterfactual wrong-note verifier is clean. It
does not prove full runtime false-advance safety.

### Positive Recall

| Case family | MATCH / success |
| --- | ---: |
| Correct single | 13 / 24 |
| Correct chord | 20 / 24 |
| Same-note retrigger case accepted | 13 / 24 |
| Positive overall | 46 / 72 |

Same-note sequential breakdown:

| Metric | Result |
| --- | ---: |
| First advance established | 15 / 24 |
| Legitimate second advance | 10 / 24 |
| Premature false advance | 3 / 24 |
| Late / stale first MATCH | 0 / 24 |
| No second MATCH | 11 / 24 |

Premature examples:

```text
s06_same_note_retrigger_001: delta = -143.7ms
s07_same_note_retrigger_001: delta = -129.4ms
s08_same_note_retrigger_001: delta = -126.8ms
```

### Sequential No-Retrigger Safety

| Safety family | First advance established | Post-advance candidate | False second MATCH |
| --- | ---: | ---: | ---: |
| Long-held note without retrigger | 20 / 24 | 19 / 20 | 2 / 20 |
| Pedal sustain tail without retrigger | 16 / 24 | 16 / 16 | 3 / 16 |
| Combined eligible cases | 36 / 48 | 35 / 36 | 5 / 36 |

False second MATCH examples:

```text
long-held:
- s02_long_held_note_without_retrigger_002: +990ms after first decision
- s04_long_held_note_without_retrigger_002: +640ms

pedal-sustain:
- s02_pedal_sustain_tail_without_retrigger_002: +760ms
- s04_pedal_sustain_tail_without_retrigger_001: +890ms
- s06_pedal_sustain_tail_without_retrigger_001: +970ms
```

## Candidate Pressure

| Metric | Median | P95 |
| --- | ---: | ---: |
| RTT candidates / minute | 288.0 | 552.0 |
| ByteDance verifier calls / minute | 24.0 | 288.0 |
| Oracle target-local verifier calls / minute | 0.0 | 48.0 |
| Sequential first-advance verifier calls / minute | 0.0 | 24.0 |
| Sequential post-advance verifier calls / minute | 0.0 | 264.0 |
| Duplicate calls / physical strike | 0.304 | 1.2 |

## Runtime Reference

This is not a true incremental RTT runtime measurement. RTT was run on full case
clips for this research handoff; ByteDance was run per candidate.

| Metric | Median | P95 |
| --- | ---: | ---: |
| RTT full-clip compute | 161.3ms | 276.3ms |
| ByteDance candidate evidence compute | 143.6ms | 176.1ms |
| ByteDance candidate estimated candidate→decision | 363.6ms | 396.1ms |

## Conclusion

Corrected final conclusion:

```text
RTT onset candidate rule = STOP
RTT → ByteDance current handoff = STOP
```

Reason:

- Chord recall is promising: `20 / 24`.
- Target-local clean wrong-note false MATCH is excellent: `0 / 63`.
- But the sequential contract still fails:
  - first advance establishment is weak for retrigger: `15 / 24`;
  - legitimate same-note retrigger is only `10 / 24`;
  - premature same-note second advance occurs: `3 / 24`;
  - eligible no-retrigger false second advance remains non-zero: `5 / 36`.

This is not a threshold-tuning result. Under the corrected benchmark, the
current RTT candidate rule still does not provide a sufficiently safe
new-physical-strike candidate stream for STEP_BY_STEP.

## Next Direction

Do not tune RTT thresholds from this result.

Next:

```text
test PARpiano
```

or another causal piano frontend. The current RTT candidate rule should remain a
research reference only, not a selected runtime component.
