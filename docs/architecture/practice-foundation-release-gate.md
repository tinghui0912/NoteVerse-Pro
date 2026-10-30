# Practice Foundation Release Gate

> Historical Round56 gate, superseded by the explicit Round57 product-domain decision.
> It audits its recorded HEAD only. Current artifact2/STEP9-v12/Result7 piano-key
> architecture is defined by the [canonical contract](practice-piano-key-contract.md);
> this document is not a current final release approval.


Audited production HEAD: `66b2a050da34616e826817c58330909e50e5adbb` (Round55), on
`refactor/practice-foundation-v2`, repository `tinghui0912/NoteVerse-Pro`, PR171.
Round56 records the consolidated gate; it changes no production, tests, parameters,
schemas, identities or workflows. This is a local correctness/integrity disposition,
not device qualification, merge approval or permission to publish new product claims.

## Topology and review snapshot

- Audit started on the exact approved HEAD with a clean working tree and no commit
  after Round55. Its parent is `6abe59f36a33f6b3a76a5864ce3f2b345c5dc710`.
- GitHub main, local main and origin/main agree at
  `73e8ab77cd7aefa0fd717316da7840f73a98222b`. Audited baseline is **ahead84/behind0**;
  no main update is required or performed. The recording commit adds one docs-only
  commit to this baseline; it does not change the audited production tree.
