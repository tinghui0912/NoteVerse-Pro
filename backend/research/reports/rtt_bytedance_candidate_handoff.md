# RTT Candidate to ByteDance Bounded Verifier Handoff

Date: 2026-09-13

Status: research-only. No production code, frozen evaluation set, RTT threshold,
ByteDance threshold, browser export, PARpiano, or full STEP state machine was
used.

## Question

Keep the current model-level conclusion:

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

## Important Semantic Fix

The previous handoff run incorrectly synthesized missing target timestamps:

```python
if len(target_relative_seconds) < len(expected_groups):
    target_relative_seconds = tuple(1.0 for _ in expected_groups)
```

That was invalid for `long_held_note_without_retrigger` and
`pedal_sustain_tail_without_retrigger`: those cases intentionally have one real
physical-strike target timestamp and a second expected group with no physical
retrigger. The benchmark now uses:

- target-local oracle diagnostics only for cases with real target timestamps;
- sequential replay for `same_note_retrigger`;
- sequential replay for held/pedal no-retrigger cases.

No synthetic second target timestamp is created.

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

For these case families:

```text
correct_strike
correct_chord
wrong_semitone
wrong_octave
missing_chord_tone
```

a compatible candidate is:

```text
candidate_delta = candidate_time - GT_strike_time
-120ms <= candidate_delta <= +50ms
```

These metrics are target-local diagnostics. They are not a full runtime
false-advance benchmark.

### Same-Note Retrigger Sequential Replay

The first expected group consumes chronological RTT candidates until ByteDance
produces `MATCH`.

Once the first group matches:

```text
step2_activation_time = first_candidate_time + 220ms
```

The second expected group can consume only:

```text
candidate_time >= step2_activation_time
```

The second GT strike timestamp is used only for post-hoc scoring.

### Held/Pedal No-Retrigger Sequential Replay

The first expected group consumes chronological RTT candidates until ByteDance
produces `MATCH`.

Then, from the first decision time until clip end:

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

Compatible candidate delta:

```text
count = 124
median = 0ms
p05 = -90ms
p95 = +10ms
min/max = -120ms / +30ms
```

### Combined RTT → ByteDance Positive Recall

| Case family | MATCH cases |
| --- | ---: |
| Correct single | 13 / 24 |
| Correct chord | 20 / 24 |
| Same-note retrigger | 15 / 24 |
| Positive overall | 48 / 72 |

Same-note retrigger sequential details:

| Metric | Result |
| --- | ---: |
| First advance success | 21 / 24 |
| Second retrigger advance success | 15 / 24 |
| Premature second advance before real retrigger | 1 / 24 |

### Target-Local Wrong-Note Safety

| Negative family | Clean false MATCH |
| --- | ---: |
| Wrong semitone | 0 / 19 |
| Wrong octave | 0 / 24 |
| Missing chord tone | 0 / 20 |
| All clean wrong-note negatives | 0 / 63 |

This only means target-local counterfactual wrong-note safety remains clean. It
does not prove full runtime false-advance safety.

### Sequential No-Retrigger Safety

| Safety family | Post-advance RTT candidate | False second MATCH |
| --- | ---: | ---: |
| Long-held note without retrigger | 20 / 24 | 3 / 24 |
| Pedal sustain tail without retrigger | 17 / 24 | 4 / 24 |
| Combined | 37 / 48 | 7 / 48 |

False second MATCH examples:

```text
long-held:
- s05_long_held_note_without_retrigger_001: +470ms after first decision
- s02_long_held_note_without_retrigger_002: +990ms
- s04_long_held_note_without_retrigger_002: +560ms

pedal-sustain:
- s02_pedal_sustain_tail_without_retrigger_002: +760ms
- s03_pedal_sustain_tail_without_retrigger_001: +280ms
- s04_pedal_sustain_tail_without_retrigger_001: +890ms
- s06_pedal_sustain_tail_without_retrigger_001: +260ms
```

## Candidate Pressure

| Metric | Median | P95 |
| --- | ---: | ---: |
| RTT candidates / minute | 288.0 | 552.0 |
| ByteDance verifier calls / minute | 48.0 | 405.6 |
| Oracle target-local verifier calls / minute | 0.0 | 48.0 |
| Sequential first-advance verifier calls / minute | 0.0 | 240.0 |
| Sequential post-advance verifier calls / minute | 0.0 | 264.0 |
| Duplicate calls / physical strike | 0.304 | 1.2 |

## Runtime Reference

This is not a true incremental RTT runtime measurement. RTT was run on full case
clips for this research handoff; ByteDance was run per candidate.

| Metric | Median | P95 |
| --- | ---: | ---: |
| RTT full-clip compute | 172.6ms | 271.5ms |
| ByteDance candidate evidence compute | 146.5ms | 180.6ms |
| ByteDance candidate estimated candidate→decision | 366.5ms | 400.6ms |

## Conclusion

The previous catastrophic no-retrigger conclusion is withdrawn because it was
based on a synthetic second target timestamp.

Corrected conclusion:

```text
RTT → ByteDance current handoff = still DO NOT KEEP as-is
```

Reason:

- Chord recall is promising: `20 / 24`.
- Target-local clean wrong-note false MATCH remains excellent: `0 / 63`.
- But sequential safety still fails:
  - no-retrigger false second advance: `7 / 48`
  - premature same-note retrigger second advance: `1 / 24`
- Same-note retrigger recall is also incomplete: `15 / 24`.

This is no longer a clear "RTT candidate rule is hopeless" result, but it is
not safe enough to move into production-style integration or chunk-state parity.

## Next Direction

Do not tune RTT thresholds from this result. The clean next step is either:

1. test another causal piano frontend such as PARpiano; or
2. design a candidate generator with an explicit new-physical-strike criterion
   before bounded verification.

The current RTT candidate rule remains a research reference, not a selected
runtime component.
