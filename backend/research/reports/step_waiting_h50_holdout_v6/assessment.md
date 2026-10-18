# V6 Portable Preparation and Primary Acoustic Freeze

Disposition: STEP_WAITING_H50_PRIMARY_ACOUSTIC_QUALIFICATION_FREEZE_ESTABLISHED_NEURAL_NOT_STARTED.

This establishes input/provenance preparation only. It does not qualify H50 acoustic safety, recognition, real-device behavior, latency, commercial use or microphone integration.

## History and Scope

Starting remote HEAD: 63d33bf85d3c71d4a06fce326dbb49a5ba38b8b2. Local HEAD matched, ahead=0, behind=0 and worktree clean at the gate. Product source and all v3/v4/v5 tooling/reports have zero diff. The old v5 freeze 986fa74e1f0aedbdd9b320843c8f41f27d6f506c remains immutable and blocked as QUALIFICATION_TOOLING_FREEZE_PATH_NOT_PORTABLE.

The four accepted v5 MP3 byte objects were reused without download. Their byte counts, SHA256 and Git blob SHA1 all matched. No truth, source, occurrence, decoder, DSP, H or scorer was reselected or retuned. v4 truth pair IDs, including 7ee0a810b91ba58b5c72383b67f99d744623e4957efeab2e4102a6b4b8fccec2, remain unchanged; audioBoundCaseId is additive.

## Portable Gate

All new manifest files[].path entries use REPO_RELATIVE_POSIX_V1 and the single strict repo_relative_posix helper. Old backslash paths are rejected, not normalized or resolved through a compatibility path.

Portable predecode freeze: 0f504d9ebf7eff8292c4a39d9608edaa16401709.
Canonical SHA256: 605de88236966b31e23af41fc312bca96f64c7eadc1318e693a5ef379f933242.

The prospective timing order was:

- Remote verified: 2026-10-18T10:16:45.051996+00:00.
- Windows host preflight: 10:16:45.633450 through 10:16:45.910853 UTC.
- Pinned Linux container preflight: 10:16:50.209193 through 10:16:54.521330 UTC, network=none.
- First selected MP3 decode began: 10:17:45.417141 UTC.

Both environments checked all 184 predecode paths with zero hash mismatches and zero backslash paths. Preflight used raw file I/O only, with no decoder import or PCM decode.

## Decode and Source Preparation

Decoder contract is byte-identical to v5: SHA256 aa4afd635467d3c46736b98c7c3e3ddf3c836f6deb0f7e05cadfe270ccef8eb0. The science image is sha256:7feadf65b7763a9ee94880218e3e80f8566ec242ffff7e9ca99d10bb85d76a6f; Python 3.11.10, soundfile 0.12.1, libsndfile 1.2.0, NumPy 1.26.4 and SciPy 1.14.1. No fallback decoder was used.

All 12 selected MP3 fresh-process decodes were deterministic. Each recording's sample rate, channels, frame count and mono float32 SHA were identical across its three processes. Four Vienna WAVs were decoded once each after original audio SHA verification. All eight recordings are stereo; mono is the unchanged float32 arithmetic mean.

| Batik recording | Native rate | Frames | Actual duration |
| --- | ---: | ---: | ---: |
| kv279_2 | 48000 | 19680000 | 410 s |
| kv279_3 | 48000 | 13344000 | 278 s |
| kv281_1 | 48000 | 13056000 | 272 s |
| kv282_1 | 48000 | 21984000 | 458 s |

All nine frozen cases passed minimum onset >=5000 ms and last required truth time +3000 ms <= actual audio duration. MIDI EOT was not used as acoustic duration. Publisher synchronization remains PUBLISHER_ZERO_TRANSFORM_SYNCHRONIZATION_CONTRACT with alignmentTransformSeconds=0, not independently measured sample-perfect alignment. No offset fitting, waveform correlation, gain normalization, trimming or neural inspection occurred.

Both source rates were prepared using the unchanged direct-copy or SciPy resample_poly(default Kaiser5) float32 rule. Production QualifiedSourceAdapter and planWindow were imported, not reimplemented. Frozen adapter/FIR identities were retained.

Input preservation: 9 cases, 18 rate jobs, 228 complete 29120-sample model windows, 0 mismatches. Every input SHA exactly equals its full-recording reference SHA. The six ordinary/busy/late_publication/rearm_equality/pre_ready/post_ready schedule labels leave all corresponding model inputs unchanged. Full coordinates, additive case identities, source/PCM/clip hashes and per-window hashes are in input-preservation.json.

## Primary Freeze

Primary freeze: 570114cbe1f11983d6b07956078b4a655275b976.
Canonical SHA256: 4a0264d06939fab1c12f1199be1903bc089cbe9fa0f0bf06f1456c4faf298b57.
Remote verified: 2026-10-18T10:21:17.991859+00:00.

After remote verification, both Windows host and network-isolated Linux container verified all 254 primary manifest paths and hashes, with zero mismatches/backslash paths. The primary freeze binds immutable prior evidence, decoder, raw source identities, decoded/rate/clip PCM, dual preflight receipts, all input hashes, additive case IDs, H=50 and the unchanged 20-scenario manifest. Raw audio/PCM remain local ignored assets; Git contains their exact identities and preparation receipts.

## Verification and Limitations

Final prefreeze focused tests: Python 2 files / 53 passed / 0 failed / 0 errors; Node synthetic DSP 1 file / 9 passed / 0 failed. The first Python attempt (52 passed, 1 failed) is preserved under pre-freeze-test-attempt-1. Its Git EOL environment mismatch was diagnosed before freezing: Linux did not inherit Windows core.autocrlf=true. Host-equivalent per-process Git configuration corrected the test environment without changing repository configuration, production bytes or raw SHA validation. Git emitted LF-to-CRLF warnings; these are not reported as zero messages.

newNeuralRuns=0; RobustSessionRuns=0. ContinuousRegression, StageA and StageB are NOT_STARTED; acousticSeal=NOT_CREATED. Safety, usability and latency are NOT_MEASURED. Actual READY/busy causal denominators still require future real runtime traces; preparation never establishes a 0/0 PASS.

Continuous=MODEL_NOT_VALIDATED; STEP=ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false. H remains the fixed 50 ms candidate, not an acoustically qualified product. Commercial qualification is NOT_PERFORMED; Batik remains a noncommercial engineering source, not a commercial corpus approval.

GitHub truth and commit chain are recorded in github-receipt.json and queried again for final HEAD. Local tests are not CI PASS.

STOP for independent audit. Only the next separately authorized phase may reverify the exact primary freeze, run NEW Continuous regressions, execute audio-only Stage A, seal/verify acoustic outputs, and then open truth for frozen Stage B. No microphone integration follows automatically.