- [PR171](https://github.com/tinghui0912/NoteVerse-Pro/pull/171) is Draft/open/unmerged.
  At inspection there are0 submitted reviews and0 review threads, hence0 unresolved
  threads and0 submitted change-request reviews. This is not independent approval.
- Eight automatic validation jobs on this exact audited HEAD have runner_id0,
  empty runner_name and steps=[]; two trusted-main publication jobs are skipped.
  They failed before execution. No rerun/dispatch or infrastructure change is made.

Hosted CI did not execute.

This remains an infrastructure/release-process limitation. Local passing tests
neither substitute for hosted execution nor authorize marking the PR ready/merging.

## Code and integrity gate

Production was reread alongside the existing regression/AST guards. The
[product contract](practice-product-contract.md), [resource semantics](practice-acoustic-resource-semantics.md),
[pitch contract](practice-piano-key-contract.md) and
[identity boundary](practice-acoustic-identity-boundary.md) retain detailed proofs.

| Gate | Current production evidence and disposition |
| --- | --- |
| Architecture / score blindness | SourceAnalysisOptions, SourceChronology, QualifiedSourceAdapter, planner, decoder and sourcePublication have no score/target/verdict input. Dependency/cycle guards preserve the direction; STEP/MIDI assembly is score-blind, with comparison only in the mode domain |
| Physical chronology / clocks | [source-chronology.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-chronology.ts) enforces sequence, contiguous source indices and stable AudioContext origin. [continuous-projection.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/continuous-projection.ts) owns separate source-region/performance segments. Event/source coordinates and availability timestamps remain separate; pause/count-in never reset physical source history |
| Acoustic publications | [source-publication.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts) retains exact affine mapping/safe-integer defense, integer21..108 plus exact decoder-owned pair identity, unique IDs, ordered half-open ownership and failure terminality. Producer copies/freezes all owned pitches; synchronous delivery forbids async/reentry. The deleted post-canonical regex has not returned |
| Real context / ownership | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) requires real available PCM for every window/tail, with adapter-derived firstUsable support and no qualified padded tail. [acoustic-engine.ts](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-engine.ts) serializes one lease/inference transaction and retires in-flight work before reuse; session/model-worker tokens and busy guards remain |
| STEP | [runtime.ts](../../apps/customer-web/src/lib/practice/step/domain/runtime.ts) performs whole-artifact assertion → inclusive scope resolution → all selected attack-set compatibility → session initialization. Targets are nonempty D280/count<=existing raw128 using asserted uniqueness, not a second Set/sort. Compatible sections ignore incompatible unused targets. Continuation is outside attack equality |
| Evidence / progression | Evidence remains ordinary dense own-entry/nonempty/raw<=128/D280. Raw129 rejects before indexed reads; sparse/inherited holes fail closed with the same ANALYZING attempt retryable. [attempt.ts](../../apps/customer-web/src/lib/practice/step/domain/attempt.ts) keeps Set+sort normalization and structural cardinality/member equality. MATCH advances once at rearm, MISMATCH stays, Skip is separate, no subset/target-assisted early acceptance |
| Source identities | [Browser MIDI](../../apps/customer-web/src/lib/practice/midi/browser-midi-controller.ts) and STEP input enforce canonical integer0..127 facts before retention. Acoustic producer/sequence enforce canonical21..108 pairs before STEP retention. D280 is deliberately separate; E#4 direct evidence is not repaired/canonicalized or falsely promised source reachability |
| Lifecycle / failure ownership | STEP_TARGET_INVALID projects to existing STEP_SCORE_UNAVAILABLE for either source. MIDI fails before binding/metronome creation. Microphone acquisition still precedes constructor validation; existing catch/cleanup releases input/inference/context while leaving borrowed roots live. Epoch/state/attempt fencing rejects stale input/timer/worker/capture/context callbacks; cleanup failures remain visible and cannot produce successful completion |
| Terminal semantics | STEP terminal analysis and infrastructure interventions remain distinct; same-root temporary mute is separate. STEP natural completion latches before late failures. Continuous natural completion/End ordering, real-tail finalization and cleanup remain explicit; post-COMPLETE failures cannot replace a result. Failures during unfinished finalization are not disguised as successful healthy analysis |
| Full accepted evidence / resources | ContinuousEvidenceStore stages validation/assignment before retaining all accepted observations; no truth cap/truncation exists. H35/H50 retain the complete owned gesture, not session history or out-of-attempt input. Target-ring overwrite is covered by retention proof; source-ring56/61 and first-real10 derive from FIR. R01/R03/R04 fail closed rather than silently coalescing/dropping accepted truth. Only compact diagnostic histories roll over |
| Timing / matching | W250 and MIDI grace250 remain separate policies; same-pitch matching is inclusive ±250ms with max cardinality → min absolute error → lexicographically earliest chronological noncrossing reconstruction. H35/H50 remain fixed score-blind half-open gestures. Exclusive STEP eligibility, RUNNING-only performance mapping, count-in/pause and terminal capture coordinates remain intact |
| Confidence / calibration | Decoder onset/frame policies are unchanged, confidence is retained metadata (not calibrated probability), and no second confidence gate is added to STEP or Continuous matching. Timing provenance explicitly records calibrationApplied=false; there is no fitted latency correction or target-aware source filtering |

No current reproducible correctness, integrity, ownership, lifecycle, schema or
fail-closed release blocker was found. This is the result of the specified audit
and local checks, not a proof against arbitrary hostile JavaScript objects or all
possible physical/browser behavior.

## Current schemas and independently recomputed identities

STEP is schema8 / `step-exact-pitch-learning-v11`; artifact is schema1; Result is
schema6. Result provenance shape and current-only acoustic reader remain unchanged;
there is no undocumented migration, old/new dual-current identity or policy field.
The Round51 comparison and Round52 dense-entry behavior remain in force. The
historical delimiter target now fails STEP compatibility before interaction,
while its structurally different set still cannot compare equal.

Independent Node crypto computation reads committed blobs, normalizes text only
CRLF→LF, hashes UTF-8, and sorts canonical JSON object keys independently of the
production helpers. All discovered current file attestations (including raw binary
FIR assets), declarations, model-contract core reference and nested adapter core
references agree; no attestation scope or value is changed.

