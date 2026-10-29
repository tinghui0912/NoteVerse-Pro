# Practice Acoustic Evidence Identity Boundary

Round 25 establishes this normative contract against approved baseline
`4bf114d75ccab9f26ebcac6ec7b65d24920e225c`. It resolves the identity question in
[resource semantics](practice-acoustic-resource-semantics.md) without changing
production behavior, declaration JSON, identity values, Result schema 6 or the
[93-row parameter ledger](practice-acoustic-parameter-provenance.md).
Identity/hash proves drift resistance, not reasonableness, optimality, recognition
quality, latency qualification or device qualification.

## Normative definitions

1. **Model asset identity** identifies the shipped ONNX bytes by asset ID/version,
   length and SHA-256. [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts)
   and verified model delivery enforce the declared model contract. This does not
   qualify learner accuracy or browser/GPU liveness.
2. **Acoustic evidence core identity**: `ACOUSTIC_ANALYSIS_IDENTITY` and the persisted
   `acousticCoreIdentitySha256` identify the **evidence-producing acoustic semantic
   core**: shipped model, decoder semantics, source resampling/source-event mapping,
   window ownership geometry, successful source publication contents, publication
   source identity and analyzed-through semantics. The
   [core declaration](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json)
   is a versioned declaration/build identity with selected file attestations.
   Those files are selective integrity anchors, not an executable dependency closure
   or a semantic-equivalence hash.
3. **Source adapter composite identity** binds the core reference to the configured
   source rate, rational FIR/filter asset, source implementation and rate geometry
   in [source-adapter-identities.json](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json).
   It is neither device calibration nor full capture-runtime provenance.
4. **Timing provenance** identifies event-time mapping and no-input-calibration
   policies in [timing-provenance.ts](../../apps/customer-web/src/lib/practice/continuous/timing/timing-provenance.ts).
   Acoustic Source Time, mapped Performance Time, Session Time and analysis
   availability remain distinct coordinates. No measured hardware offset or
   end-to-end timing accuracy is claimed.
5. **Runtime admission/liveness policy** governs bounded resource ownership,
   capture transport, readiness observation/deadlines, RPC silence and engine lease
   retirement. These policies affect availability/failure and are deliberately
   outside the current evidence core provenance boundary.
6. **Application failure/intervention behavior** governs transport freezing,
   resource release, retained session truth and explicit learner choices. STEP and
   Continuous application controllers own it. It is outside the acoustic evidence
   core and is not persisted as an intervention snapshot in Result.
7. **Result evidence provenance** means **the configured evidence-producing
   semantics used/intended by the attempt**. It is not full execution provenance
   and cannot alone replay all causes of COMPLETE, UNAVAILABLE, intervention,
   timeout or hang. MIDI has its physical-event/timing provenance; microphone has
   the configured acoustic evidence stack and timing provenance.

## In-scope and out-of-scope matrix

“Inside” describes the declared provenance concern, not every behavior in an
attested file. Some selected files also contain resource checks; their byte hashes
can change incidentally when those checks change. That sensitivity does not turn
this identity into a runtime-policy contract.

