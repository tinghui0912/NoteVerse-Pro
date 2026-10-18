# H50 v3 Corpus Intake And Selector Freeze

Disposition: `STEP_WAITING_H50_PRIMARY_HOLDOUT_TOPOLOGY_NOT_ESTABLISHED`.

Phase: `PRACTICE_STEP_H50_PRIMARY_HOLDOUT_CORPUS_INTAKE_AND_PROSPECTIVE_FREEZE_DISABLED`.

## Starting Gate And Scope

Fetched and verified starting remote/local/merge-base:
`4a2e2e15c266d4b3bd6f23006cefe59d8e16e313`; ahead/behind 0/0, no intervening
commits, clean starting tree. Starting GitHub state was pending with empty
statuses and workflow runs: **NOT CI PASS**. See `starting-gate.json`.

All changes are new v3 research tooling/reports. Product source and all existing
historical evidence are unchanged. No private directories outside the project
were scanned, no external corpus/license was downloaded, no microphone was used.

## Source Intake Is Not The v2 SMD-Only Conclusion

The scoped census covered project research work roots and research/public
fixtures: 7,227 audio/MIDI files plus archive indexes. There are **181 candidate
source pairs**, of which **156 have established performance pairing**:

| Dataset | Source pairs considered | Pairing established |
| --- | ---: | ---: |
| SMD v2 | 50 | 50 |
| MAESTRO v3 | 18 | 18 |
| Vienna 4x22 | 112 | 88 |
| PianoVAM | 1 | 0 |

The remaining 24 Vienna special/average takes lack the matched performance
alignment provenance required here. PianoVAM stem pairing alone does not establish
performance alignment or local license evidence. Unbound/derived file-pair links
are separately recorded; they are not invented independent performances.

The ledger distinguishes actual Robust execution, output-bearing inspection,
output-driven design, truth-only inventory/selection, prior material topology
design and unknown provenance. **Truth-only inventory does not exclude a source.**
Synthetic tests explicitly enforce that distinction, including same-byte aliases
and source-lineage wrappers. Metadata-only identity probes searched project
history without returning model scores, note lists, tensor values or verdicts.

**25 recording-level primary candidates survived**: 1 MAESTRO and 24 Vienna.
This corrects the overgeneralization from SMD exhaustion; it does not modify the
valid historical SMD 50/50 execution evidence or any old v2 report/helper.

The MAESTRO candidate has known training-domain overlap and a historical
development-only research role. This intake is engineering-source governance,
not scientific model-independence, official product accuracy, or commercial
qualification. License/usage scope and provenance remain explicit per source.

## Prospective Boundary Before MIDI Events

Implementation/tooling commit: `97c4642f`.

`TOPOLOGY_SELECTOR_CONTRACT_FREEZE`:
`cb6d8c75e37e1391e6dc7856c8610cc7369f3df6`.

Canonical freeze SHA256:
`8b78b3f4f74db5ab4e104323e94cc94828777c3fde58585330bcbae882178caf`.

```text
remoteVerifiedAt = 2026-10-18T05:42:54.236026+00:00
MIDI execution    = 2026-10-18T05:43:05.293103+00:00
```

The selector-only freeze was committed, pushed, fetched and independently
verified at exact remote HEAD **before** eligible MIDI events were parsed.
`selector-remote-proof.json` is the pre-execution proof; any later GitHub query
does not replace it. The source/tooling/contract bytes remain unchanged.

The frozen rule reuses first-anchor 35ms **truth grouping**, not acoustic H or
product MIDI policy. Singles require `[p] -> [p]` at 200..250ms. Chords require
equal complete normalized sets of at least two pitches at **>50..250ms**, a
separate topology. Partial overlap/subset/superset are rejected.

All first-occurrence, real-context, isolated-waiting, sustain-guard and sequence
rules were fixed before MIDI inspection. No acoustic output influenced them.
The focused suite passed **27 tests in 2 files** before that freeze.

## Truth-Only Result And Stop

The pinned existing science image ran with network disabled. It parsed 11,342
NOTE_ONs / 5,620 physical truth groups from the 25 eligible recordings. No audio
PCM was decoded and no neural or product session was executed.

| Frozen family | Eligible metadata occurrences |
| --- | ---: |
| Correct single | 9 |
| Correct chord | 18 |
| Same-pitch sustain guard | **0** |
| Same-chord sustain guard | 1 |
| Single same-pitch busy retrigger, 200..250ms | **0** |
| Exact repeated chord, >50..250ms | 2 |
| Post-READY repeated target opportunity | **0** |
| Multiple wrong attempts before correct | **0** |
| Partial chord then full chord | **0** |

These counts are **under the frozen rules**, not a claim that the recordings lack
all repetition/sustain in every possible interval. In particular, a MIDI
opportunity is not actual READY or BUSY PASS. Future causal state traces would
still be required.

The lexically selected optional chord pair is `Schubert_D783_no15_p18`:
`[48,53,56,65] -> [48,53,56,65]`, gap 246.87500000000364ms, pair ID
`d52bd175ec222d8c50af80fef9adc5d89d565db42646cd9189128b31a3e13703`.
Exact onsets, gesture IDs and both file hashes are in `truth-topology.json`.
It **cannot replace the absent mandatory single same-pitch pair**.

Thus mandatory topology is incomplete. Selection is closed at this result:
no loosened rules, alternate H, source substitution, occurrence replacement or
scorer change. Existing cases are not promoted as an accepted primary corpus.

## What Was Not Executed

```text
newNeuralRuns = 0
invalidatedNeuralRuns = 0
H = 50ms, CANDIDATE_NOT_QUALIFIED
primaryQualificationFreeze = NOT_CREATED
inputPreservation = NOT_STARTED_TOPOLOGY_BLOCKED
44.1k / 48k prepared trials = NOT_CREATED
modelInputShaParity = NOT_MEASURED
Continuous regression = NOT_STARTED
Stage A / acoustic seal / Stage B = NOT_STARTED
safety counters = NOT_MEASURED
usability / latency = NOT_MEASURED
```

No earlier DSP, Continuous, neural or product PASS is inherited. The frozen
scorer/assembly documents define a future qualification contract, not measured
safety or a production microphone implementation. No full product build/static
or expensive browser suite was required to answer this preparation-only stop.

## Protected State And Next Boundary

Product source diff across `apps/customer-web/src`, `apps/customer-web/public`
and `backend/app` is empty. Frozen identity JSON, including historical provenance
paths, is untouched. No model, decoder, FIR, geometry, Worklet, clock, finalizer,
STEP runtime/controller, MIDI policy, lifecycle or capability changed.

```text
Continuous = MODEL_NOT_VALIDATED
STEP = ATTEMPT_ANALYZER_NOT_VALIDATED
productionMicrophone = false
D4 = false
```

Additional authorized, legally paired unexposed recordings must supply the missing
mandatory opportunities under the frozen rules, or a separately authorized new
prospective design phase must precede any changed selector. This phase does not
download such data, alter the rules, create a primary acoustic freeze or proceed
to microphone integration. Independent audit comes next.

If a later phase successfully freezes a complete primary corpus, its order is:
exact remote freeze verification; **new** Continuous engineering 8/8, musical 8/8,
controller/parity; audio-only real Worker/WebGPU Stage A; immutable acoustic seal;
verify seal; frozen truth plus real STEP causal trace Stage B; no tuning;
independent audit. None of that execution is authorized by this incomplete freeze.
