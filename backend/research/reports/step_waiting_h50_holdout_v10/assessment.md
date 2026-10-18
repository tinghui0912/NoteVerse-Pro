# H50 Primary Qualification Closure and Next-Candidate Design

Disposition: `STEP_H50_PRIMARY_QUALIFICATION_CLOSED_CURRENT_CANDIDATE_NOT_QUALIFIED_NEXT_CANDIDATE_AND_FRESH_HOLDOUT_DESIGN_READY`.

This closes the current Robust + H50 + exact absolute pitch-set STEP primary qualification as NOT_QUALIFIED. It is a closure/design result, not an acoustic qualification PASS. No new candidate or future recording was selected.

## Independent Evidence Audit

Starting remote/local HEAD: `598600c37e1bce2fb240056687fe71a61012bfe7`; merge-base identical, ahead=0, behind=0, initially clean. Fetch preceded all work. Production and v3-v9 source/report diffs remain empty.

- v7 acoustic SHA256: `61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1`.
- v7 original seal SHA256: `5ffdb33b8f34791249f40e8c7b6c778b6d93a5f362b305b77120269ceb933f85`.
- v8 downstream seal SHA256: `7256b87d1716cc4eab27e90e0b7746cff138d10acad281dc90ad574d43cc798c`.
- v9 evaluation freeze: `1b67d9e44d6a052bc785348192b812a84a60ab8c`, canonical SHA256 `28931c1efbd59f2edc9242c18bf40fd4736354201a60f078fc7cf792820d563c`.
- v9 results SHA256: `637773dcae08b425efcec0fddabcea2603c4cec1308e083015ac3007790cd50f`, exact bytes at evidence commit `f4c277e1f06695f8247122f011b6d6f35ff60516`.

The audit verified the accepted 254 primary, 1457 execution and 62 v9 evaluation file/hash bindings, plus exact Git bytes of all 40 v9 cell traces. There were zero mismatches. No evaluator or product/acoustic runtime was executed. Original v7 BLOCKED/FAIL and v9 `STEP_WAITING_H50_PRIMARY_STAGE_B_QUALIFICATION_NOT_ESTABLISHED_CAUSAL_DENOMINATOR_MISSING` remain unchanged.

## Two Coequal Blockers

`primary-qualification-closure.json` preserves both:

1. `CAUSAL_SAFETY_COVERAGE_NOT_ESTABLISHED`: valid empirical cells 30/38; busy and late safety denominators both zero. The missing cells are single_busy_retrigger, chord_busy_retrigger, busy_period_physical_input and late_publication, each at both rates. They are NOT_EVALUABLE, not safety PASS and not observed safety failures.
2. `FUNCTIONAL_RECOGNITION_BLOCKED_ON_VALID_CAUSAL_TRIALS`: correct_chord, post_ready_repeat and match_followed_by_next_target fail required behavior at both rates, six valid cells total.

Even filling busy/late coverage in some future experiment would not make the existing valid functional failures disappear. The 11 stored dangerous counts are zero observations, with each original denominator retained; this does not establish global safety or busy/late safety. No safety counts or functional outcomes were recomputed.

## Additive Latency Erratum

`v9-latency-reporting-erratum.json` classifies the per-attempt field labels as `NON_GATING_REPORT_LABEL_ERROR`. Their original arithmetic subtracts decoded `attempt.anchor`, not physical truth onset. The top-level v9 sourceReplayLatency aggregate already subtracts physical truth onset; it must not be relabeled as decoded-based.

`corrected-source-domain-diagnostics.json` records all 44 stored attempts with separate physical-truth-to-open/verdict and decoded-event-to-open/verdict metrics. It includes both rates and separately labels all stored attempts versus valid causal trial attempts. No scoring, truth rematching, clock fitting or timing shift occurred. Assembly, verdicts, attribution, denominators, safety, functional classifications and disposition are unaffected.

Valid-causal-attempt summaries below are source-progress diagnostics only, NOT_PHYSICAL_DEVICE_UX_LATENCY. Each row has count 18; values are milliseconds, nearest-rank P50/P95/max.

| Rate | Anchor to capture-progress milestone | P50 | P95 | Max |
| --- | --- | ---: | ---: | ---: |
| 44100 | Physical truth to open | 639.947562 | 728.049887 | 728.049887 |
| 44100 | Physical truth to verdict | 642.655896 | 801.955782 | 801.955782 |
| 44100 | Decoded event to open | 618.072562 | 731.383220 | 731.383220 |
| 44100 | Decoded event to verdict | 618.072562 | 812.789116 | 812.789116 |
| 48000 | Physical truth to open | 629.208333 | 712.666667 | 712.666667 |
| 48000 | Physical truth to verdict | 631.916667 | 818.500000 | 818.500000 |
| 48000 | Decoded event to open | 607.333333 | 716.000000 | 716.000000 |
| 48000 | Decoded event to verdict | 607.333333 | 829.333333 | 829.333333 |

## Failure Mechanisms and Exposure

