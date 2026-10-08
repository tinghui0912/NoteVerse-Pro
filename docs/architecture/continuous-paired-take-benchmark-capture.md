# Continuous Paired-Take Benchmark Capture

Status: Phase 9F-A research-only contract.

This document defines the source-of-truth boundary for future Continuous Practice v2 acoustic benchmark takes. It does not enable production microphone Practice and does not select a model winner.

## Unit Of Truth

The benchmark unit is one complete Continuous performance take:

- PracticeScoreArtifact identity
- configured BPM and scope
- performanceTime = 0 boundary
- authoritative NATURAL or MANUAL completion
- microphone PCM from that exact take
- physical MIDI from that exact take
- explicit audio/MIDI/product-clock synchronization
- pre-roll and post-roll context
- immutable source hashes

ExpectedStrike[] comes from PracticeScoreArtifact + BPM + scope + start. It must not be derived from physical MIDI. Physical MIDI records what the performer actually played, including wrong notes, missing notes, extras, repeated attacks, velocity, and pedal/control metadata.

## Capture Harness Contract

A research browser harness may reuse lower-level Practice primitives, but it remains outside production Practice UI. It must support loading a PracticeScoreArtifact, configuring BPM/scope/start, selecting microphone and MIDI inputs, Begin Take, Manual Stop, Natural completion, optional pause/resume, source PCM sample counters, physical MIDI capture, and export of raw artifacts plus a ContinuousPairedTakeManifest v1.

No recognition model output is required during capture.

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

`INSUFFICIENT_SYNCHRONIZATION` blocks scoreability. Any calibrated offset must record method, offset, uncertainty, and calibration artifact identity. Candidate predictions must never define synchronization.

## Splits And Locking

Supported splits are DEVELOPMENT, CALIBRATION, and EVALUATION. Source audio hash, MIDI hash, and capture session identity must not leak across protected splits.

An EVALUATION manifest must be lockable by canonical manifest SHA256, take IDs, audio/MIDI hashes, score artifact hashes, and policy version. Phase 9F-A does not populate or inspect EVALUATION for tuning.

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
  --manifest backend/research/fixtures/continuous_paired_take_manifest_v1_empty_development_2026-10-08.json \
  --output backend/research/reports/continuous_paired_take_manifest_v1_audit_2026-10-08.json
```

The current Phase 9F-A fixture intentionally contains zero real takes and reports `CAPTURE_PIPELINE_READY`.
