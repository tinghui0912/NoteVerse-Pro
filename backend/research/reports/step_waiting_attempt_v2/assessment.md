# Waiting-attempt v2 qualification assessment

Disposition: `STEP_ACOUSTIC_WAITING_ATTEMPT_SAFETY_NOT_ESTABLISHED`.

## Blocking requirement

This is a qualification corpus/timing limitation, not an observed product architecture violation or an observed dangerous acoustic MATCH. Ten of thirty rate-cases have their intended physical MIDI opportunity before actual warm READY. Three required families have **no valid waiting trial at either source rate**: `extra_chord_tone`, `rapid_retrigger`, and `busy_period_input`. Their nominal outcomes cannot establish the requested waiting-user gate. No usability percentage threshold was invented; the missing evidence is execution of the required waiting topology itself.

The fixed candidate and corpus will not be adjusted after these outputs. H remains 50ms. No new H, trigger, decoder threshold, model, source replacement or product integration follows this result.

## Prospective proof

- Starting HEAD: `a361f03dd03a13c7bcd36981e1fe9227407f2c89`.
- Final source/tooling commit: `488a54a3` (full identity in freeze).
- Acceptance-cycle freeze: `cb83bffdbb482ac08ba6bd4e12a37c4714b8a41e`.
- Freeze SHA256: `d21c2156130de620b7b098428867d41f2b78bd8077ca78415f9fa2ef7516566f`.
- Static remote verification: `2026-10-17T21:12:19.711Z`; execution start: `2026-10-17T21:12:20.039Z`.
- Stage A remote verification: `2026-10-17T21:15:08.419Z`; execution start: `2026-10-17T21:15:08.757Z`.
- Read-only acoustic seal: `2026-10-17T21:15:32.573Z`, SHA256 `3a3cc0c30b25719953ff35d2aadfd60cc9e62792113f2779a7834698ef54c8aa`.
- Stage B remote verification: `2026-10-17T21:15:43.787Z`; execution start: `2026-10-17T21:15:44.111Z`. Its output records the later truth-open time.

Every execution receipt retains its own freeze and pre-execution remote proof. Earlier freezes are not inherited: f1's shared-Worker job-counter error was explicitly invalidated after four holdout neural runs; f2's millisecond coverage comparison was invalidated by metadata-only preflight before any holdout neural run. Source-sample coverage and one monotonic research request allocator repaired these tooling defects without modifying production. Original receipts are preserved separately.

## Frozen corpus and isolation

Fifteen MIDI-selected cases, thirty rate-cases, unchanged through all three freezes. Exact original audio/MIDI hashes, selected ranges, source-disjoint exclusions, PCM hashes and selection rules are in `metadata-audit.json`, `truth.json`, `jobs.json`, and the freeze.

Source IDs:

- `Bach_BWV849-02_001_20090916-SMD`
- `Bach_BWV875-02_002_20090916-SMD`
- `Bartok_SZ080-02_002_20110315-SMD`
- `Haydn_HobXVINo52-02_008_20110315-SMD`

These recordings exclude preceding STEP development IDs/audio hashes/MIDI hashes, but SMD was previously exposed to AMT/Continuous work. This is not globally blind or new scientific evidence. No dataset download or raw audio/MIDI commit occurred.

Stage A served only whitelisted PCM/FIR/model/ORT/JS assets. The sealed browser bundle input inventory contains no STEP runtime, score fixture, MIDI or truth. Integrity verification hashes frozen input files but does not expose their semantic contents to the browser. Only Stage B parses truth and creates counterfactual targets after verifying the acoustic seal. Candidate assembly is score-blind; the production STEP runtime owns every verdict.

## Actual execution

Headed branded Chrome, one real production Worker/model session for all thirty holdout jobs, 120 actual `InferenceSession.run` executions. One uninterrupted source region per independent recording case, never per semantic attempt. Every source region drains with zero outstanding work. Four windows per job. Model is exactly 98,689,283 bytes, SHA256 `4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3`, ORT Web 1.20.1, WebGPU, automatic fallback false. FIR/decoder/window identities unchanged.

Current-freeze real neural accounting: Continuous engineering 18 + musical/controller 76 + holdout 120 = **214**. Including invalidated f1's 18 + 76 + 4, the entire phase executed **312** real neural runs. f2 executed zero. Fake inference, graph compilation, model load, product-only replay and DSP operations are not counted.

