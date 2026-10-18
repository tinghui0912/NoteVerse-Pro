# H50 Batik External Truth Discovery

Disposition:
`STEP_WAITING_H50_EXTERNAL_TRUTH_TOPOLOGY_COMPLETE_AUDIO_ACQUISITION_NOT_STARTED`.

Combined status: `TRUTH_TOPOLOGY_COMPLETE_AUDIO_SOURCE_NOT_ACQUIRED`.
This is **not** PRIMARY QUALIFIED, H50 QUALIFIED, acoustic safety, or microphone
product integration. All counts below are **TRUTH METADATA OPPORTUNITIES**,
not READY PASS, BUSY PASS, or ACOUSTIC PASS.

## Governance Correction

Starting remote HEAD: `d240ea220d900d805d17e4731ec602d1e914efd6`.
Local/remote/merge-base matched; ahead/behind 0/0. The v3 historical disposition
and its reported 25 candidates are unchanged. Independent repository governance
inspection excludes the MAESTRO item from primary qualification: its license
allows noncommercial research, but its authorized repository purpose is
development/adapter/parity/debugging only and it has known training-domain overlap.
The corrected recording-level engineering truth baseline is **24 Vienna** items.

The exact v3 selector/pair/scorer dependencies remain byte-identical. No timing,
adjacency, sustain, normalization, H, or scoring rule was changed.

| Vienna-only family | Opportunities |
| --- | ---: |
| correct_single | 8 |
| correct_chord | 17 |
| same_pitch_sustain | 0 |
| same_chord_sustain | 1 |
| single_busy_retrigger | 0 |
| chord_busy_retrigger | 2 |
| post_ready_repeat | 0 |
| multiple_wrong_then_correct | 0 |
| partial_then_full | 0 |

## Batik Provenance And History

Repository: `pymatchmaker/matchmaker-benchmark-data`, `main` commit
`fd1c78749b08182e8c078993fcf0645cd4a0a22e`.
The pinned publisher metadata binds 36 performance MIDI files to JKU Disklavier
replay recordings using Roland Batik's human performance timing/dynamics, not
the commercial recording. License: CC BY-NC-SA 4.0. Attribution: Hu and Widmer,
*The Batik-plays-Mozart Corpus: Linking Performance to Score to Musicological
Annotations*, ISMIR 2023; the benchmark attribution documents the JKU recordings.
Derived truth manifests retain the noncommercial/share-alike data scope; this
does not relicense product software or establish commercial qualification.

Metadata, license/attribution and all 36 MIDI SHA256 identities are recorded in
`batik-byte-manifest.json`. Only metadata and MIDI bytes were fetched. Audio
objects were inspected as Git tree metadata only; their byte SHA256 and PCM
identities remain unknown.

The active Robust lineage is bound through its exact ONNX and checkpoint hashes
to the inspected upstream family. ByteDance's pinned upstream declaration cites
MAESTRO v2.0.0. Batik is only
`NO_DOCUMENTED_TRAINING_OVERLAP_IN_INSPECTED_UPSTREAM_DECLARATION`, not proven
absent from all training.

History auditing covered **1,150 reachable commits, 10,688 historical blobs and
4,829 current project files**, including deleted/renamed historical evidence.
Only identity tokens, paths and hashes were returned, never model values for
selection. All 59 historical and 459 current literal `k331_1` hits were
individually resolved to the different Vienna work-label prefix
`Mozart_K331_1st-mov`. None matched the complete Batik recording ID, MIDI hash,
audio object identity, dataset identity or exact audio filename.
See `history-probe.json` and `history-identity-review.json`.
This scope does not claim knowledge of pruned/unreachable or external executions,
nor does it replace future acquired-audio duplicate checks.

Four incomplete pre-freeze metadata tooling attempts are preserved separately;
none is used as accepted history proof. They involved search-efficiency repairs,
not candidate selection, musical MIDI inspection, neural execution or tuning.

## Prospective Freeze

Implementation commit: `013cf01b`.

Source-discovery freeze:
`aed457e140ff2fde9d4e9d5d6d4ccdaedce83857`.

