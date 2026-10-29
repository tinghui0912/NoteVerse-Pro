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
| Boundary cap/queue failure | resource-policy.ts; capture-bridge.ts | No | No | Controls capture admission/failure | Review R03 independently; cap8 remains UNRESOLVED |
| Pending region cap | resource-policy.ts; source-analysis-runtime.ts | No cap policy identity | No | Controls retained region admission/failure | Review R02 ownership before tuning; attested executor edits still update byte anchors |
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
Resolving identity scope does not qualify any resource number: R01/R02/R03 cap
necessity and R04 supported-stall evidence are not qualified by identity scope.
Round28 deletes R18 polling in the non-core Continuous bridge/input; readiness
notification and unchanged R16/R17 safety deadlines remain outside this core. Round27 separately adds an unqualified R14 silence safety fuse;
that runtime policy remains outside this evidence core. maxUnacknowledgedBlocks remains a deletion
candidate; no cleanup, tuning or liveness redesign starts in this round.
