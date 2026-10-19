# V16 Product Policy Decision

`EXPOSED_PRODUCT_POLICY_RESEARCH_ONLY_NOT_QUALIFICATION`

## STEP: Strict Is Not The Same As Safe Leniency

`STEP_MICROPHONE_V16_NAIVE_REQUIRED_PITCH_COVERAGE_UNSAFE_WRONG_OCTAVE_FALSE_ACCEPT`

P0 exactly reproduces all 34 immutable V15/V13 verdicts. P1 was evaluated once on those same frozen attempts, without decoder execution, H50 reconstruction, production changes or hypothetical target-progression replay.

Confusion classification uses **required-target physical support**: the target must be a subset of frozen physical truth. This is the microphone research question, not MIDI exact-key-set ground truth. Physical extras remain significant under MIDI_EXACT_SET.

| Policy | Rate | Attempts | True accept | False reject | True reject | False accept |
|---|---:|---:|---:|---:|---:|---:|
| P0 EXACT_SET | 44100 | 17 | 4 | 6 | 7 | 0 |
| P0 EXACT_SET | 48000 | 17 | 4 | 6 | 7 | 0 |
| P1 REQUIRED_PITCH_COVERAGE | 44100 | 17 | 10 | 0 | 6 | 1 |
| P1 REQUIRED_PITCH_COVERAGE | 48000 | 17 | 10 | 0 | 6 | 1 |
| P0 total | both | 34 | 8 | 12 | 14 | 0 |
| P1 total | both | 34 | 20 | 0 | 12 | 2 |

Both rates independently reproduce the following policy evaluations; these are rate variants of exposed evidence, not independent physical recordings:

| Scenario | Expected | Physical truth | Frozen acoustic set | P0 | P1 |
|---|---|---|---|---|---|
| correct_chord | [56,64] | [56,64] | [52,56,64,68] | MISMATCH | MATCH |
| post_ready_repeat / attempt 1 | [46,58] | [46,58] | [46,58,70,74] | MISMATCH | MATCH |
| post_ready_repeat / attempt 2 | [46,58] | [46,58] | [46,50,58] | MISMATCH | MATCH |
| extra_chord_tone | [56] | [56,64] | [52,56,64,68] | MISMATCH | MATCH |
| missing_chord_tone | [21,56,64] | [56,64] | [52,56,64,68] | MISMATCH | MISMATCH |
| wrong_semitone | [56,63] | [56,64] | [52,56,64,68] | MISMATCH | MISMATCH |
| wrong_octave | [52,56] | [56,64] | [52,56,64,68] | MISMATCH | **MATCH: FALSE ACCEPT** |

`extra_chord_tone` is `MICROPHONE_EXTRA_NONBLOCKING_BY_DESIGN`, not the old extra-tone safety counter. But the wrong-octave result is different: physical truth does **not** contain target 52.

`MICROPHONE_COVERAGE_POLICY_UNSAFE_WRONG_OCTAVE_FALSE_ACCEPT`

Only 20 of 22 P1 MATCH decisions have full physical target support. Both unsupported decisions are the wrong-octave counterexample. Target presence in acoustic output cannot prove the correct physical octave was played.

`MICROPHONE_REQUIRED_PITCH_COVERAGE_NOT_SAFE_AS_UNCONDITIONAL_MATCH_POLICY`

No unconditional microphone coverage MATCH policy can be promoted from these results. Exact-set rejects some legitimate acoustic chords; naive coverage accepts a dangerous unsupported target. No production microphone verdict policy is qualified. A three-state UNCERTAIN/RETRY policy may be conceptually appropriate for such ambiguous evidence, but no classifier or P2 is implemented or chosen.

V15 remains historically valid. Prospectively:

`V15_EXACT_SET_BLOCKER_DOES_NOT_BY_ITSELF_PROVE_NEW_ACOUSTIC_READOUT_IS_REQUIRED`

This phase neither proves Robust must be replaced nor authorizes a new model/readout. Shared Robust remains shared.

## Rearm Is Still Required

`REARM_REQUIRED_FIXED_COOLDOWN_DURATION_NOT_YET_ESTABLISHED`

Two C4 targets can both satisfy pitch coverage using the same old observation. Only temporal/attempt ownership prevents that observation from satisfying both. Actual V13 synthetic tests reject non-READY input, timestamps at/before the retirement watermark even when delivered after READY, delayed duplicate receipts and stale target-generation completion.

Duplicate-ID testing preserves the original source timestamp. A forged new timestamp on an old sealed ID is rejected as a producer-identity violation, not presented as a new runtime feature. No production observation-ID ledger or microphone input implementation was added.

Explicit source-time retirement is not a fixed silence cooldown. No microphone cooldown duration, silence gate, RMS/flux/transient detector, decoder, threshold or octave heuristic was selected.

## Continuous: Preserve Accounting, Weaken The Claim

`CONTINUOUS_MICROPHONE_SOURCE_SENSITIVE_PRODUCT_INTERPRETATION_SUPPORTED_FOR_FURTHER_DEVELOPMENT`

