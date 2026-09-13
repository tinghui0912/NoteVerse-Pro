# Hybrid Bounded Verifier Latency

Date: 2026-09-13

Scope: research only. This pass does not modify production STEP progression,
does not refactor Matchmaker, does not connect real microphone input, does not
touch the frozen evaluation set, and does not tune the frozen `0.2 / 0.2`
ByteDance verifier.

This benchmark asks only:

```text
browser/client bounded clip
→ backend GPU verifier
→ response

Is end-to-end latency clearly better than browser WebGPU?
```

## Current Browser Model Conclusion

```text
current ByteDance note_model:
browser WebGPU numerically viable
but not selected as frontend production verifier
because local latency/model size are too high.

hybrid ByteDance:
online latency reference,
not selected architecture.

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
delay value used by the harness. The request-to-decision timer covers:

```text
synthetic uplink delay
+ HTTP request
+ backend work
+ synthetic downlink delay
+ response
```

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
| 0ms | 133.6ms | 160.1ms | 353.6ms | 380.1ms | 130.7ms |
| 25ms | 212.2ms | 246.1ms | 432.2ms | 466.1ms | 158.1ms |
| 50ms | 265.6ms | 307.2ms | 485.6ms | 527.2ms | 161.9ms |
| 100ms | 361.4ms | 402.1ms | 581.4ms | 622.1ms | 157.8ms |

Other measured details:

```text
request upload bytes: 116480
response bytes median: 742
client serialization median: ~0.02ms
backend deserialize median: sub-millisecond
backend evidence median: sub-millisecond
backend evaluation median: sub-millisecond
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

Hybrid remote verifier online reference:

```text
0ms one-way:
  estimated median = 353.6ms

25ms one-way:
  estimated median = 432.2ms

50ms one-way:
  estimated median = 485.6ms

100ms one-way:
  estimated median = 581.4ms
```

Even with `100ms` synthetic one-way delay, the hybrid path remains clearly
below the current browser WebGPU median budget. This makes it a useful online
latency reference, not an automatic production architecture choice.

## Architecture Boundary

Minimal interface boundary:

```text
StrikeVerifier
  verify(bounded_pcm, expected_pitches)
  → result + optional evidence
```

Possible remote implementation:

```text
RemoteBoundedVerifier
  browser captures bounded fixed-anchor clip
  backend GPU verifies
```

Possible local implementation:

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
conditions, after correcting the benchmark to include both synthetic uplink and
downlink delay inside request-to-decision timing.

Stop hybrid benchmarking here:

```text
hybrid ByteDance = online latency reference
not selected production architecture
```

The next inference-location experiment is Basic Pitch browser-local feasibility.
Hybrid ByteDance remains a reference line, while architecture selection is still
open.

The real product/research problem that remains outside this benchmark is still:

```text
causal physical-strike candidate generation
```
