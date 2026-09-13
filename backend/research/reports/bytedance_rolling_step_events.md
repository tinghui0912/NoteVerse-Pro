# ByteDance Rolling STEP Event Replay

Date: 2026-09-14

Scope:

- Research-only.
- Dataset: inspected development + calibration MAESTRO public paired cases.
- Frozen evaluation set: not used.
- Production recognition/progression: not modified.
- Thresholds: unchanged frozen ByteDance policy, `onset >= 0.2` and `frame >= 0.2`.
- No RTT, O&V, external strike detector, threshold tuning, browser optimization, or production integration.

## Question

Can ByteDance raw onset/frame evidence drive STEP_BY_STEP advancement without an external strike timestamp?

Runtime-visible inputs in this experiment:

```text
16 kHz mono PCM
current expected pitch group
previous consumed-event boundary
```

Runtime-forbidden inputs:

```text
MIDI
GT strike timestamp
case kind
actual pitch
future GT information
```

MIDI and target timestamps are used only for offline scoring and first-target state establishment, because these clipped benchmark cases contain acoustic context but not complete score-state history.

## Script

```text
backend/scripts/evaluate_bytedance_rolling_step_events.py
```

Full JSON output:

```text
backend/data/work/datasets/maestro-v3.0.0/bytedance_rolling_step_events_dev_cal.json
```

The script uses a research-only batched implementation for speed: all cadence windows from the same case are forwarded together through the ByteDance note_model. This does not change the replay semantics; each row is still scored as a separate periodic inference window.

## Contract

ByteDance bounded window:

```text
max real lookback = 1000ms
target anchor = 1600ms
future = 220ms
local evidence = -50ms..+120ms
```

Periodic inference cadence:

```text
150ms
```

Reason:

```text
local evidence span = 170ms
150ms cadence overlaps adjacent windows
```

This is a research replay cadence, not a final product cadence.

Event semantics:

```text
pitch
absolute onset evidence time
onset score
frame score
```

STEP state:

```text
current_expected_group
consumed_through_time
```

Only onset events later than the consumed boundary can be used by the active STEP group.

An additional event-time dedupe margin is used:

```text
event_dedupe = 50ms
```

Reason:

The same physical onset can appear in adjacent overlapping inference windows with a small absolute-time drift, for example `1.00s` in one window and `1.01s` in the next. Without dedupe, that is incorrectly treated as a fresh onset and can create false second advances. This dedupe is not threshold tuning; it is the required event identity boundary for overlapping rolling windows.

## Results

Aggregate dev + calibration:

| Metric | Result |
| --- | ---: |
| correct single | 20 / 24 |
| correct chord | 20 / 24 |
| wrong semitone false advance | 2 / 18 clean |
| wrong octave false advance | 3 / 23 clean |
| missing chord false advance | 0 / 20 clean |
| same-note first advance established | 20 / 24 |
| same-note legitimate second advance | 17 / 20 eligible |
| same-note premature second advance | 0 / 20 eligible |
| same-note missed retrigger | 3 / 20 eligible |
| long-held first advance established | 20 / 24 |
| long-held false second advance | 2 / 20 eligible |
| pedal-tail first advance established | 20 / 24 |
| pedal-tail false second advance | 5 / 20 eligible |

Pressure:

| Metric | Median | P95 |
| --- | ---: | ---: |
| inference calls / minute | 408.0 | 408.0 |
| deduplicated onset events / minute | 3612.0 | 7135.3 |
| duplicate detections / event | 1.19 | 1.33 |

Research compute on the current CUDA path:

| Metric | Median | P95 |
| --- | ---: | ---: |
| note_model forward per cadence window | 14.145ms | 16.210ms |
| target evidence end-to-end per cadence window | 14.255ms | 16.337ms |
| estimated event-to-decision | 234.255ms | 236.337ms |

The latency numbers are research harness measurements, not browser/product latency.

## Interpretation

Positive signal:

- Same-note retrigger is much more promising under rolling ByteDance than under previous handcrafted trigger attempts.
- After adding event dedupe, same-note premature second advance fell to zero in eligible cases.
- Legitimate same-note retrigger was detected in 17 / 20 eligible cases.
- Correct single/chord recall remained 20 / 24 each.

Safety blockers:

- Wrong-note target-local safety is not clean:
  - semitone false advance: 2 / 18 clean
  - octave false advance: 3 / 23 clean
- Held/sustain safety is not clean:
  - long-held false second advance: 2 / 20 eligible
  - pedal-tail false second advance: 5 / 20 eligible
- Missing chord was safe in this run: 0 / 20 clean false advance.

The remaining failures are not mainly duplicate-window identity errors; the dedupe fix removed that class of false second advance. The remaining blockers look like real raw-evidence semantics:

```text
wrong pitch can still generate strong expected-pitch onset/frame evidence
old held/pedal audio can still produce later accepted onset evidence
```

## Decision

The stop rule was not met:

```text
wrong-note false advance ≈ 0        no
held/pedal false second advance ≈ 0 no
same-note retrigger usable          mostly yes
single/chord recall acceptable      yes
```

Therefore:

```text
ByteDance rolling STEP = STOP_OR_NEEDS_FURTHER_ANALYSIS
```

Do not proceed to production integration, browser deployment, or cadence/compute-budget work based on this result.

## Next

Do not resume generic strike-detector model search yet solely because this failed. The useful finding is narrower:

```text
ByteDance rolling raw onset semantics solve much of same-note retrigger,
but they are not safe enough by themselves for wrong-note and sustain/pedal cases.
```

The next research question should be chosen explicitly:

1. If staying on ByteDance rolling: investigate whether the remaining failures can be rejected by already-available raw evidence diagnostics without threshold sweeping.
2. If comparing another bounded-context onset frontend: resume O&V only as a bounded-context onset comparator, not as strict causal.
3. If product latency/architecture becomes the priority: do not use this unsafe rolling policy as the product verifier.
