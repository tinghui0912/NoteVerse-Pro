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

Target-local and oracle initialization semantics were tightened after the first pass:

```text
first-state establishment:
  event_time must be in first_GT -120ms .. first_GT +50ms

wrong-note target-local diagnostic:
  false MATCH counts only if expected-pitch event_time is in GT -120ms .. GT +50ms
```

This prevents later unrelated musical events from being mislabeled as wrong-note false advances.

The first formulation pass compared `current_max_frame` and `temporally_bound`.
The second pass compared `temporally_bound` with official ByteDance
regression-peak event semantics. The initial implementation selected only the
earliest official peak in a local window before consumed/window filtering; that
could let an old consumed peak hide a later legal peak. The current pass fixes
that by enumerating all official peaks and selecting the earliest eligible event
after applying consumed/window bounds:

```text
A. temporally_bound
   onset_peak >= 0.2
   AND frame_at_onset_peak >= 0.2

B. model_native_event_stream
   official RegressionPostProcessor-equivalent:
     threshold = 0.2
     monotonic local peak
     neighbour = 2
     regression onset shift
   AND frame_at_that_official_peak >= 0.2

Selection order:

```text
all official peaks
-> filter event_time > consumed_through_time
-> filter event_min_time <= event_time <= event_max_time
-> choose earliest eligible event
```
```

No threshold, cadence, or dedupe value was swept.

## Results

Aggregate dev + calibration:

| Metric | temporally_bound | model_native_event_stream |
| --- | ---: | ---: |
| correct single | 20 / 24 | 20 / 24 |
| correct chord | 18 / 24 | 10 / 24 |
| wrong semitone target-local false MATCH | 0 / 18 clean | 0 / 18 clean |
| wrong octave target-local false MATCH | 0 / 23 clean | 0 / 23 clean |
| missing chord target-local false MATCH | 0 / 20 clean | 0 / 20 clean |
| same-note first advance established | 20 / 24 | 20 / 24 |
| same-note legitimate second advance | 17 / 20 eligible | 17 / 20 eligible |
| same-note premature second advance | 0 / 20 eligible | 0 / 20 eligible |
| same-note missed retrigger | 3 / 20 eligible | 3 / 20 eligible |
| long-held first advance established | 20 / 24 | 13 / 24 |
| long-held false second advance | 2 / 20 eligible | 2 / 13 eligible |
| pedal-tail first advance established | 18 / 24 | 13 / 24 |
| pedal-tail false second advance | 4 / 18 eligible | 4 / 13 eligible |

Paired held/pedal comparison, only cases where both A and B established the first advance:

| Case family | Intersection | A false -> B safe | A safe -> B false | false under both | safe under both |
| --- | ---: | ---: | ---: | ---: | ---: |
| long-held | 13 | 0 | 0 | 2 | 11 |
| pedal-tail | 13 | 0 | 0 | 4 | 9 |

Pressure:

| Metric | Median | P95 |
| --- | ---: | ---: |
| inference calls / minute | 408.0 | 408.0 |
| deduplicated onset events / minute | 3612.0 | 7135.3 |
| duplicate detections / event | 1.19 | 1.33 |

Research compute on the current CUDA path:

| Metric | Median | P95 |
| --- | ---: | ---: |
| note_model forward per cadence window | 21.683ms | 23.280ms |
| target evidence end-to-end per cadence window | 21.814ms | 23.396ms |
| estimated event-to-decision | 241.814ms | 243.396ms |

The latency numbers are research harness measurements, not browser/product latency.

## Interpretation

Positive signal:

- Same-note retrigger is much more promising under rolling ByteDance than under previous handcrafted trigger attempts.
- After event dedupe and stricter first-state establishment, same-note premature second advance is zero in eligible cases.
- Legitimate same-note retrigger was detected in 17 / 20 eligible cases.
- Correct single recall is 20 / 24 under both formulations after event-stream enumeration.
- Correct chord is 18 / 24 under temporally_bound, but remains 10 / 24 under model_native_event_stream.
- Wrong-note target-local diagnostics are clean under the corrected definition:
  - semitone: 0 / 18 clean
  - octave: 0 / 23 clean
  - missing chord: 0 / 20 clean

Safety blockers:

- Held/sustain safety is not clean:
  - long-held false second advance: 2 / 20 eligible
  - pedal-tail false second advance: 4 / 18 eligible under temporally_bound
- Model-native event-stream semantics do not remove held/pedal false second advance in paired intersections:
  - long-held: 2 false under both / 13 intersection
  - pedal-tail: 4 false under both / 13 intersection
- Model-native event-stream enumeration fixes the old-peak masking bug for single-note recall, but chord recall remains substantially lower than temporally_bound.

The remaining failures are not mainly duplicate-window identity errors; the dedupe fix removed that class of false second advance. The remaining held/pedal blockers also are not mainly caused by stitching an onset from one time to a frame from another time.

They also are not an artifact of using a non-official local-window onset maximum, or of selecting an old consumed official peak before filtering. The official-equivalent model-native event stream still produces false second events in the same paired cases.

Example model-native false second event:

```text
long-held G#4:
  official_peak_frame_index = 158
  reg_onset[-2..+2] = [0.071522, 0.119984, 0.210683, 0.206954, 0.142783]
  onset_peak = 0.210683
  frame_at_peak = 0.994089
  regression shift = +0.479443 frames
```

Earlier temporally-bound examples:

```text
pedal tail:
  F#4 onset_peak=0.241885
  frame_at_onset_peak=0.858423

long held:
  G#4 onset_peak=0.210683
  frame_at_onset_peak=0.994089

pedal tail:
  F2 onset_peak=0.921713
  frame_at_onset_peak=0.990898
```

So the remaining issue is closer to:

```text
ByteDance onset head can still emit accepted expected-pitch onset evidence
on held/pedal/no-retrigger audio.
```

## Decision

The KEEP rule is not yet met:

```text
wrong-note target-local false MATCH ≈ 0  yes
held/pedal false second advance ≈ 0      no
same-note retrigger usable          mostly yes
single/chord recall acceptable      yes under temporally_bound,
                                    weaker for chords under model_native_event_stream
```

Therefore:

```text
ByteDance rolling STEP = FORMULATION_NOT_READY
```

Do not proceed to production integration, browser deployment, or cadence/compute-budget work based on this result. Also do not call ByteDance rolling STOP solely from this run: the corrected formulation substantially changed the wrong-note conclusion and showed that retrigger is viable. The remaining blocker is specifically held/pedal no-retrigger safety.

However, the latest comparison does answer the requested formulation question:

```text
Official model-native onset-event stream semantics do not solve held/pedal false second advance.
The issue is not just the previous local-window max formulation or the old-peak selection bug.
```

## Next

Do not resume generic strike-detector model search yet solely because this failed. The useful finding is narrower:

```text
ByteDance rolling raw onset semantics solve much of same-note retrigger,
and corrected target-local wrong-note diagnostics are clean,
but held/pedal no-retrigger safety is still not clean.
```

The next research question should be chosen explicitly:

1. If staying on ByteDance rolling: investigate held/pedal false second events only, using already existing raw outputs such as velocity/onset shape or other already available model heads. Do not sweep thresholds yet.
2. If comparing another bounded-context onset frontend: resume O&V only as a bounded-context onset comparator, not as strict causal.
3. If product latency/architecture becomes the priority: do not use this unsafe rolling policy as the product verifier.
