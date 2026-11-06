# Shared Practice Acoustic Foundation

STEP_BY_STEP and CONTINUOUS_PLAY use this browser-local, score-blind foundation
for microphone analysis. Browser capability detection checks runtime prerequisites;
physical-device recognition quality, permissions and latency require separate
product qualification.

## Modules

- `model/`: verified Robust asset loading, one ORT 1.20.1 WebGPU session/Worker,
  transaction-local raw output interpretation and decoder A.
- `source/`: 44.1k/48k FIR adapters, PCM Worklet/credits, capture chronology,
  analysis-clone ownership and infrastructure-loss facts.
- `runtime/`: source-domain analysis regions, real-context windows, bounded target
  PCM ring and sequential inference queue, immutable source observations.
- `continuous/`: BEGIN/PAUSE/TERMINAL scheduling, source-to-performance projection,
  stable product observation IDs and exact terminal-T coverage.

The foundation receives source samples and regions, without score targets, BPM,
playhead, verdicts or product lifecycle ownership. Continuous projection introduces
performance coordinates. STEP consumes source observations through its H50 assembler.
Raw tensors remain inside the inference transaction. The workspace engine reuses
one loaded ONNX session. Each capture stream receives an exclusive inference lease
with fresh identity, job sequencing, runtime regions and publication state.

`model/acoustic-engine.ts` owns cold model verification/load, WebGPU creation and
smoke inference during explicit Setup. Its Worker protocol is LOAD, BEGIN_SESSION,
INFER, END_SESSION and DISPOSE. Retiring a lease settles outstanding inference and
rejects its late result before another lease can begin. End/natural completion
release the lease; leaving the Practice layout releases ONNX and terminates Worker.
The session-local analysis runtime only sees `AcousticInferencePort` and has no
knowledge of workspace warmth, preferences or readiness.

The Continuous adapter imports only the publication type contract from
`continuous/domain/evaluation/evidence-types.ts`; it does not import the evaluator, score
targets or practice controllers. STEP assembles observations in `step/` and passes
attempt evidence to `step/domain/`. Neither mode's domain imports this foundation.

## Contract authority

`contracts/practice/acoustic/runtime-contract.json` owns the configured model bytes,
physical locator, runtime/provider, tensor descriptors, decoder configuration and
sample geometry. `contracts/practice/acoustic/evidence-attestation.json` owns selected
normalized implementation attestations and scoped references to raw FIR assets.
`scripts/generate_practice_acoustic_contract.py` validates both and produces the
immutable TS/Python projections consumed by delivery, inference, decoder and source
adapters. Its `--check` mode rejects drift. Analysis identity combines the canonical
runtime and evidence digests; per-rate identity additionally binds rational geometry
and exact coefficients. The package declaration matches the configured ORT version.

## Model Identity

The model is `practice-acoustic-robust-browser@v1`, served by
`/model-assets/practice-acoustic/access`. Download and OPFS reads
verify 98,689,283 bytes and SHA256
`4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3`.
FIR assets are under `public/model-assets/practice-acoustic/`.
`model/robust-piano-decoder.ts` consumes the transaction-local raw output contract
and explicit onset/frame thresholds .30/.05 from `contracts/practice/acoustic/runtime-contract.json`.

## Ownership, Clock and Bounds

The page Device Lease owns the root stream. Product controllers borrow it and own
attempt AudioContexts; analysis owns its clone.
Continuous uses the session AudioContext for transport, capture and metronome.
Pause PCM is context-only; resume preserves exact source/performance anchors.
Only terminal real-tail drain publishes the empty exact-T coverage handshake.
Healthy-context analysis failure stops analysis only; product controllers interpret
infrastructure-loss facts.

Source publications retain physical `sourceEventSample` and score-blind
`availabilityRuntimeMs`, supplied by `nowAvailabilityRuntimeMs`. Continuous injects
its established AudioContext session clock; `continuous/` projects that availability
to `availabilitySessionTimeMs`, separately from event/analysis Performance Time.
Pause and inference delay affect knowledge availability, not source event identity.
The 170ms model future context is lookahead, not event timestamp compensation.

Target PCM retains 65,536 float32 samples. At most four queued/active model inputs
retain 465,920 bytes, with a separately bounded transport/active copy. The fifth
ready input fails before allocation. Worklet transport permits 32 unacknowledged
blocks of at most 2,048 samples. At most four undrained source regions and eight
Continuous scheduled boundaries are allowed. Diagnostics retain 32 compact metadata
records without event arrays. Analysis memory is bounded independently of optional
user recording; these limits are not a total JS/ORT/GPU heap or UX latency guarantee.