| Concern | Current owner | Inside acoustic core hash? | Present in Result evidenceProvenance? | Why | Future change rule |
| --- | --- | --- | --- | --- | --- |
| ONNX bytes and descriptor/runtime declaration | model-contract.ts; acoustic-core-identity.json; verified model delivery | Yes: model digest/contract, not ONNX embedded bytes | Yes: modelSha256 and core reference | Identifies shipped evidence model | New model/contract requires explicit evidence identity update |
| Decoder thresholds and logic | robust-piano-decoder.ts; core decoder declaration | Yes: declaration and selected source attestation | Yes: decoderSourceSha256 and core reference | Determines accepted pitch/onset evidence | Change evidence identity/provenance; never infer equivalence from old hash |
| Window geometry/ownership | window-planner.ts; core ownership declaration | Yes | Yes: through core reference | Determines model context and half-open ownership | Update affected core attestation/declaration and composites |
| FIR/source mapping | source-adapter.ts; both FIR assets; source-adapter-identities.json | Yes: selected source/assets and geometry | Yes: core, sourceSampleRateHz and sourceAdapterIdentitySha256 | Determines source coordinates and resampled input | Update affected evidence identities/composites |
| Source publication identity/content/analyzed-through | source-analysis-runtime.ts; source-publication.ts | Yes: semantics and selected file attestations | Yes: through core reference | Defines successful source observations and coverage facts | Semantic changes require evidence identity review and attestation updates |
| Resource-policy caps, including target-ring safety headroom | acoustic/runtime/resource-policy.ts | No policy identity; executor is a selective anchor | No | Bounds admission/retention/failure, not the declared successful evidence meaning | Review resource semantics; separate runtime-policy owner if reproducibility is required |
| Worklet block/credits | capture-transport-contract.ts; capture.worklet.js | No | No | Transport format/backpressure/liveness policy | Same separate runtime-policy rule; no automatic evidence identity cascade |
| Boundary cap/queue failure | resource-policy.ts; capture-bridge.ts | No | No | Controls capture admission/failure | Round30 proves finite fail-closed admission necessary; representation/numeric8 remain unqualified, independently of evidence identity |
| Pending region lifecycle (explicit cap deleted in Round29) | source-analysis-runtime.ts | No runtime-policy identity; selected executor bytes remain an anchor | No | Structurally bounds pending planning retention with immediate empty retirement | Round29 deletes explicit cap after structural lifecycle proof; executor byte change still advances anchors |
| Outstanding inference cap | resource-policy.ts; source-analysis-runtime.ts | No cap policy identity | No | Controls queued/active copied PCM and failure | Review R01 ownership before tuning; attested executor edits still update byte anchors |
| Readiness observation/deadlines (local notifications; 10s/15s/60s) | capture.ts; ContinuousMicrophoneInput | No | No | Observes readiness and bounds some waits, not source event timestamps | Review necessity/liveness independently; no timeout addition in this round |
| Worker RPC liveness and engine retirement | worker-client.ts; model-inference.ts; acoustic-worker.entry.ts; AcousticEngine | No | No | Owns response/lease lifecycle, including silent pending states | R14 silence fuse is outside this core; stronger outcome-replay requirement needs separate provenance |
| Controller failure/intervention behavior | ContinuousPracticeController; STEP application controllers | No | No | Owns performance/session failure disposition | Application changes do not redefine evidence core; future runtime-policy contract is separate |
| Event-time mapping/no calibration | continuous/timing/timing-provenance.ts; acoustic source mapping owners | Acoustic source mapping is inside; session timing policy is separately identified | Yes: timing | Separates physical event coordinates from assignment and availability | Update the affected timing/evidence policy explicitly; no calibration implied |

## Hash interpretation and integrity layers

Canonical UTF-8 JSON hashing binds the declaration. It does not read or prove the
repository files named by that declaration. Node-side
[attestation tests](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.test.ts)
separately check path/bytes/SHA against current files: text uses only CRLF-to-LF
normalization; FIR assets use exact binary bytes. Approved `adf43ba6` repaired this
declaration-to-current-files gap; it did not qualify parameters or establish
transitive closure. Browser `assertAcousticIdentity()` does not use filesystem APIs.

The declared current-file anchor set is source-analysis-runtime.ts,
source-publication.ts, robust-piano-decoder.ts, window-planner.ts, source-adapter.ts
and the two FIR assets. Adapter composites repeat source/filter anchors. Model
bytes have their separately verified model digest. The excluded resource,
transport, input/controller, worker/client and engine files remain important
executable dependencies; their exclusion is now a deliberate provenance contract.
They are not transitive dependencies **for evidence-core provenance purposes**.

A behavior-neutral byte edit to a selected file can change the core digest and
mechanically cascade adapter digests. Equal successful publication contents do not
require equal hashes. Conversely, unchanged core hashes do not imply equal complete
execution behavior: excluded admission/liveness policies may differ. The hash is
not a bidirectional semantic-equivalence relation. Evidence-semantic changes must
be reflected in the appropriate declaration/selected attestation/composite/timing
identity even when the old selection would not mechanically detect an edit; the
selective guard does not replace semantic review.

## Result interpretation and concrete examples

The exact MICROPHONE provenance shape remains:

