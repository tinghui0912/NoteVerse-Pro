# XC2 R1 Bounded Finalization And Runtime

Original XC2 disposition unchanged; all replay is post-XC2 diagnostic only.

Bounded policy: BOUNDED_FINALIZATION_HAS_SAFETY_TRADEOFF
Runtime: ROBUST_PRODUCTION_LIKE_RUNTIME_NOT_SUSTAINABLE_IN_ALL_MEASURED_SESSIONS
Browser FIR: BAND_LIMITED_BROWSER_RUNTIME_QUALIFIED_FOR_FROZEN_PCM_RESEARCH_PATH_ONLY

The three critical false-accept counts did not increase, but this is not safe
policy equivalence. Baseline target agreement falls from 332/342 to 319/342;
MISSING detection falls from 40/40 to 31/40 and INCOMPLETE_CHORD from 40/40 to
36/40. Nine MISSING targets and four INCOMPLETE_CHORD targets become WRONG.
The bounded policy intentionally lets a closed WRONG claim preempt an open
future expected match. No production ledger was changed.

Implementation: `90eca11365f53fd096316793165a9040e4e227d9`.
Prospective policy/runtime freeze: `06dc5cc6e0af82f06e5f52e759ca29ee11689909`.
Starting HEAD: `16bed4591e4ee135578b3a283373517bdd15029b`.

## Baseline Latency

| Verdict | Original P95 ms | Bounded P95 ms | Delta ms |
|---|---:|---:|---:|
| CORRECT | 4747.72 | 2055.03 | -2692.69 |
| MISSING | 27333.24 | 1568.59 | -25764.65 |
| WRONG | 27095.01 | 1544.90 | -25550.11 |
| INCOMPLETE_CHORD | 26747.65 | 1643.00 | -25104.65 |
| EXTRA | 1756.75 | 1734.64 | -22.10 |

These original-protocol percentiles condition on correct classification. Counts
change under the bounded policy; the companion natural-residual/paired-latency
report also compares identical fixed targets regardless of predicted class.

## Semantic Horizon And Audit

Original same-pitch chains add up to 13,384.375ms beyond local deadlines;
all-group WRONG chains add up to 26,039.583ms. Five representative examples per
affected class are retained in the full report, including later-group legal
influence intervals and the first publication covering the local deadline.

Bounded strike closure is t+250ms. Group closure is last group strike+250ms.
EXTRA waits only directly eligible claimants: at most observation time+500ms+
group span (at most20ms in these frozen scenarios). The observed maximum is
509.375ms. All1,728,034 verdict witnesses are persisted as lossless compressed
JSON with per-file SHA receipts; frozen replay verifies the first eligible
publication and rejects nonlocal group horizons and mixed observation ownership.

## Physical Residual Versus Counterfactual EXTRA

Baseline EVALUATION has8 unmatched50ms acoustic residuals across five physical
clips, each counted once: 3.6364 residuals/minute over the common interiors.
This is not the scenario-weighted16.36% counterfactual EXTRA precision.
The184 false counterfactual target EXTRA instances fall into deterministic
descriptive buckets:124 outside expected assignment timing,60 unmatched acoustic
false onsets. These buckets are not verified causal diagnoses or natural user
error-prevalence estimates. Every configuration retains pitch and nearest
same-pitch/any-pitch physical-onset distance distributions.

## Repeated Runtime Interpretation

| Configuration | Frozen bounded-queue passes | Pooled warm processing P95 ms |
|---|---:|---:|
| LINEAR_A_600_220 | 9/9 | 581.42 |
| BAND_LIMITED_A_500_220 | 7/9 | 567.00 |
| BAND_LIMITED_A_600_170 | 9/9 | 586.80 |

The500ms failure includes a sustained case ending with2967.30ms queue delay,
depth7 and realtime factor0.8796, plus a transient-depth criterion failure.
Do not reinterpret a transient episode as proof of infinite-stream instability.
All sessions and spikes remain in the receipts. Global early/middle/late
configuration positions are balanced; within-clip order is not independently
randomized. These are three28-second clips with three repetitions, not a
long-duration/thermal or microphone-device qualification.