Canonical SHA256:
`5baaa6cfa0cc49a5432c9dfaffac008a575bf2407444cea2bdfc44ddeb7dc49c`.

```text
remoteVerifiedAt   = 2026-10-18T09:10:33.089260+00:00
midiParseStartedAt = 2026-10-18T09:10:47.752805+00:00
```

The freeze was committed, pushed, fetched and verified at exact remote HEAD
before musical Batik MIDI parsing. After that boundary, no frozen tooling,
source, contract or dependency changed. The pre-execution proof is
`source-discovery-remote-proof.json`, not a later GitHub receipt.

## Fixed Truth Result

The pinned existing science container ran with network disabled. It parsed
102,421 NOTE_ONs / 67,807 truth groups across 36 files, using the original v3
first-anchor <=35ms non-transitive **truth** grouping. H remains 50ms; neither
number was tuned or unified with product MIDI grouping.

| Missing family | Batik opportunities | First selected recording |
| --- | ---: | --- |
| same_pitch_sustain | 5 | kv282_1 |
| single_busy_retrigger | 408 | kv279_3 |
| post_ready_repeat | 5 | kv281_1 |
| multiple_wrong_then_correct | 27 | kv279_2 |
| partial_then_full | 2 | kv281_1 |

Diagnostic only: same-chord sustain 9, exact chord busy retrigger 261. These do
not replace Vienna's already-covered cases. Remaining mandatory families: none.

The mandatory single repeated-pitch pair is `[74] -> [74]`, source onsets
20253.125000000015ms and 20467.70833333335ms, gap 214.58333333333576ms;
gesture IDs `kv279_3:g:232` / `kv279_3:g:233`. Canonical truth pair ID:
`7ee0a810b91ba58b5c72383b67f99d744623e4957efeab2e4102a6b4b8fccec2`.
All selected identities, full pitch sets, note-off/pedal facts, row identities,
MIDI hashes and future audio Git objects are in `batik-truth-topology.json`.
`combined-truth-topology.json` retains the selected Vienna cases unchanged and
adds only the five Batik gap-fill cases.

The canonical truth pair binds `audioSha256 = null`, honestly reflecting that
audio was not acquired; the source envelope separately binds its immutable
upstream audio object. This is not a model-input/audio-byte qualification identity.
For Batik the unchanged selector receives MIDI end-of-track as symbolic
performance extent. Audio duration, real context, alignment and exact input
preservation remain unmeasured and require the next prospective protocol.

## Verification And Stop

Focused suite: **33 tests, 2 files, 33 passed, 0 failed/errors**. Complete output
is preserved in `focused-tests-review.txt` and its JSON receipt. Earlier
pre-freeze test runs are separate artifacts, not added to the unique test count.
Git staging reported LF-to-CRLF normalization warnings; no warnings were
converted into a claim of a full product static/build pass. No frontend build,
Continuous browser regression or model execution ran in this phase.

```text
productionDiff = empty
v3HistoricalDiff = empty
H = 50ms, CANDIDATE_NOT_QUALIFIED
audioDownloaded = false
audioPcmDecoded = false
newNeuralRuns = 0
RobustSessionRuns = 0
primaryQualificationFreeze = NOT_CREATED
Continuous engineering/musical/controller/parity = NOT_STARTED
Stage A / Stage B = NOT_STARTED
safety / usability = NOT_MEASURED
Continuous = MODEL_NOT_VALIDATED
STEP = ATTEMPT_ANALYZER_NOT_VALIDATED
productionMicrophone = false
D4 = false
```

GitHub status at the evidence commit is recorded separately in
`github-receipt.json`; the final pushed HEAD is queried again independently.
Local tests are not CI PASS.

Stop for independent audit. A separately authorized next phase must establish
exact audio-source suitability, lossless-source availability, and, if compressed
audio is used, a fixed decoder, codec provenance and immutable PCM identity
before acquisition or acoustic execution. No audio download, Robust run,
Continuous regression, microphone permission or integration is started here.
