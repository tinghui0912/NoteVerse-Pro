# RTT Candidate to ByteDance Bounded Verifier Handoff

Date: 2026-09-13

Status: research-only. No production code, frozen evaluation set, RTT threshold,
ByteDance threshold, browser export, PARpiano, or full STEP state machine was
used.

## Question

Keep the current conclusion:

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

Candidate handoff compatibility:

```text
candidate_delta = candidate_time - GT_strike_time
compatible = -120ms <= candidate_delta <= +50ms
```

If multiple compatible candidates exist, all are verified in chronological
order. A target succeeds if at least one candidate produces `MATCH`.

## Artifacts

- Script: `backend/scripts/evaluate_rtt_bytedance_candidate_handoff.py`
- Full JSON: `backend/data/work/datasets/maestro-v3.0.0/rtt_bytedance_candidate_handoff_dev_cal.json`
- Case sets: current inspected development + calibration sources only.

## Results

### RTT Candidate Handoff Recall

| Target family | Compatible targets |
| --- | ---: |
| Correct single | 16 / 24 |
| Correct chord | 23 / 24 |
| Same-note retrigger targets | 38 / 48 |
| All positive targets | 77 / 96 |

Compatible candidate delta:

```text
count = 301
median = 0ms
p05 = -100ms
p95 = +20ms
min/max = -120ms / +30ms
```

### Combined RTT → ByteDance MATCH

| Case family | MATCH cases |
| --- | ---: |
| Correct single | 13 / 24 |
| Correct chord | 20 / 24 |
| Same-note retrigger | 13 / 24 |
| Positive overall | 46 / 72 |

### Wrong-Note Safety

| Negative family | Clean false MATCH |
| --- | ---: |
| Wrong semitone | 0 / 19 |
| Wrong octave | 0 / 24 |
| Missing chord tone | 0 / 20 |
| All clean wrong-note negatives | 0 / 63 |

The ByteDance verifier remains strong for counterfactual wrong-note safety under
this handoff contract.

### No-Retrigger Safety

This is the failing invariant.

| Safety family | No-strike target with RTT candidate | No-strike ByteDance false MATCH |
| --- | ---: | ---: |
| Long-held note without retrigger | 23 / 24 | 21 / 24 |
| Pedal sustain tail without retrigger | 20 / 24 | 17 / 24 |

The no-retrigger calculation counts only the second/no-new-strike expected
target group (`group_index >= expected_advances`). The first real physical
strike is not counted as a failure.

## Candidate Pressure

| Metric | Median | P95 |
| --- | ---: | ---: |
| RTT candidates / minute | 288.0 | 552.0 |
| ByteDance verifier calls / minute | 24.0 | 96.0 |
| Duplicate calls / physical strike | 0.304 | 1.2 |

## Runtime Reference

This is not a true incremental RTT runtime measurement. RTT was run on full case
clips for this research handoff; ByteDance was run per compatible candidate.

| Metric | Median | P95 |
| --- | ---: | ---: |
| RTT full-clip compute | 189.0ms | 286.1ms |
| ByteDance candidate evidence compute | 152.2ms | 194.3ms |
| ByteDance candidate estimated candidate→decision | 372.2ms | 414.3ms |

## Conclusion

```text
RTT → ByteDance handoff = DO NOT KEEP current rule
```

Reason:

- Positive recall improves over RTT raw pitch verification, especially chords.
- Clean wrong-note safety remains excellent: `0 / 63` clean false MATCH.
- But the no-retrigger product invariant fails badly:
  - long-held false MATCH: `21 / 24`
  - pedal-sustain false MATCH: `17 / 24`

The current RTT candidate rule fires on sustained/held/pedal-tail contexts, and
ByteDance anchored on those candidates often still sees enough expected-pitch
evidence to produce `MATCH`.

Therefore the current RTT candidate rule should not proceed to production-style
integration or incremental/chunk parity work. The blocker is not the wrong-note
pitch verifier; it is candidate generation for "new physical strike" versus old
sustain/tail.

## Next Direction

Do not threshold-sweep this RTT rule. The next useful step is to decide whether
to test another causal piano frontend such as PARpiano, or design a candidate
generator that explicitly distinguishes new physical strikes from sustained
pitch evidence before calling any bounded verifier.
