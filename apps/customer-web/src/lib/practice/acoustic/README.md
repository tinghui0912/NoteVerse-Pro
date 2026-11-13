# Shared Practice Acoustic Foundation

STEP_BY_STEP and CONTINUOUS_PLAY use this browser-local, score-blind foundation
for microphone analysis. Browser capability detection checks runtime prerequisites;
physical-device recognition quality, permissions and latency require separate
product qualification.

## Modules

- `model/`: verified Robust asset loading, one configured ORT session/Worker,
  transaction-local raw output interpretation and piano decoding.
- `source/`: qualified FIR adapters, PCM Worklet/credits, capture chronology,
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

## Runtime identity and repository evidence

`contracts/practice/acoustic/runtime-contract.json` owns configured model bytes,
physical locator, runtime/provider, tensor descriptors, decoder configuration and
sample geometry. `scripts/generate_practice_acoustic_runtime.py` validates runtime
relationships, installed ORT version and exact FIR bytes. It projects browser runtime
configuration and Backend model-delivery facts; `--check` rejects projection drift.

`ACOUSTIC_ANALYSIS_IDENTITY.analysisIdentitySha256` is the SHA256 of canonical runtime
JSON, with recursively sorted object keys, unchanged array order and UTF-8 encoding.
It identifies the complete configured acoustic semantics. `identityName` is a readable
model asset/version label. Source-adapter identities hash only rate-specific rational
geometry, derived sample boundaries and coefficient asset facts, including its locator.
Decoder configuration does not enter an adapter identity. Runtime/model diagnostics use
`analysisIdentitySha256` for this configured analysis identity.

`apps/customer-web/tests/attestations/practice-acoustic/implementation-attestation.json`
declares selected repository source-byte provenance for engineering evidence.
`scripts/verify_practice_acoustic_implementation.py` independently checks exact paths,
UTF8 CRLF-to-LF normalization, byte sizes and SHA256. This repository evidence is not
an input to production projections or runtime/adapter identity. FIR product identity
belongs to runtime configuration; numerical source-adapter tests own algorithm evidence.

## Model Identity

The [canonical runtime contract](../../../../../../contracts/practice/acoustic/runtime-contract.json)
owns all exact model identity, byte size, SHA, runtime version, descriptor and decoder
configuration values. The stable `/model-assets/practice-acoustic/access` endpoint
returns the configured byte identity and a short-lived delivery URL. Download and
OPFS reads verify model byte size and SHA. Source adapters verify the configured
FIR bytes. The piano decoder consumes the generated configuration and
transaction-local raw output roles.

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
