# H50 Primary Holdout Preflight

Disposition: `STEP_WAITING_H50_HOLDOUT_TOPOLOGY_NOT_ESTABLISHED`.

Phase: `PRACTICE_STEP_WAITING_H50_HOLDOUT_TOPOLOGY_REPAIR_AND_PRODUCT_SAFETY_QUALIFICATION_DISABLED`.

Starting remote/local HEAD: `2722e5b2a4dda1d412d37689b4974214f9621dcf`.
The branch was fetched and that exact SHA verified before work. No production
source or historical evidence was modified.

## First Blocking Requirement

The sole locally available paired SMD archive contains **50 recordings**. Fresh
streaming SHA256 computation verified all 50 stereo audio members and all 50
paired MIDI members against existing source identities. The archive itself is:

```text
backend/data/work/smd_v2/SMD-piano_v2.zip
bytes = 3,221,582,754
sha256 = 75f6e0f5fc9f5ea10582371c84b15f264538bf2a183721d5dee9e337e221b8ab
```

**All 50 have previously undergone real browser Robust inference. Unused primary
recordings = 0.** Each source is joined by recording ID, audio hash and MIDI hash
to the committed F5 take manifest and its sealed real Chrome/WebGPU prediction
execution receipt. Every joined Robust receipt is complete with positive actual
`InferenceSession.run` accounting. F5 continuation evidence separately confirms
50 unique takes and unchanged primary seals.

The 28,396 historical Robust runs are **exposure evidence only**. They are not new
runs in this phase, not new musical qualification, and not inherited PASS results.

The exposure ledger also records the specified Continuous paired, STEP decoded
sufficiency/H-development, fresh-strike, waiting-attempt and topology-v3 source
families. It distinguishes actual acoustic execution from previously selected
but unexecuted topology-v3 cases. Inventory membership alone is never treated as
proof of model execution. See `inventory.json` for all source hashes, receipt
hashes and the 66-ID cross-phase exclusion ledger.

Thus no unused local paired SMD source can supply the required primary explicit
same-single-pitch busy pair or the other primary opportunities. The audit stops
**before parsing candidate MIDI events or selecting any pair**. Searching exposed
recordings for an easier occurrence would not remedy this independent-source
requirement. No external dataset was downloaded.

```text
selectedPrimaryOccurrences = 0
selectedSourceRateTrials = 0
selectedRapidSinglePair = null
selectedRepeatedChordPair = null
repeatedChordBusyCoverage = NOT_AVAILABLE_IN_UNUSED_LOCAL_HOLDOUT
```

This does not claim that exposed SMD recordings lack repeated-note/chord material.
It is a source-exposure/topology blocker, not a measured acoustic safety failure.

## Strict Pair Contract

The new version's metadata helper accepts only normalized `[p] -> [p]`, or exact
equal normalized chords of at least two pitches. Partial overlap, a chord subset,
and single-to-chord transitions are rejected. An explicit pair binds both gesture
IDs/onsets, both complete normalized sets, recording ID, audio/MIDI hashes and
gap, with immutable deterministic identity. The existing 200..250ms band is kept
as metadata topology, not acoustic policy.

The old loose helper and v26/v27 evidence remain historical and are not imported
by this new version. No compatibility wrapper, analyzer or alternative runtime
was added. Focused tests cover all three user-provided overlap counterexamples.

## Execution Accounting

- New neural runs: **0**; invalidated neural runs: **0**.
- Audio PCM decoded: **false**. Only archive bytes and WAV headers were read.
- Candidate model outputs/scores opened by selector: **false**.
- No primary corpus/scenario/scorer acceptance freeze was created.
- Input-preservation qualification: **NOT_STARTED**, no selected scored events.
- Continuous engineering/musical/controller regression: **NOT_STARTED**.
- STEP Stage A/seal/Stage B: **NOT_STARTED**.
- Full frontend/static/build/Docker suite: **NOT_STARTED**, preflight blocked.
- Safety counters/usability/latencies: **NOT_MEASURED**, not zero or PASS.
- Focused preflight tests: **2 files, 14 passed, 0 failed**. The TAP output,
  timestamps and exact counts are in `preflight-tests.tap` / `preflight-tests.json`.
  This is not full static verification, CI, or product/acoustic acceptance evidence.

## Protected State

H remains exactly **50ms**, candidate only, not qualified. Product source diff
under `apps/customer-web/src`, `apps/customer-web/public`, and `backend/app` is
empty. Robust bytes, decoder, FIRs, geometry, capture transport, Continuous and
STEP/MIDI semantics are unchanged. No microphone permission was requested.

```text
Continuous = MODEL_NOT_VALIDATED
STEP = ATTEMPT_ANALYZER_NOT_VALIDATED
productionMicrophone = false
D4 = false
```

No acoustic safety, physical hardware, UX SLO, commercial or universal detector
claim is made. Continuing primary qualification requires authorized access to
previously unexecuted paired source recordings. This phase does not substitute
exposed secondary regression sources for primary holdout and stops here.

GitHub state is recorded separately; local focused checks are never called CI PASS.