```text
inputSource
acousticIdentityName
acousticCoreIdentitySha256
modelSha256
decoderSourceSha256
sourceSampleRateHz
sourceAdapterIdentitySha256
timing { eventTimeMappingPolicyId, calibrationPolicyId, calibrationApplied }
```

For **COMPLETE**, this identifies the configured stack that produced accepted
acoustic evidence (which may include silence/no matching target evidence). For
**UNAVAILABLE**, it identifies the stack configured/intended for this attempt;
it does not assert that analysis successfully published any evidence. The shape
and identities can be identical across these evaluation outcomes. Schema 6 stays
unchanged, with current-only exact-key validation and no compatibility reader.

**Example 1 — resource admission changes:** change only a cap in the excluded
resource-policy.ts, leaving declaration/selected files unchanged. A workload that
completed under one build may fail under the other and, after the learner's valid
degraded continuation and natural completion, yield UNAVAILABLE. Current evidence
provenance can be identical. This is not provenance corruption: the contract never
promised full execution/outcome replay. Some failures can instead prevent a Result
entirely; provenance is not a persisted record of every failure/hang.

**Example 2 — evidence semantics change:** a decoder threshold or source-time
mapping change affects accepted evidence/time meaning. It must change the affected
acoustic/timing identity and resulting provenance, with selected attestations and
adapter composites updated as appropriate. Treating it as merely a resource-policy
change would violate this contract. This round makes neither kind of change.

## Future runtime-policy provenance rule

If the product requires a persisted attempt to explain reproducibly why a particular
build produced COMPLETE, UNAVAILABLE, intervention or timeout, introduce a
**separate, versioned runtime-policy provenance owner**, with an explicit product
and Result-schema decision. It may identify admission/resource policies, transport
backpressure, RPC liveness/deadlines and controller failure disposition. A policy
identity alone would still need relevant execution inputs/observations to explain
an outcome; an attempt that never completes cannot be represented by a nonexistent
Result without a separate persistence decision.

Do not insert that future owner into or redefine the existing evidence-core hash.
No runtimePolicySha256, resourcePolicyId, livenessPolicyId, execution identity,
new schema, fallback, migration or compatibility acceptance is introduced here.
The current Result boundary is enforced by
[provenance tests](../../apps/customer-web/src/lib/practice/result/continuous-result-provenance.test.ts)
and [dependency tests](../../apps/customer-web/src/lib/practice/architecture/dependency-boundaries.test.ts).
Resolving identity scope does not qualify any resource number. Round29 independently
resolves R02 through structural deletion, as noted below. Round30 independently proves
R03 finite admission necessary in principle; numeric8/representation and R01/R04
workload/stall evidence remain unqualified by identity scope or those proofs.
Round28 deletes R18 polling in the non-core Continuous bridge/input; readiness
notification and unchanged R16/R17 safety deadlines remain outside this core. Round27 separately adds an unqualified R14 silence safety fuse;
that runtime policy remains outside this evidence core. Round31 deletes the dead
maxUnacknowledgedBlocks alias without changing R04's authoritative transport policy
or any selected attestation/core/composite identity value.

## Round29 selective-attestation byte sensitivity

R02 explicit pending-region count cap removal and exact empty-region retirement
change runtime admission/lifecycle policy. Because source-analysis-runtime.ts is
one selected integrity anchor, its bytes/SHA change mechanically advances the
canonical core declaration digest and both source-adapter composite digests. This
does not mean decoder, model, window geometry, FIR or source-event mapping evidence
semantics changed. The semantic declaration remains unchanged. Result schema6 and
evidenceProvenance keys are unchanged; current identity values advance under the
same current-only reader. No runtimePolicySha256 is introduced and full runtime
outcome replay remains outside evidence provenance. This does not redefine the
Round25 boundary or qualify any retained resource number.

## Round32 diagnostic derivation and selected-byte identity advance

R11 replaces only the snapshot diagnostic multiplier's repeated4 with
R.maxOutstandingWindows. Both maximumOutstandingInputBytes and its meaning remain
465920 bytes under the unchanged R01/inputBytes owners. Admission, extraction,
worker scheduling, source publication and evidence semantics do not change.
Nevertheless the selected executor file's bytes/SHA change, so its attestation,
canonical core digest and both adapter composite digests mechanically advance.
Model/decoder/FIR/planner/source-adapter/source-publication implementations and
semantic declarations are unchanged. Result remains schema6 with identical
provenance keys and no runtime-policy/execution field. This is selected-byte
attestation sensitivity, not a scope expansion or a semantic-equivalence claim.