| Selected identity | Bytes | Recomputed SHA-256 |
| --- | ---: | --- |
| publicationSource |8279| `6938e9409d2dd24abd5f4ed687c55e728360b7c3586935d118fb75cbf54c17b1` |
| executorSource |12679| `2358e17f59c175f1182be9430cc43758581cd8dabc9b0cff9838ded6941f7f8a` |
| decoder authoritativeSource |2882| `74db01c44726c0283ae5a13a5615ed68506b5a7637c26eeed6ec945023b17a91` |
| canonical acoustic core | — | `55035819bf38bce2aad09ed7f9cbbcab4c7ea342c41fd39d1d574e0bfc06f533` |
|44100 adapter composite| — | `58a2fbdf14bb482abb551cf355c80f6eb415732297c23c1ac38ecb47ffebd2fe` |
|48000 adapter composite| — | `a93e190fd951ff1a69e9613278bd7d664dfb8c3132c6fe23de4f4995118d1a51` |

Model asset identity, FIR/planner/adapter implementation and their declarations
are unchanged. This round does not claim a new ONNX download, physical-device
inference/permission probe, recognition calibration or end-to-end latency measurement.

## Ledger disposition: present failures versus deferred claims

The [93-row ledger](practice-acoustic-parameter-provenance.md) is unchanged, with
one primary evidence class per row: verified18, algorithm19, structural24,
redundant12, empirical2, resource-safety11, diagnostic7, semantic-unresolved0.
Row IDs and all class memberships are independently checked, not recounted from
the summary alone. A ledger statement that an integrity *mismatch would block*
does not assert that such a mismatch exists now: those guards currently pass.

For release disposition the five possible non-KEEP categories mean exactly:
RELEASE BLOCKER — correctness/integrity; RELEASE BLOCKER — unsupported required
product claim; DEFERRED QUALIFICATION — current behavior may ship only without
the unproven claim; DEFERRED REDESIGN — not needed for current correctness; and
DIAGNOSTIC/PRESENTATION ONLY. Each remaining row has **one** primary disposition
below. These are gate dispositions, not changes to ledger evidence classes.
Where a row also contains a live integrity guard, the disposition covers its
remaining optional work/claim; the guard remains mandatory and currently passes.

| Disposition | Row IDs | Gate consequence / missing evidence |
| --- | --- | --- |
| RELEASE BLOCKER — correctness/integrity | None | No current defect/mismatch reproduced; future broken guards, lost accepted truth or identity drift would block |
| RELEASE BLOCKER — unsupported required product claim | None | No such current Practice promise found in the audited contract/live presentation |
| DEFERRED QUALIFICATION | M04, M05, M07, M14 | Selected runtime/provider/model time descriptors do not establish cross-device stability, physical timing or recognition quality |
| DEFERRED QUALIFICATION | D01, D02, D03, D05, D06, G01, G02 | Decoder/gating/confidence and context/cadence remain current algorithms; require learner/model/device evidence before accuracy/probability/optimality claims |
| DEFERRED QUALIFICATION | S01, S05, S12, S13, S16 | Shipped rates/FIR facts and numerical parity do not establish universal capture/filter/edge/mapping quality |
| DEFERRED QUALIFICATION | T03, T07, T08, T09, T12, T13, T17, X03 | Timing windows, MIDI delivery grace, timestamp latency, gesture grouping, responsiveness and preroll need separate physical/learner evidence; no retuning |
| DEFERRED QUALIFICATION | S17, T15, R06, R08, R14, R15, R16, R17 | Raw192/raw128, transport2048, target ring65536 and deadlines remain unqualified budgets. Finite admission/liveness stays fail closed; no universal workload/headroom/SLO claim |
| DEFERRED REDESIGN | M02, M08, M10, M11, M12, M13, S04, S06, S07, T05, R10 | Optional descriptor/scalar ownership consolidation mentioned in legacy future-action prose; current relationships/identity assertions agree. Repetition alone does not justify changing verified declarations or populate a new DERIVE task |
| DEFERRED REDESIGN | S14, R01, R03, R04 | Optional redundant time-field/representation/admission/backpressure review. Preserve existing fail-closed behavior; outstanding4, pending8 and credits32 are not qualified by this disposition |
| DIAGNOSTIC/PRESENTATION ONLY | N01, N02, N03, N04, N05, N06, N07 | Bounded histories, counters and estimates are not evaluation truth or safety/learner capacity guarantees |

