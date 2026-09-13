# Hybrid Bounded Verifier Latency

Date: 2026-09-13

Scope: research only. This pass does not modify production STEP progression,
does not refactor Matchmaker, does not connect real microphone input, does not
touch the frozen evaluation set, and does not tune the frozen `0.2 / 0.2`
ByteDance verifier.

This benchmark stops browser model feasibility work and asks only:

```text
browser/client bounded clip
→ backend GPU verifier
→ response

Is end-to-end latency clearly better than browser WebGPU?
```

## Current Architecture Conclusion

```text
current ByteDance note_model:
browser WebGPU numerically viable
but not selected as frontend production verifier
because local latency/model size are too high.

preferred near-term direction:
event-driven hybrid bounded verifier.

future smaller local verifier remains swappable.
```

## Contract

Transport-neutral request:

```text
16k mono PCM
float32 little-endian in this prototype
fixed-anchor tensor contract:
  target anchor = 1600ms
  future = 220ms
  samples = 29120

expected pitches
```

Response:

```text
MATCH | PARTIAL | MISMATCH | UNCERTAIN
optional diagnostic expected-pitch evidence
```

The response does not return MIDI and does not expose Matchmaker semantics.

## Prototype

Added:

```text
backend/scripts/evaluate_hybrid_bounded_verifier_latency.py
```

The prototype uses one simple transport:

```text
HTTP POST application/octet-stream
```

Request body:

```text
29120 float32 samples = 116480 bytes
```

Headers carry only expected pitches, target time, and the synthetic one-way
delay value used by the harness.

The backend path is:

```text
deserialize bounded PCM
→ existing ByteDance note_model direct GPU forward
→ frozen onset/frame evidence
→ frozen 0.2 / 0.2 evaluation
→ JSON response
```

Fixtures:

- `s01_correct_strike_001_g01`
- `s01_correct_chord_001_g01`
- `s01_same_note_retrigger_001_g02`

These are golden smoke fixtures, not cross-source model validation.

## Correctness Gate

All delays passed:

```text
decision agreement with frozen Python reference = 24 / 24
```

No verifier threshold was changed.

## Latency Results

Synthetic one-way delays:

```text
0ms, 25ms, 50ms, 100ms
```

Each bucket used 24 warm requests.

| One-way delay | Request→decision median | Request→decision p95 | Estimated strike→decision median | Estimated strike→decision p95 | Backend model median |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0ms | 116.9ms | 147.6ms | 336.9ms | 367.6ms | 114.0ms |
| 25ms | 164.5ms | 190.4ms | 384.5ms | 410.4ms | 136.8ms |
| 50ms | 202.7ms | 228.6ms | 422.7ms | 448.6ms | 149.3ms |
| 100ms | 250.5ms | 278.3ms | 470.5ms | 498.3ms | 147.5ms |

Other measured details:

```text
request upload bytes: 116480
response bytes median: 742
client serialization median: ~0.02ms
backend deserialize median: ~0.14ms at 0ms synthetic delay
backend evidence median: ~0.46ms at 0ms synthetic delay
backend evaluation median: ~0.01ms at 0ms synthetic delay
```

The estimated physical strike-to-decision budget is:

```text
220ms future wait
+ request→decision
```

## Comparison To Browser WebGPU

Previous browser WebGPU smoke benchmark:

```text
Chrome WebGPU:
  warm median = 608.3ms
  estimated strike→decision median = 828.3ms

Edge WebGPU:
  warm median = 767.3ms
  estimated strike→decision median = 987.3ms
```

Hybrid remote verifier:

```text
0ms one-way:
  estimated median = 336.9ms

25ms one-way:
  estimated median = 384.5ms

50ms one-way:
  estimated median = 422.7ms

100ms one-way:
  estimated median = 470.5ms
```

Even with `100ms` synthetic one-way delay, the hybrid path remains clearly
below the current browser WebGPU median budget.

## Architecture Boundary

Minimal interface boundary:

```text
StrikeVerifier
  verify(bounded_pcm, expected_pitches)
  → result + optional evidence
```

Near-term implementation:

```text
RemoteBoundedVerifier
  browser captures bounded fixed-anchor clip
  backend GPU verifies
```

Future swappable implementation:

```text
LocalBoundedVerifier
  smaller browser-local verifier
  same request/response semantics
```

STEP progression should depend on `StrikeVerifier` results, not transport or
provider details.

## Conclusion

The hybrid remote bounded verifier is clearly faster than the current browser
WebGPU ByteDance `note_model` path under the measured synthetic network
conditions.

Stop inference-location benchmarking here:

```text
near-term architecture = hybrid remote verifier
future optimization = smaller local verifier
```

The real remaining product/research problem is now:

```text
causal physical-strike candidate generation
```