Continuous prerequisite: engineering 8/8, musical 8/8, production-controller replay PASS, semantic parity PASS. No chronology rejection occurred in either full engineering execution this phase. The previous chronology failure remains valid historical evidence; a new PASS does not explain it. The canonical runner now retains the exact rejected chunk metadata if it recurs, with production validation unchanged.

## Safety and usability

All seven deterministic architecture counters are zero on the frozen executions: double advance, busy carryover, late carryover, evidence reuse, equal/stale watermark, second busy attempt, availability changing an existing anchor identity.

All six empirical dangerous-MATCH counters are zero: held/pedal, same-pitch sustain, same-chord sustain, wrong pitch, extra physical pitch and missing expected pitch. These are finite observed zeros, **not universal acoustic safety**. They do not repair missing valid waiting scenarios.

Both rates produced 46 decoded notes, 13 nominal exact-target attempts, and zero negative-guard attempts. Two unique scored negative guards are 1.2s each; rate-weighted execution is four guards / 4.8s. Raw output is unmodified. The counterfactual rows retain full pitch sets and repeated-target sentinels rather than masking later advances with immediate scope completion.

Nominal exact-target corroboration is 26/26; ten trials are invalid waiting opportunities and are not qualified acceptance evidence. Valid positives are 16/16, with four additional valid negative trials. Per requested recognition family, valid exact-target acceptances are:

| Family | Accepted / Valid | Invalid Rate-Cases |
| --- | --- | --- |
| correct single | 1/1 | 1 |
| correct chord | 1/1 | 1 |
| close-spread chord | 2/2 | 0 |
| same-note retrigger | 2/2 | 0 |
| repeated chord | 1/1 | 1 |
| soft-after-loud | 1/1 | 1 |
| rapid retrigger | not measured on valid waiting trials (0/0) | 2 |

Exact invalid identities: q00/44100; q01/48000; q06/both; q08/48000; q09/44100; q10/both; q13/both. `scores.json` retains every warm-ready timestamp and physical truth source occurrence. Example q00/44100: physical intended onset 4082.291666666666ms, warm evidence available 4525.468707530677ms. q10 is intrinsically too close to the selected warm boundary for the fixed future context, even before real inference overhead. No case was shifted or replaced.

Nominal 26-attempt diagnostic latency (simulated advancing source clock plus actual transaction durations, not UX qualification): event-to-availability and event-to-lock median 590.127ms / p95 837.032ms / max 840.962ms. Event-to-verdict median 590.127ms / p95 1602.697ms / max 1611.557ms; this includes the predeclared 1000ms busy/late challenge hold. Invalid waiting trials are included in these diagnostics and explicitly not advertised as qualified usability. No false MISMATCH was observed for nominal exact targets; RETRY classifier was not introduced or qualified.

## Verification and protections

- Vitest: **150 files, 1123 passed, 0 failed**, including ten new focused tests.
- Research/accounting Node: 6 passed; research Python: 4 passed.
- TypeScript noEmit: PASS. Full Next webpack production build: PASS.
- ESLint: 0 errors, 1 existing warning: `scripts/step-boundary/prepare-tooling.mjs:3:6`, `prefer-const`, severity 1, `'text' is never reassigned. Use 'const' instead.` Full fields retained in verification.
- Docker asset unit tests: 4 passed. Docker route tests: 3 passed, with the existing `PytestConfigWarning: Unknown config option: asyncio_mode` retained.
- Protected production source diff: empty across `apps/customer-web/src`, `apps/customer-web/public`, and `backend/app`.
- Twelve copied research browser runners archived byte-for-byte with original revision/Git blob/bytes/SHA256; one canonical active research runner, no forwarding chains.
- Continuous `MODEL_NOT_VALIDATED`; STEP `ATTEMPT_ANALYZER_NOT_VALIDATED`; productionMicrophone false; D4 false.
- Previous blocked assembly/fresh-strike research, 9G-B statistical tie/winner null, and F5 no clear scientific winner remain unchanged.

No physical-device, commercial, scientific-winner, universal detector, UX-SLO or microphone-enablement claim is made. Stop here and await independent audit. GitHub receipt is separate from local qualification; local PASS is not CI PASS.
