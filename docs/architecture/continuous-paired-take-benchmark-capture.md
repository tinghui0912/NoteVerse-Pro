# Continuous Paired-Take Benchmark Capture

Status: Phase 9F-A.2 research-only contract.

This document defines the source-of-truth boundary for future Continuous Practice v2 acoustic benchmark takes. It does not enable production microphone Practice and does not select a model winner.

## Unit Of Truth

The benchmark unit is one complete Continuous performance take:

- PracticeScoreArtifact identity
- PracticeTempoSelection and PracticeScope
- performanceTime = 0 boundary
- authoritative NATURAL or MANUAL completion
- microphone PCM from that exact take
- physical MIDI from that exact take
- explicit audio/MIDI/product-clock synchronization
- pre-roll and post-roll context
- immutable source hashes

ExpectedStrike[] is never a source-manifest field. It is derived by the shared product-domain Continuous practice contract resolver used by ContinuousEvaluationSession from PracticeScoreArtifact + PracticeTempoSelection + PracticeScope. The same resolver defines the deterministic NATURAL completion boundary. Physical MIDI records what the performer actually played, including wrong notes, missing notes, extras, repeated attacks, velocity, and pedal/control metadata. A perfectly correct physical MIDI performance may match the expected score exactly; provenance comes from verified score artifacts, not from forcing score/performance differences.

## Capture Harness Contract

A research browser harness may reuse lower-level Practice primitives, but it remains outside production Practice UI. It must support loading a PracticeScoreArtifact, configuring tempo/scope/start, selecting microphone and MIDI inputs, Begin Take, Manual Stop, Natural completion, optional pause/resume, source PCM sample counters, physical MIDI capture, and export of raw artifacts plus a ContinuousPairedTakeManifest v2.

No recognition model output is required during capture. The research-only route is `/research/continuous-capture` under the localized workspace app and is hidden behind the `RESEARCH_CAPTURE_HARNESS_ENABLED=1` server-side feature gate.

## Clock Mapping

Each uninterrupted running segment records half-open source sample ranges:

- `sourcePerformanceStartSampleBoundary`
- `sourcePerformanceEndSampleBoundary`
- `sourceContextTailEndSampleBoundary`
- `performanceStartMs`
- `performanceEndMs`

Context tail consumes source samples but never extends performance ownership, playhead, or completion. Pause/resume creates a new segment. Streaming analyzers reset state at the new segment.

## Context Policy

Development takes should capture at least 2000 ms of real pre-roll and 2000 ms of real post-roll where physically possible. If less context is recorded, the corpus take may remain valid, but candidate eligibility fails closed for analyzers that require more context. Synthetic silence is forbidden for product metrics.

## Synchronization

Timing metrics require one of:

- `SHARED_CAPTURE_CLOCK_VERIFIED`
- `CALIBRATED_OFFSET`

`INSUFFICIENT_SYNCHRONIZATION` blocks scoreability. Any calibrated offset must record method, offset, uncertainty, and calibration artifact identity. The offset convention is:

```text
performanceTimeMs = sourceMidiTimeMs + offsetMs
```

The calibration artifact bytes are verified before import. Candidate predictions must never define synchronization.

## Splits And Locking

Supported splits are DEVELOPMENT, CALIBRATION, and EVALUATION. Source audio hash, MIDI hash, and capture session identity must not leak across protected splits.

An EVALUATION manifest must carry an executable lock projection. Direct import of an unlocked EVALUATION manifest fails closed. The lock includes every truth-defining field: manifest identity/schema/split, verified policy identity, take IDs, capture session IDs, score artifact path/hash/schema, tempo selection, scope, completion, audio identity and metadata, performance origin, physical MIDI/capture identity, same-take binding, segment source/performance boundaries, synchronization provenance, family taxonomy, and evidence role. Phase 9F-A.2 does not populate or inspect EVALUATION for tuning.

## Public Proxy Datasets

Public datasets may test pipeline mechanics, but they do not replace native NoteVerse product-capture EVALUATION. Vienna 4x22 is the first preferred proxy because it has real piano audio, performance MIDI, MusicXML score, and alignment data under CC BY 4.0. Its role is `PUBLIC_EXTERNAL_PROXY_NOT_PRODUCT_CAPTURE`, not locked product evidence. MAESTRO/ASAP/nASAP are `KNOWN_TRAINING_OVERLAP_PROXY_ONLY` because the frozen candidates document MAESTRO-family exposure. SMD, MAPS, and GiantMIDI-Piano have separate proxy roles in `backend/research/policies/public_piano_dataset_registry_2026-10-08.json`.

## Development Matrix

Future DEVELOPMENT recordings should use short complete mini-etudes or score sections that cover:

- correct single notes
- wrong semitone
- wrong octave
- complete simultaneous chords
- missing chord tone
- extra wrong note
- soft and loud attacks
- same-pitch retrigger
- long held note without retrigger
- pedal sustain without false retrigger
- dense repeated notes
- fast adjacent pitches
- partial overlap
- quiet passages
- score gaps containing possible extras

Deliberate errors are capture instructions only. They do not change expected truth.

## Commands

Audit an empty or recorded manifest before candidate execution:

```bash
node backend/research/browser_runtime/audit_continuous_paired_take_manifest.mjs \
  --repo-root . \
  --manifest backend/research/fixtures/continuous_paired_take_manifest_v2_empty_development_2026-10-08.json \
  --output backend/research/reports/continuous_paired_take_manifest_v2_audit_2026-10-08.json
```

Bootstrap a public proxy dataset without downloading large archives by default:

```bash
node backend/research/browser_runtime/bootstrap_public_proxy_dataset.mjs \
  --repo-root . \
  --dataset vienna-4x22 \
  --output backend/research/reports/vienna_4x22_public_proxy_bootstrap_2026-10-08.json
```

The current fixture intentionally contains zero real takes and reports `CAPTURE_HARNESS_READY`, with `REAL_RECORDING_REQUIRED` as the practical next step. `CAPTURE_PIPELINE_READY` is reserved for a real or device-mocked export that the authoritative importer accepts end to end. Real product accuracy remains blocked until same-take microphone + physical-MIDI DEVELOPMENT takes are recorded.