Old and new pure ORT service times also vary. This is not a contemporaneous
original-versus-new harness A/B, so all observed speed differences cannot be
attributed to removing research export. No hardware/thermal cause was measured.
Raw tensors are not exported on the new path. Compact result IPC, serialization,
file writes and hashing occur after capture and are measured separately.

Browser streaming FIR is sample-identical to pinned SciPy on24 deterministic
fixtures and three guarded real clips; chunked versus single-buffer is exact.
It needs up to28 real44.1kHz source samples of lookahead (0.634921ms).
This qualifies the frozen PCM research path, not AudioWorklet/device capture or
clock-drift behavior. LINEAR uses the existing canonical16kHz input assumption.

XC2 expected beats came from physical MIDI performance time at120BPM. Neither
the original result nor this replay qualifies natural early/late timing against
an independent score clock. A future natural-capture protocol is prepared only;
no such dataset was fabricated or captured here.

## All Evaluation Configurations

| Configuration | Agreement delta | Wrong false-correct delta | False match missing delta | False complete delta | Assignment changes |
|---|---:|---:|---:|---:|---:|
| LINEAR_A_600_220 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 471 |
| LINEAR_A_320_120 | -0.07895 | 0.00000 | 0.00000 | 0.00000 | 1398 |
| LINEAR_A_320_170 | -0.08187 | 0.00000 | 0.00000 | 0.00000 | 1338 |
| LINEAR_A_320_220 | -0.08187 | 0.00000 | 0.00000 | 0.00000 | 1278 |
| LINEAR_A_400_120 | -0.05556 | 0.00000 | 0.00000 | 0.00000 | 314 |
| LINEAR_A_400_170 | -0.05556 | 0.00000 | 0.00000 | 0.00000 | 254 |
| LINEAR_A_600_120 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 531 |
| LINEAR_A_600_170 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 471 |
| BAND_LIMITED_A_320_120 | -0.07895 | 0.00000 | 0.00000 | 0.00000 | 1278 |
| BAND_LIMITED_B_320_120 | -0.08187 | 0.00000 | 0.00000 | 0.00000 | 1219 |
| BAND_LIMITED_A_400_220 | -0.05556 | 0.00000 | 0.00000 | 0.00000 | 254 |
| BAND_LIMITED_B_400_220 | -0.04678 | 0.00000 | 0.00000 | 0.00000 | 191 |
| BAND_LIMITED_B_500_120 | -0.04678 | 0.00000 | 0.00000 | 0.00000 | 431 |
| BAND_LIMITED_A_500_170 | -0.04678 | 0.00000 | 0.00000 | 0.00000 | 491 |
| BAND_LIMITED_B_500_170 | -0.04678 | 0.00000 | 0.00000 | 0.00000 | 431 |
| BAND_LIMITED_A_500_220 | -0.04678 | 0.00000 | 0.00000 | 0.00000 | 551 |
| BAND_LIMITED_B_500_220 | -0.04678 | 0.00000 | 0.00000 | 0.00000 | 431 |
| BAND_LIMITED_A_600_120 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 471 |
| BAND_LIMITED_B_600_120 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 355 |
| BAND_LIMITED_A_600_170 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 471 |
| BAND_LIMITED_A_600_220 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 471 |
| BAND_LIMITED_B_600_220 | -0.03801 | 0.00000 | 0.00000 | 0.00000 | 355 |

## Runtime Breakdown

| Configuration | Warm product P95 | ORT P95 | Decoder P95 | Finalizer P95 | All9sessions bounded |
|---|---:|---:|---:|---:|---|
| LINEAR_A_600_220 | 581.42 | 580.64 | 0.20 | 0.30 | true |
| BAND_LIMITED_A_500_220 | 567.00 | 563.70 | 0.20 | 0.30 | false |
| BAND_LIMITED_A_600_170 | 586.80 | 580.66 | 0.20 | 0.20 | true |

No production winner. PRODUCT_LATENCY_SLO_NOT_YET_FROZEN. No UI/perceptual or natural early/late-score qualification. F5/R4/9G-B remain unchanged.