## Round33 source-block relationship and selected-byte advance

R07 removes its duplicate resource-policy field. SourceChronology and the executor
directly reference R06's unchanged transport-block contract, preserving upper-bound
admission and smaller valid source chunks. This is implementation derivation, not
an evidence or transport-format change and not qualification of numeric2048.
The executor's import/comparison bytes change, mechanically advancing selected
file attestation, canonical core and adapter composite digests. No new selected
file or transitive policy attestation is added. Model/decoder/FIR/planner/source
adapter/publication semantics remain unchanged; Result schema6 and provenance keys
remain unchanged with no transport/runtime-policy or execution identity field.

## Round34 STEP guard deletion without an identity advance

The STEP acoustic attempt assembler is outside the selected evidence-core file
attestation set. Removing its T14 guard, proved unreachable for accepted source
streams by upstream publication bounds and H50/window/region topology, changes
implementation but not accepted-contract runtime/product behavior. No evidence
producer, selected executor/publication/decoder/planner/adapter/FIR file or semantic
declaration changes. Core/executor/composite/model identities remain unchanged;
Result stays schema6 with identical provenance shape and no new policy field.

## Round35 resource-policy derivation without an identity advance

R09 derives PCM payload byte accounting in resource-policy.ts from existing model
geometry and Float32Array width. That resource-policy file is not a selected byte
anchor; importing model-contract does not make attestation transitive. No selected
file/declaration changes, so executor/core/composite/model identities remain unchanged.
Round25's scope and Result schema6/provenance shape remain unchanged; no resource,
byte-policy, transitive-dependency or execution identity is introduced.

## Round36 selected diagnostic-expression byte advance

Only target-ring byte reporting in the selected executor changes expression,
directly using the existing Float32Array representation width. Its numeric payload
report, ring allocation/retention/admission and evidence semantics are unchanged.
Executor attestation bytes/SHA therefore advance, followed by the canonical core
digest and both adapter composite digests. This is mechanical selected-byte
sensitivity, not an expanded evidence-core scope or a new Float32/byte-policy
identity field. Result remains schema6 with unchanged provenance keys; no resource,
runtime or execution-policy provenance is added.

## Round37 selected source-rate consumer advance

Executor and publication source replace duplicated16000 mapping literals with the
existing model sampleRateHz declaration, preserving operation order, safe-integer
validation, rounding and evidence semantics. Both selected source bytes/SHA advance,
so canonical core and adapter composite digests mechanically advance as well.
Two nonselected Continuous projection source→target consumers also derive from the
same existing authority; no samples/ms or Performance-Time formula changes.
Planner bytes/SHA, model rate/asset, decoder, FIR, adapter implementation and all
semantic descriptions remain unchanged. Identity scope is not expanded. Result
stays schema6 with identical provenance keys and no conversion/execution-policy field.

## Round38 derived target samples/ms and selected-byte advance

The model contract exports only the derived relationship
ACOUSTIC_TARGET_SAMPLES_PER_MS=ACOUSTIC_MODEL.sampleRateHz/1000, not a new rate
declaration, policy or provenance field. Runtime/planner/source validation and
Continuous evidence projection use its exact16 value while preserving consumer
operation topology and Float64 boundaries. Existing selected executor/publication/
planner bytes/SHA advance, mechanically cascading canonical core and both adapter
composites. Nonselected Continuous publication and worker model-validation remain
outside the attestation path set. No declaration scope or evidence semantics change;
model/decoder/FIR/resampler meanings and Result schema6/provenance keys stay unchanged.

## Round39 unit-definition closure without an identity advance

R12's remaining1000 uses are explicit seconds↔milliseconds definitions, not new
model/resource/timing owners. Round39 keeps their local arithmetic and all derived
relationships unchanged, closing only documentation/ledger status. Production
implementation and selected executor/publication/planner bytes stay unchanged, as
do canonical core, adapter composites and model asset identity. No units constant,
attestation scope expansion, conversion/runtime-policy identity or Result field is
introduced. Result remains schema6 with the same provenance shape.

