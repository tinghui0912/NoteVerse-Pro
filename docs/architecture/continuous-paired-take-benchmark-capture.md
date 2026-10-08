# Continuous Paired-Take Benchmark Capture

Status: Phase 9F-B research-only corpus/import contract.

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

## Public Proxy Benchmark Direction

NoteVerse no longer maintains a custom research microphone/MIDI capture frontend for the immediate frozen-candidate comparison. ContinuousPairedTakeManifest v2 remains the source-of-truth schema for native future takes, but Phase 9F-B uses public proxy data first.

Public comparison evidence is split into two layers:

- `PRIMARY_FIXED_GRID_PROXY`: public audio/performance-MIDI/score material whose provenance proves same-take audio/MIDI, independent score truth, and an intrinsic fixed-tempo grid.
- `SECONDARY_HUMAN_FIXED_BPM_PROXY`: Vienna 4x22-style human performances where a local fixed-BPM proxy is fitted from score-performance alignment before candidate inference.

Both layers remain diagnostic public evidence. They do not become official locked product EVALUATION.

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

Public datasets may test diagnostic product feedback accuracy, but they do not replace native NoteVerse product-capture EVALUATION. Vienna 4x22 is the required secondary human proxy because it has real piano audio, performance MIDI, MusicXML score, and alignment data under CC BY 4.0. Its role is `PUBLIC_EXTERNAL_PROXY_NOT_PRODUCT_CAPTURE`, not locked product evidence. MAPS may enter `PRIMARY_FIXED_GRID_PROXY` only after the exact selected subset proves fixed-grid score/MIDI/audio provenance. MAESTRO/ASAP/nASAP are excluded from winner evidence because the frozen candidates document MAESTRO-family exposure.

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

The current native paired-take fixture intentionally contains zero real native takes and reports `CORPUS_SCHEMA_READY`. Public proxy acquisition/comparison is driven by:

```bash
node backend/research/browser_runtime/run_public_fixed_bpm_proxy_benchmark.mjs \
  --repo-root . \
  --output backend/research/reports/public_fixed_bpm_proxy_phase9f_b_2026-10-08.json
```

The public proxy runner must not assign official product rank or production readiness.
