# RTT Causal Frontend Audit

Date: 2026-09-13

Scope: research only. Basic Pitch verifier research is stopped. This pass does
not modify production STEP progression, does not touch the frozen evaluation
set, does not tune thresholds, does not compare multiple new models, and does
not integrate any model into production.

Candidate:

```text
huispaty/rtt
Exploring System Adaptations for Minimum Latency Real-Time Piano Transcription
ISMIR 2025
```

Question:

```text
Can this model serve as NoteVerse's causal physical-strike + pitch evidence
frontend?
```

## Model Audit

Repository:

```text
https://github.com/huispaty/rtt
commit: b3197cfa538cc6f7698042b87ecee709223fc58e
license: Apache-2.0
```

Checkpoint:

```text
path: ckpts/CustomAMT.ckpt
size: 67,843,364 bytes
sha256: 901fc3da306fb4cffd96c55298d1439447e5a79f48cf436b4e76fde46db569f1
model parameters: 5,802,679
```

Input and timing:

```text
sample rate: 16 kHz
hop size: 160 samples
frame rate: 100 fps
frame step: 10ms
n_fft: 2048
fft_delay: 160 samples ~= 10ms
```

Architecture:

```text
log-mel frontend
causal convolution blocks
unidirectional GRUs
raw outputs:
  onset_output
  frame_output
  offset_output
  velocity_output
```

The model is designed to be causal in the acoustic stack. The repository's
provided inference script processes 3-second segments with overlap for
full-file evaluation, but the model itself can produce raw frame outputs
without MIDI postprocessing. This audit uses raw sigmoid onset/frame outputs.

Important caveat:

```text
README/inference.py loads float PCM with librosa
but CustomAMT.forward() divides input by int16 range.
```

Because this is ambiguous, this audit ran two input-scale sanity modes:

```text
official_float:
  follow repository inference.py literally

int16_range:
  multiply float PCM by 32768 before model.forward()
  so the model's division restores approximately [-1, 1]
```

This is not threshold tuning. It is an adapter-scale sanity check.

## Research Adapter

Added:

```text
backend/scripts/evaluate_rtt_causal_frontend.py
```

Runtime input:

```text
sequential 16 kHz mono PCM case clip
```

Runtime does not read:

```text
MIDI
target timestamp
expected pitch
actual pitch
case kind
future audio beyond the clip being processed
```

Offline scoring uses MIDI only after inference.

Raw outputs used:

```text
onset_output
frame_output
velocity_output
offset_output
```

No MIDI decoding is used for the STEP score. Candidate strikes are generated
from onset rising edges:

```text
per-pitch onset rising edge >= 0.5
same-frame active pitches grouped into one physical-strike candidate
```

The simple STEP evidence rule is:

```text
expected pitch accepted when:
  local onset >= 0.5
  local frame >= 0.3

local window:
  target -30ms .. target +80ms
```

These are the repository's default postprocessor thresholds, not a grid search.

## Results

Dataset:

```text
development + calibration
12 inspected source performances
192 cases
frozen evaluation set unused
```

### Physical Strike

| Metric | official_float | int16_range |
| --- | ---: | ---: |
| all GT strike recall | 859 / 3254 | 1240 / 3254 |
| target strike recall | 153 / 264 | 190 / 264 |
| single target recall | 13 / 24 | 22 / 24 |
| chord target recall | 6 / 24 | 9 / 24 |
| same-note retrigger target recall | 9 / 48 | 9 / 48 |
| unmatched candidates / minute median | 78.9 | 806.7 |
| duplicate candidates / strike median | 0.0 | 0.91 |
| anchor timing error median | -2.7ms | -1.5ms |
| emit delay p95 | 35.8ms | 29.6ms |

Interpretation:

```text
official_float:
  duplicate pressure is modest
  but target/chord/retrigger recall is too low

int16_range:
  single-note target recall improves
  but unmatched candidates explode
  duplicate pressure becomes unacceptable
  chord/retrigger remain poor
```

### STEP Pitch Evidence

| Metric | official_float | int16_range |
| --- | ---: | ---: |
| correct single | 4 / 24 | 5 / 24 |
| correct chord | 0 / 24 | 0 / 24 |
| retrigger | 0 / 24 | 0 / 24 |
| clean semitone false accept | 0 / 22 | 0 / 22 |
| clean octave false accept | 0 / 24 | 0 / 24 |
| clean missing-tone false accept | 0 / 23 | 0 / 23 |

Interpretation:

```text
RTT raw onset/frame evidence is very conservative under the fixed rule.
It keeps clean false accepts at zero, but positive recall is far below the
level needed for STEP verification.
```

### Latency

CPU measurement in the research container:

| Metric | official_float | int16_range |
| --- | ---: | ---: |
| compute median | 131.4ms | 143.5ms |
| compute p95 | 189.2ms | 221.6ms |
| estimated strike→decision median | 141.4ms | 153.5ms |
| estimated strike→decision p95 | 199.2ms | 231.6ms |

Estimated strike-to-decision here is:

```text
~10ms intrinsic / FFT delay
+ model compute
```

This is promising as a latency profile, but the evidence quality does not pass
the current STEP requirements.

## Decision

RTT is not selected as the next NoteVerse frontend candidate in its current
raw-output/default-threshold form.

```text
RTT as STEP verifier: STOP
RTT as direct CausalStrikeDetector: STOP for now
```

Reason:

```text
Strike side:
  official_float recall too low
  int16_range recall better but candidate pressure too high
  same-note retrigger remains weak in both modes

Pitch/STEP side:
  correct chord = 0 / 24
  retrigger = 0 / 24
  correct single <= 5 / 24
```

Per the stop rule:

```text
If strike and pitch are both insufficient:
  STOP RTT
  consider PARpiano / another lightweight causal piano AMT next
```

Do not continue RTT threshold search on the inspected dev+cal evidence unless a
separate reason emerges, such as an upstream-confirmed input-scaling bug or a
documented streaming adapter contract from the authors.