## Round40 engine smoke derivation outside selected anchors

Engine smoke PCM/window geometry derives locally from existing inputSamples,
futureMs,ownedMs and target samples/ms, preserving its exact values and validation.
Production implementation changes in acoustic-engine.ts, which is not a selected
evidence-core byte anchor. No selected source/declaration changes, so executor,
publication,planner/core/composite/model identities remain unchanged. No planner
import, pastMs ownership, engine-source attestation or new geometry identity is
introduced. Identity scope and Result schema6/provenance shape are unchanged.

## Round41 derived-and-checked canonical past description

fullWindowPastMs remains in the canonical identity as a derived-and-checked
description; it is no longer mirrored by ACOUSTIC_MODEL.pastMs. The identity guard
checks inputMs−ownedMs−futureMs, currently1820−600−170=1050ms, without creating a
shared geometry owner. The retained JSON field is human-readable description,
not an independently tunable or empirically optimal context policy.

model-contract.ts is outside the selected byte-attestation anchors. Removing its
unused redundant property and deriving the guard relationship changes internal
model-contract shape but leaves canonical JSON bytes and all selected source
anchors unchanged. Core/adapter composite identities and Result provenance values
therefore remain unchanged. No model-contract source attestation, new geometry
identity, schema migration or provenance field is introduced; Result stays schema6
with the same shape, and attestation scope stays unchanged.

## Round42 FIR-derived origin boundary and mechanical attestation advance

S10 centralizes an existing structural FIR-support relationship: the adapter
computes ceil(center/down), currently10 at both supported rates, and supplies it
to the PCM ring. Extraction, region admission and preroll consume the ring's
single usable-retention boundary. This does not change FIR coefficients, float32
accumulation/emission, source mapping, evidence/publication or geometry semantics.
It makes no recognition/device/latency qualification claim.

The existing selected source-adapter, executor and planner anchors change bytes.
Their normalized UTF-8 attestations (CRLF→LF only) are recomputed; the adapter
implementation attestation updates in the core and both adapter declarations.
Canonical core and both composite digests then mechanically advance. Binary FIR
assets and seeded numerical golden outputs remain exact and unchanged. No new
identity anchor, origin-policy identity, field or scope is added; Result remains
schema6 with the same provenance keys. This is selected-byte sensitivity, not a
new semantic-equivalence or full-execution identity claim.

## Round43 source-ring derivation and selected-byte advance

S09 derives the private adapter source ring from actual coefficient count and up:
ceil(L/U), currently56/61 samples. Allocation and both modulo indices share
ring.length. Only private support storage and its diagnostic payload accounting
shrink; FIR numerical results, emission/readiness, source mapping and S08/S10
first-real semantics remain unchanged. No admission/device/headroom qualification
or new source-ring policy/provenance field follows from this derivation.

The selected source-adapter implementation changes normalized bytes (CRLF→LF
only). Its existing core resampler.source and both adapter implementation
attestations update, then canonical core and both adapter composites mechanically
advance. Executor/publication/planner attestations, model/decoder/FIR assets and
identity scope stay unchanged. Result remains schema6 with the existing provenance
shape; configured evidence identity values advance through the selected-byte
contract, without a schema migration or runtime outcome-replay claim.

## Round44 exact worker endpoint validation outside selected anchors

S15 removes the independent one-sample endpoint residual slack. Worker validation
repeats Math.round(ownedEndTarget+futureSamples) from the stored Number, matching
the unchanged planner construction and existing engine smoke. Malformed/direct
coupled±1 endpoints now fail even when fixed input width is preserved. Successful
producer geometry, source/evidence mapping and publication semantics do not change;
this is an integrity admission tightening, not learner timing qualification.

model-validation.ts is outside the current selected source byte-attestation set.
No selected source or declaration JSON changes; executor/publication/planner/adapter
attestations, canonical core, model and both composite identity values remain
unchanged. Attestation scope is not expanded. Result remains schema6 with the same
provenance shape and configured evidence identities; no numerical-policy field,
new execution identity or compatibility/schema migration is introduced.