`failure-mechanism-inventory.json` preserves exact observations/confidences and source coordinates at both rates. Correct-chord truth [56,64] produced E3/E4/G#3/G#4. At 44.1k, false E3/G#4 confidence is approximately .863/.781 while true G#3 is .373: SIMPLE_HIGHER_CONFIDENCE_FILTER_NOT_SUPPORTED. Legitimate octave chord [46,58] must retain A#2 and A#3; D5/D3 errors have confidences about .852/.841: SIMPLE_GLOBAL_OCTAVE_COLLAPSE_NOT_SUPPORTED.

Single busy onsets 20253.125/20467.708ms precede first actual attempt opening at 20908.073ms (44.1k) or 20897.333ms (48k). Chord busy onsets 25737.500/25984.375ms precede first opening at 26388.073/26377.333ms. Both first attempts eventually MATCH. Recognition correctness is therefore distinct from publication/attempt-open availability: RAPID_PHYSICAL_PAIR_NOT_CAUSALLY_BUSY_UNDER_CURRENT_ACOUSTIC_PUBLICATION_GEOMETRY.

The delayed owned window also opens Attempt A, so it cannot simultaneously prove an older second gesture arriving after a preceding retired rearm. No offset, different fault window or alternate physical occurrence was substituted.

`exposure-transition.json` marks v3-v9 as EXPOSED_DEVELOPMENT_ONLY_FOR_ANY_FUTURE_CHANGED_CANDIDATE. Historical blind evidence remains historically valid. Any changed candidate influenced by inspected outputs can use these sources only for failure reproduction, debugging and engineering comparison labeled DEVELOPMENT_ONLY_NOT_QUALIFICATION, never a fresh primary/independent holdout.

H=50 and Robust .30/.05 remain historical identities, not retuned or requalified. Neither extra-pitch contamination nor the missing causal denominators establishes H50 width itself as root cause.

## Static Inventory and Next Design

`existing-acoustic-candidate-inventory.json` records eight existing candidates: Original ByteDance, Robust, Online-AMT, Transkun, Aria-AMT, RTT, D3RM and Basic Pitch; three historical decoder variants; 41 local ONNX paths with 13 distinct hashes. Six local checkpoint identities were raw-hash verified, and Basic Pitch model/weight assets were checked. This was byte hashing and source/report inspection only, never model loading. Historical license classifications and browser/runtime outcomes are explicitly scoped; none is new commercial approval or automatic selection. Basic Pitch WebGL evidence is not WebGPU qualification. Historical Online-AMT K8/K1 multi-graph/fallback ownership cannot silently satisfy a new single-owner/no-fallback contract.

The prior STATISTICAL_TIE and NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER conclusions remain. They are historical comparison dispositions, not a new assertion that every inventory pair is statistically tied. A future model can initially be only a PRODUCT_ENGINEERING_CANDIDATE.

`next-candidate-requirements.json` defines a new score-blind candidate direction focused on polyphonic octave localization and extra-pitch precision, with source identity, browser-local bounded ownership and no transport authority. It prohibits target filtering/cardinality top-K/subset acceptance/ignore-extras, global octave deduplication, v9-fitted confidence thresholds and pitch-class matching. No RMS/flux/transient/second-onset detector is authorized. Exact-set product semantics remain unchanged; changing them would require a separate product-design/safety proposal and new holdout.

`fresh-holdout-design.json` defines geometry-first future busy/late coverage. P1_min is the exact first content-blind source-block endpoint that can cover G1's owned window. G2 must follow it at both rates. A separately justified content-blind sealing interval plus the frozen analysis hold defines a shared feasible busy interval. BUSY_GAP_GRID registers three architecture-relative gap bins, for single notes and exact chords across owned-window phases, before any fresh output. It does not choose recordings or alter musical spacing. Empty intersections or insufficient fresh metadata stop preflight; actual state still decides denominator validity.

Late cases require a distinct W2 that cannot be the opening/sealing publication of Attempt A, actual G2 during busy, real physical retirement, and delayed delivery after actual rearm. The selector is source-geometry-only. All fresh positives, negatives, sustain, busy/late, repeat, mismatch/correct, partial/full and exclusive boundary topologies require both rates; 0/0 never PASS. Sources, exact bytes, candidate identity, scenarios and executable rules must be separately prospectively frozen. These v10 design rules are not an acoustic qualification freeze or permission to run it.

## Verification and Stop

26 metadata/arithmetic/design tests passed, zero failures/errors. newNeuralRuns=RobustSessionRuns=InferenceSessionRuns=AcousticModelWorkerRuns=StageAReruns=StageBReruns=ContinuousReruns=0; selectedPcmDecoded=false. No product runtime, geometry DSP execution, browser, model, scorer, collection or fresh source selection occurred in v10. Git LF-to-CRLF staging warnings remain warnings, not suppressed.

Continuous=MODEL_NOT_VALIDATED; STEP=ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false. Commercial, physical microphone, real-device and UX qualification are not performed. GitHub combined status, individual statuses and workflows are independently queried at evidence and final HEAD; pending with empty arrays means NOT CI PASS.

STOP for independent audit. Only a separately authorized next phase may decide which new score-blind engineering candidate to develop on exposed evidence. A selected candidate must later face an entirely new untouched prospective qualification corpus. Microphone integration is NOT_AUTHORIZED.