All 36 fully publication-linked COMPLETE acoustic counterfactual ledgers were projected, from three already exposed musical clips at two rates. A real controller completion is retained in the inventory but excluded before freeze because its `engineering.microphone.publications` field is only count 11, not a retained publication array. The pre-freeze schema-assumption failure and correction are preserved. No replacement data or inference was used.

The projection keeps internal MATCHED/WRONG/EXTRA/MISSING, observation IDs/owners, finality, matched timing and expected strikes unchanged. Finalized WRONG/EXTRA are interpreted as POSSIBLE_UNMATCHED_ACOUSTIC only for microphone; MIDI keeps direct key-event interpretation.

| Category / diagnostic | C0 | Microphone C1 |
|---|---:|---:|
| Internal MATCHED | 1370 | 1370 |
| Internal MISSING | 40 | 40 |
| Internal WRONG | 6 | 6 |
| Internal EXTRA | 4 | 4 |
| Internal NOT_REACHED | 6 | 6 |
| Report POSSIBLE_UNMATCHED_ACOUSTIC | 0 | 10 |
| Diagnostic strong-negative category items | 50 | 40 |

Each rate has 18 ledgers: MATCHED 685, MISSING 20, WRONG 3, EXTRA 2, NOT_REACHED 3. Diagnostic strong-negative items change 25 -> 20 per rate. These sums contain correlated counterfactual reuse and different item kinds, not independent user errors or a score formula.

Target-strike coverage stays 1370/1410; expected-chord strike completeness stays 286/300 over the correlated ledgers. Stored timing metrics are exactly unchanged in every ledger; per-ledger nearest-rank P50/P95/max are in `continuous-projection-results.json`. No physical-device or UX latency is measured.

Numerical final score: `NOT_COMPARABLE_NO_CURRENT_FORMULA`. The inspected production completion/review/save path has no deterministic overall performance-score or numerical accuracy formula. Therefore this is not a measured score improvement. Acoustic precision, false-positive onsets/minute, missed onsets and raw extras remain model-quality diagnostics; weaker user penalties do not improve or erase them.

## Current UI And Persistence Facts

- Live score coloring uses finalized MATCHED expected strikes (green) and MISSING expected strikes (red). A WRONG group can cause red via its MISSING strike; WRONG observations do not have their own live annotation.
- No direct live EXTRA badge, unfinalized red extra-note claim, or WRONG/EXTRA live numerical counter is currently wired in the inspected path.
- Completion dialog receives outcome/mode/loading/actions, not evaluation or numerical score.
- Review shows target/matched/missing/not-reached strike counts and `extras.length`. The current final label is physical-sounding Extra playing. A future microphone projection should use qualified acoustic wording; MIDI need not weaken its deterministic-key interpretation.
- Review coloring again uses MATCHED/MISSING, not direct WRONG/EXTRA observation annotation.
- The completed evaluation is held in an in-memory store. Durable performance-take save uploads media, source/scope/tempo/timebase metadata, not evaluation/counts/accuracy. Saved-media pages do not expose persisted evaluation scores.

Keep internal EXTRA: ContinuousFinalizer uses it to claim residual observations and refuses completion with unresolved ownership/reservations. Source-sensitive product projection belongs after this deterministic accounting, not inside the finalizer.

Prefer prompt positive target evidence without promoting provisional observations to final ownership. Current live feedback is finality-based; a future low-latency provisional positive display needs its own non-authoritative presentation contract. Even finalized unmatched acoustic evidence is not independently validated proof of a physical wrong/extra key.

Existing evidence supports the lossless projection mechanics and a further-development recommendation, not shipping behavior, real-device microphone reliability or a qualified scoring policy. Additional evidence requires independent physical truth across instruments/rooms/noise/octaves, and retained full controller publications if that cohort is to enter strict content-linked analysis.

## Verification And Boundaries

Protocol freeze commit: `7ba636abb8160757b9a7ea5741e3f153f54548ad`.

Freeze SHA256: `af44e96cfc087341a2173fc8a29b9e95e890f09046af311e2d13e25e607100cc`.

Remote verified at `2026-10-19T05:19:13.520Z`; the single actual analysis started at `2026-10-19T05:19:18.060Z`. No policy/source edits followed the output.

- Research tests 23/23; current product tests 393/393 across 37 files; research TypeScript and lint pass, lint 0 errors/0 warnings.
- jsdom pause/load/navigation not-implemented notices are disclosed in local-verification.json. The pre-freeze tooling failure is retained separately.
- All neural/session/Worker/decoder/PCM/acoustic-rerun/fresh-holdout/warmup/unknown counters are zero.
- Production unchanged. All 1,435 pre-existing tracked research files, including V3-V15 and historical Continuous evidence, retain their recorded raw hashes.
- Capabilities stay Continuous MODEL_NOT_VALIDATED, STEP ATTEMPT_ANALYZER_NOT_VALIDATED, productionMicrophone=false, D4=false.
- Local tests are not CI. Actual GitHub status/workflow evidence is recorded in the remote receipt.

STOP for independent audit. No policy promotion, P2, new readout/model, fresh holdout or microphone integration begins automatically.
