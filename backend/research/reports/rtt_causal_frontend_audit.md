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

## Important Correction

An earlier RTT pass incorrectly compared clip-relative model candidates against
absolute source timestamps. That made strike recall look much worse than it
really was.

This report supersedes that pass.

Corrected semantics:

```text
case WAV runtime timeline starts at 0

source_start = source_time_range_seconds[0]

target_relative =
  target_group_seconds - source_start

gt_note_on_relative =
  ground_truth_note_event.start_seconds - source_start
```

Physical-strike ground truth is restricted to note-on events inside the case
clip:

```text
source_start <= note.start_seconds < source_end
```

Sustained notes whose note-on occurred before the clip are not counted as new
physical strikes.

The duration denominator for unmatched candidates per minute is the real case
WAV duration.

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
without MIDI postprocessing.

Important upstream ambiguity:

```text
README/inference.py loads float PCM with librosa
but CustomAMT.forward() divides input by int16 range.
```

Therefore this audit keeps two input-scale sanity modes:

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

Primary raw candidate rule:

```text
per-pitch onset rising edge >= 0.5
same-frame active pitches grouped into one physical-strike candidate
```

Primary raw STEP rule:

```text
expected pitch accepted when:
  local onset >= 0.5
  local frame >= 0.3

local window:
  target -30ms .. target +80ms
```

These are the repository's default postprocessor thresholds, not a grid search.

Additional diagnostic:

```text
same raw outputs
→ official RTTPostProcessor
→ decoded note onset events
```

Decoded events are not treated as product runtime truth. They are only used to
check whether the current NoteVerse raw rule is misreading otherwise useful
model output.

## Corrected Results

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
| target strike recall | 209 / 264 | 234 / 264 |
| single target recall | 16 / 24 | 24 / 24 |
| chord target recall | 22 / 24 | 20 / 24 |
| same-note retrigger target recall | 37 / 48 | 34 / 48 |
| unmatched candidates / minute median | 24.0 | 864.0 |
| duplicate candidates / strike median | 0.09 | 1.54 |
| anchor timing error median | 3.5ms | 2.2ms |

Interpretation:

```text
official_float:
  physical-strike detection is genuinely promising
  chord and retrigger target recall are useful
  candidate pressure is moderate

int16_range:
  target recall is high
  but candidate pressure and duplicates are too high
```

The scale ambiguity matters. Based on candidate pressure, `official_float`
is the safer current interpretation for a strike-detector candidate.

### Raw STEP Rule

| Metric | official_float | int16_range |
| --- | ---: | ---: |
| correct single | 11 / 24 | 8 / 24 |
| correct chord | 2 / 24 | 1 / 24 |
| retrigger | 4 / 24 | 0 / 24 |
| clean semitone false accept | 0 / 22 | 2 / 22 |
| clean octave false accept | 0 / 24 | 0 / 24 |
| clean missing-tone false accept | 0 / 23 | 0 / 23 |

Interpretation:

```text
The current NoteVerse raw onset AND frame rule is too conservative and weak as
a STEP verifier. It preserves safety in official_float, but positive recall is
not acceptable.
```

### Official Postprocessor Diagnostic

| Metric | official_float | int16_range |
| --- | ---: | ---: |
| correct single | 11 / 24 | 8 / 24 |
| correct chord | 2 / 24 | 0 / 24 |
| retrigger | 5 / 24 | 0 / 24 |
| clean semitone false evidence | 1 / 22 | 1 / 22 |
| clean octave false evidence | 0 / 24 | 0 / 24 |
| clean missing-tone false evidence | 0 / 23 | 0 / 23 |

Interpretation:

```text
Official postprocessing does not rescue the pitch/STEP verifier result.
RTT is not currently a good STEP pitch verifier under default thresholds.
```

## Latency Wording

This pass runs the model over full case clips. Therefore it reports only:

```text
full-clip forward compute median / p95
```

It does not claim true incremental strike-to-decision latency.

CPU full-clip compute:

| Metric | official_float | int16_range |
| --- | ---: | ---: |
| compute median | 134.7ms | 118.0ms |
| compute p95 | 200.9ms | 201.2ms |

The intrinsic model timing is still promising:

```text
hop = 10ms
causal conv / unidirectional GRU
```

If RTT remains in play, the next benchmark must be an incremental/stateful
runtime benchmark, not another full-clip timing proxy.

## Decision

Updated conclusion:

```text
RTT as direct STEP pitch verifier: STOP
current NoteVerse raw RTT adapter: STOP
RTT as CausalStrikeDetector candidate: KEEP
```

Why KEEP as strike detector:

```text
official_float target strike recall = 209 / 264
official_float chord target recall = 22 / 24
official_float same-note retrigger target recall = 37 / 48
unmatched candidates/min median = 24.0
duplicate candidates/strike median = 0.09
```

Why STOP as verifier:

```text
raw correct chord = 2 / 24
raw retrigger = 4 / 24
official decoded correct chord = 2 / 24
official decoded retrigger = 5 / 24
```

Recommended next step:

```text
Do not move to PARpiano yet.

First test:
  RTT causal strike trigger
  → candidate-anchored bounded verifier

The bounded verifier can be ByteDance or another already-audited verifier, but
RTT should only provide candidate timing unless a new, evidence-backed pitch
adapter is designed later.
```

Do not tune RTT thresholds further on the already inspected dev+cal evidence
before defining the candidate-trigger handoff contract.
