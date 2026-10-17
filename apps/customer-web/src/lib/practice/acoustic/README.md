# Shared Practice Acoustic Foundation

This is the single active score-blind acoustic implementation. Both microphone
capabilities remain disabled. Future STEP bounded-attempt consumption is not
implemented and the historical STEP policy is not transferred to Robust.

## Ownership

- `model/`: exact Robust asset and output validation, one ORT 1.20.1 WebGPU
  session/Worker, transaction-local raw output interpretation and decoder A.
- `source/`: qualified 44.1k/48k FIR, PCM Worklet/credits, capture chronology,
  analysis-clone ownership, and mode-neutral infrastructure-loss facts.
- `runtime/`: source-only analysis regions, fixed real-context windows, target
  PCM ring, bounded sequential queue and immutable source observations.
- `continuous/`: external BEGIN/PAUSE/TERMINAL scheduling, source-to-performance
  projection, stable product observation IDs and exact terminal-T coverage.

The shared scheduler knows only absolute source samples and resampled target
samples. It has no score, target, performanceTime, BPM, cursor, STEP generation
or verdict. Continuous projection is the first place source observations gain
performance time. It synchronously feeds the existing unique product evaluator.
No model raw tensors survive the inference transaction or enter application state.
Future score-free extraction belongs adjacent to that one interpretation boundary,
not in a second model session for the same capture stream.

## Identity and Delivery

The shared asset is `practice-acoustic-robust-browser@v1`, served only by
`/model-assets/practice-acoustic-robust-browser-v1/access`. Browser download and
OPFS reads verify 98,689,283 bytes and SHA256
`4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3`.
The historical `models/continuous/...` OSS key is centralized storage identity
only; no duplicate object or model selector exists. FIR files live only under
`public/model-assets/practice-acoustic/`, with unchanged bytes and identities.
The authoritative model-family decoder primitive remains shared; the Original
ByteDance executable provider, loader and access endpoint are removed.

## Resources and Clock Isolation

Target PCM is 65,536 float32 samples (262,144 bytes). Source FIR ring is 512
bytes plus coefficients (35,284 or 244 bytes). At most four queued/active model
inputs retain 465,920 bytes; a transport/active copy is separately bounded.
The fifth ready window fails before allocation, without dropping ownership.
Worklet transport allows 32 unacknowledged blocks of at most 2,048 samples
(262,144 payload bytes). Diagnostics retain 32 compact metadata records and no
event arrays; 16KiB is a planning estimate, not a total JS/ORT/GPU heap bound.
At most four undrained source regions and eight Continuous scheduled boundaries
are allowed. There is no full-session PCM or publication-event retention.

One session-owned AudioContext remains the Continuous transport clock, capture
frame domain and metronome domain. Pause PCM is context-only. The projection
requires exact resume identity; it never moves transport. Normal publications
cover a half-open owned interval; only terminal real-tail drain produces the
empty exact-T product coverage handshake. Healthy-context analysis failure is
analysis-only; infrastructure facts are interpreted by the product controller.

Pre-refactor source is byte-archived with revision/blob/size/SHA provenance under
`backend/research/history/shared-acoustic-before-clean-break/`. It is never a
product import or fallback. Resource ceilings are not a UX latency SLO.
