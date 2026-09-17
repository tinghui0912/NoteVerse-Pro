# Onsets and Velocities Reproducibility and Causality Audit

Date: 2026-09-13

Scope:

- Candidate: `andres-fr/iamusica_training`
- Paper: `Onsets and Velocities: Affordable Real-Time Piano Transcription Using Convolutional Neural Networks`
- Goal: decide whether the released O&V artifact is reproducible enough, and whether the released model can serve as a strict causal physical-strike detector for NoteVerse STEP_BY_STEP microphone practice.
- This audit did not run NoteVerse dev/cal benchmarks, did not touch the frozen evaluation set, and did not modify production recognition code.

## Summary

O&V is reproducible for research:

- Public source repository exists.
- Public pretrained checkpoint exists in the training repository.
- The checkpoint loads into the released model architecture.
- The model is piano-specific and directly outputs 88-key onset logits plus velocity predictions.

But the released model is not a strict causal physical-strike detector for NoteVerse without changing the runtime contract and likely retraining or at least revalidating a different inference contract:

- The log-mel frontend uses centered STFT behavior through `torchaudio.transforms.MelSpectrogram` without overriding `center`, which introduces future-sample dependency at the frame level.
- The network uses symmetric temporal convolutions.
- The context-aware blocks use squeeze-excitation with `AdaptiveAvgPool2d(1)`, which pools over the entire supplied spectrogram window, making predictions depend on whole-window context.
- The official demo is explicitly a sliding-window detector with left and right context pads. Its recommended `OVIF=(100, 30, 100)` at roughly 42 frames per second implies 2.4 seconds left context, 720 ms detection body, and 2.4 seconds right context, for a total window around 5.52 seconds.
- Official onset decoding applies NMS over neighboring frames; this is smaller than the global/window issue, but still non-strictly causal if used as-is.

Conclusion:

```text
O&V strict causal strike detector = STOP
```

Keep only as:

```text
O&V bounded-context onset comparator = optional research-only
```

It should not become the next production causal detector candidate unless we intentionally accept a bounded-context/offline-style verifier role. That is not the current unresolved problem.

## Repository and Artifact Identity

Training repository:

```text
url: https://github.com/andres-fr/iamusica_training
local path: backend/data/work/onsets_velocities_research/iamusica_training
commit: 629ff11aceadf01ecc456b1c7f26a104f7e1e571
license: GPL-3.0
```

Demo repository:

```text
url: https://github.com/andres-fr/iamusica_demo
local path: backend/data/work/onsets_velocities_research/iamusica_demo
commit: 6f2067ef734a8fba0cdf4db2c106248d1e66ffe3
license: GPL-3.0
```

Pretrained checkpoint:

```text
path: backend/data/work/onsets_velocities_research/iamusica_training/assets/OnsetsAndVelocities_2023_03_04_09_53_53.289step=43500_f1=0.9675__0.9480.torch
size_bytes: 12,722,905
sha256: 90901ff8c7cb15c76a4da2f4aca643a10295c834ac9e549ee16097d4bbce642d
```

Checkpoint load result:

```text
model: ov_piano.models.ov.OnsetsAndVelocities
in_chans: 2
in_height: 229
out_height: 88
conv1x1head: (200, 200)
missing state_dict keys: 0
unexpected state_dict keys: 0
parameter_count: 3,127,168
```

The paper reports the same approximate scale: about 3.1M parameters, lower temporal resolution of 24 ms, and open-source code plus a real-time demo with a pretrained model.

## Official Model Contract

Audio and feature preprocessing:

```text
sample_rate: 16,000 Hz
STFT/window: 2048 samples
hop: 384 samples
hop duration: 24 ms
mel bins: 229
mel range: 50 Hz - 8000 Hz
```

Source evidence:

- `README.md` training config references `MAESTROv3_logmel_sr=16000_stft=2048w384h_mel=229(50-8000).h5`.
- `0.024` seconds is used as the MIDI roll quantization interval.
- `LogMelSpectrogram` constructs `torchaudio.transforms.MelSpectrogram(samplerate, winsize, hop_length=hopsize, ...)` without passing `center=False`.

Output tensors:

```text
onset stages: list of tensors shaped approximately (batch, 88, time - 1)
velocity tensor: (batch, 88, time - 1)
```

The evaluation wrapper pads the last onset stage and velocity output back to input length:

```python
probs = F.pad(torch.sigmoid(probs[-1]), (1, 0))
vels = F.pad(torch.sigmoid(vels), (1, 0))
```

Official decoder/evaluation:

```text
NMS pool size: 3
Gaussian decoder smoothing: stddev = 1, kernel size = 11
velocity read window: left = 1 frame, right = 1 frame
cross-validation thresholds searched: 0.70 to 0.80
reported best onset threshold: 0.74
reported onset shift: -0.01 seconds
demo default threshold: 0.75
```

The README-reported pretrained checkpoint result:

```text
ONSETS  t=0.74, shift=-0.01, F1=0.967756
ONS+VEL t=0.74, shift=-0.01, F1=0.945033
```

## Strict Causality Audit

### 1. Audio preprocessing is not strict causal as released

The training and demo frontends both call `MelSpectrogram` without explicitly disabling centered STFT. In the current torchaudio API, `center=True` is the default. With:

```text
window = 2048 samples
sample_rate = 16000 Hz
```

the STFT frame-level future dependency is approximately:

```text
2048 / 2 / 16000 = 64 ms
```

This future context is not the dominant blocker, but it already means the released preprocessing contract is not strict causal.

### 2. The convolutional stack is symmetric in time

The model uses multiple `Conv2d(..., padding=(..., temporal_pad))` layers. Examples:

- Stem convolution: kernel `(3, 3)`, padding `(1, 1)`.
- Context-aware onset stages: kernels such as `(1, 10)` with dilations `(1, 1)`, `(1, 2)`, `(1, 3)` and temporal paddings `(0, 4)`, `(0, 8)`, `(0, 12)`.
- Velocity stages use temporal kernels `(1, 11)` with temporal paddings `(0, 5)`, `(0, 10)`, `(0, 15)`.
- Collapsing stage uses `(out_bins, summary_width=3)` with temporal padding `(0, 1)`.

These are not masked/causal convolutions. Even before considering the SE modules, individual predictions use future frames through symmetric padding.

### 3. SE/global pooling makes the effective lookahead window-size dependent

`SELayer` performs:

```python
self.avg_pool = torch.nn.AdaptiveAvgPool2d(1)
...
y = self.avg_pool(x)
```

The comments explicitly describe this as per-channel global pooling. Since the input tensor shape is `(batch, channels, frequency, time)`, this squeeze step pools over the full time dimension of the supplied inference window.

Therefore, a prediction for an early frame can be affected by later frames anywhere in the same supplied window. This is stronger than a fixed small right-context dependency:

```text
released O&V lookahead = window-size dependent
```

This is the core reason O&V should not be treated as a strict causal detector without architecture changes and revalidation.

### 4. Official demo uses explicit right context

The demo README defines:

```text
OVIF = (100, 30, 100)
meaning: left pad, detection chunks, right pad
```

At approximately 42 frames per second:

```text
frame duration ~= 1 / 42 ~= 23.8 ms
left context  = 100 frames ~= 2.4 s
detection body = 30 frames ~= 0.72 s
right context = 100 frames ~= 2.4 s
total window = 230 frames ~= 5.52 s
```

The demo README states that detections are performed in consecutive detection blocks, with left and right pads used to avoid boundary artifacts, and that `(100, 30, 100)` gives about 5.5 seconds at roughly 42 fps.

This proves the released real-time demo is a bounded sliding-window system, not a strict causal frame-by-frame detector.

### 5. NMS and decoder add additional non-causal postprocessing

`Nms1d` uses `MaxPool1d(pool_ksize=3, stride=1, padding=1)`, so the local maximum decision for a frame uses neighboring frames. The official decoder also applies optional Gaussian smoothing over time before NMS and reads velocity with one frame of right padding.

These are secondary compared with the whole-window SE dependency, but they reinforce that the released decoder is not a strict causal strike detector.

## Product Relevance

O&V is still a strong research artifact:

- Piano-specific.
- 88-key onset probabilities.
- Velocity output.
- Public pretrained checkpoint.
- Small compared with full AMT models: 3,127,168 parameters and a 12.7 MB checkpoint.
- Designed for real-time-ish interactive demo use on commodity hardware.

But for NoteVerse STEP microphone progression, the unresolved component is:

```text
PCM-only causal physical-strike candidate generation
```

The released O&V model does not directly solve that under a strict causal contract. It can be useful as a bounded-context comparator, but not as the next production causal detector candidate.

License note:

```text
license = GPL-3.0
```

This is acceptable for local research audit. Any commercial product integration would require a separate license review.

## Decision

```text
PARpiano = NOT REPRODUCIBLE FOR THIS STUDY

O&V reproducibility:
  source + checkpoint available
  checkpoint loads
  research reproducibility = GO

O&V strict causal strike detector:
  whole-window/global temporal dependency
  official bounded sliding-window demo
  significant right context
  no released strict-causal inference contract
  = STOP
```

Next model candidate should not be O&V under the strict causal detector track. If we later want a bounded-context onset comparator, O&V can be revisited explicitly under that different product/research question.