KEEP current implemented contracts (39 rows): M01, M03, M06, M09, D04, D07, G03, G04, G05, S02, S03, S08, S09, S10, S11, S15, T01, T02, T04, T06, T10, T11, T14, T16, T18, R02, R05, R07, R09, R11, R12, R13, R18, I01, I02, I03, I04, X01, X02.

Thus39 KEEP +32 deferred qualification +15 deferred redesign +7 diagnostics cover
all93 IDs exactly once. Primary disposition is not permission to ignore another
facet: T15 still has a deferred canonical-domain/product language decision in
DELETE/REDESIGN as well as raw128 QUALIFY; R01/R03/R04 redesign also retains missing
numeric workload qualification. They are not counted twice or promoted to blockers.
R14's silence mechanism is implemented/KEEP; its deadline remains unqualified.

T15 source identities, structural equality, dense shape, redundant acoustic grammar
deletion and selected-scope target compatibility are resolved. Domain canonical-
language/product policy and raw128 workload qualification remain open. S17 is
KEEP SINGLE OWNER, NUMERIC UNQUALIFIED. S09/S10/S15 remain resolved. Future DERIVE
is **None**; no new cleanup, universal coordinator or parameter tuning is proposed.

## Product-claim gate

The current product contract explicitly limits microphone capability to required
browser/runtime prerequisites, with physical-device quality/latency separately
qualified. Active acoustic feedback says detection support does not prove a note
was not played. Timing provenance explicitly says no calibration. No required
Practice claim of calibrated confidence, universal device/rate support, guaranteed
latency/tolerance, universal memory headroom or a canonical STEP MIDI/piano universe
was found. E#4-style direct compatibility is not represented as source reachability.
Search hits in unused legacy noise strings or separate score-import/home copy are
not current acoustic confidence/latency promises; no unrelated copy is changed.

Do not make those broader claims from this gate, golden parity, passing tests,
model/FIR metadata, normal generated ID lengths or source cardinalities. A later
decision to require such a claim must obtain its missing evidence or becomes an
unsupported-required-claim release blocker. Current explicit algorithm/admission
behavior may remain without claiming optimality/generalization.

## Local evidence and final recommendation

| Executed locally on the audited production tree | Observed result |
| --- | --- |
| Focused acoustic/STEP/Continuous/kernel/architecture/Result tests |1478 passed /59 files |
| Full practice suite |1753 passed /91 files |
| Full Customer Web unit suite |2683 passed /212 files |
| Customer Web typecheck | PASS |
| ESLint with --max-warnings0 | PASS,0 warnings |
| Identity/file/canonical/composite and Result/schema/provenance guards | PASS, included in suites and independently recomputed |
| Ledger row/class/membership/disposition coverage | PASS,93 rows; no ledger edit |
| Documentation guards / structure / links / git diff --check | PASS,11 documentation tests |

Tests exercise controlled browser/worker ports and existing numerical fixtures;
they are not hardware qualification. No backend pytest, E2E, coverage, production
build or hosted-success claim is made in Round56. No production/test fix is needed
by the evidence found; this consolidated disposition and its index link are the
only repository changes warranted.

**FOUNDATION RELEASE GATE PASSED — no correctness/integrity blocker found**

Keep PR171 Draft/open/unmerged pending independent review and the outstanding
hosted execution/release-process gate. Do not start another implementation round
merely to clear deferred qualifications or make the ledger look complete.
