# Acoustic Runtime Identity and Implementation Attestation

## Identity concerns

| Concern                          | Owner                                                  | Evidence meaning                                                    |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Model asset                      | runtime-contract.json and generated verified delivery  | Exact ONNX bytes and delivery descriptor              |
| Decoder                          | robust-piano-decoder and runtime decoder configuration | Qualified piano pitch/onset semantics                               |
| Geometry, FIR and source mapping | planner, source adapter and FIR assets                 | Tensor context, half-open ownership and physical source coordinates |
| Source publication               | source runtime/publication                             | Immutable all-pitch observations and analyzed-through coverage      |
| Timing                           | Session timebase and segmented clock                   | Event-time mapping and explicit no-calibration policy               |
| Admission/liveness               | resource policy, capture/worker/engine/controllers     | Resource retention, readiness, failure and intervention behavior    |

The analysis identity describes configured product/runtime semantics. Source-adapter
identities describe their own rate-specific resampling facts. Selected implementation
attestations describe repository bytes used for engineering/review evidence. These
identities have separate owners. A transient Continuous Result references evaluation,
its ExecutedPerformance and transient outcome; it carries no implementation-attestation
transport payload.

## Configured runtime identity

[runtime-contract.json](../../contracts/practice/acoustic/runtime-contract.json) owns
model bytes and locator, ORT/provider, tensor descriptors, decoder configuration,
sample geometry and qualified source adapters. The
[runtime generator](../../scripts/generate_practice_acoustic_runtime.py) validates
configuration relationships, the installed ORT version and exact FIR asset bytes.
It generates immutable [browser configuration](../../apps/customer-web/src/lib/practice/acoustic/generated/runtime-contract.ts)
and [Backend model-delivery facts](../../backend/app/modules/model_assets/generated/practice_acoustic_model_asset.py).
Backend delivery does not consume the browser analysis identity.

`ACOUSTIC_ANALYSIS_IDENTITY.analysisIdentitySha256` is SHA256 of the entire canonical
runtime contract: UTF-8 JSON with recursively sorted object keys and unchanged array
order. Its model asset/version label is human-readable deployment information; the hash
identifies configured analysis semantics. `assertAcousticRuntimeIdentity` verifies that
runtime digest. Runtime/model diagnostics use the same configured identity.

Each source-adapter `identitySha256` binds only source/target rates, up/down ratio,
coefficient asset bytes and locator, tap count, real-source lookahead and first fully-real
output boundary. Decoder, model and provider facts do not enter this identity. Exact
FIR byte verification and numerical/golden tests remain independent checks of declared
assets and their behavior. Model delivery verifies model byte length and SHA256.

## Repository implementation attestation

[implementation-attestation.json](../../apps/customer-web/tests/attestations/practice-acoustic/implementation-attestation.json)
owns selected source paths, normalization, byte sizes, SHA256 and engineering scopes.
The independent [repository verifier](../../scripts/verify_practice_acoustic_implementation.py)
checks that declaration against current source bytes. Text normalization replaces CRLF
with LF only, followed by UTF-8 encoding; BOM, spaces and standalone CR remain intact.
Neither the declaration nor source hashes are inputs to production generation or any
runtime/adapter identity. Source edits are checked by repository attestation without
changing configured acoustic identity.

The selected sources are source-analysis-runtime.ts, source-publication.ts,
robust-piano-decoder.ts, window-planner.ts and source-adapter.ts. They cover the declared
source analysis, publication, decoder, planning and resampling evidence. FIR identity
is declared only by runtime configuration; the attestation does not select assets.

Selected-source provenance is not a transitive executable dependency closure. Engine,
worker/client, capture transport, input/controller, resource-policy and intervention
implementations have their own runtime ownership and tests. Hash equality does not
establish algorithm quality, physical-device qualification or identical execution outcomes.

## Evidence owners and timing

`ACOUSTIC_ANALYSIS_IDENTITY` identifies the configured runtime. Each
qualified source rate selects its source-adapter identity. `ContinuousMidiEvidence`
owns its physical MIDI policy identity. Source analysis remains score/target/verdict
blind, and source publication enforces canonical pitch/midiPitch identity before
Practice consumes the numeric key.

Session Time, Performance Time, physical Source Time and evidence Availability Time
remain distinct. Event mapping applies no hardware compensation inferred from
processing delay or availability. Timebase and publication tests characterize the
actual mappings at their owners.

## Integrity limits and change responsibilities

Successful evidence semantics require correct source mapping, chronology, decoder
behavior, immutable observation identity and half-open ownership. Relevant changes
require review of analysis/adapter/timing identities. Artifact identity describes score
content; it is independent of acoustic model identity.

Admission budgets, Worklet credits, worker silence/readiness deadlines, engine lease
retirement and application interventions own availability. The implementation attestation and
source-adapter configuration describe selected source bytes and adapter-local facts;
they do not describe every runtime policy or availability outcome.
Hash validation establishes drift resistance, not the reasonableness, optimality or
qualification of any parameter. See the [parameter evidence](practice-acoustic-parameter-provenance.md).

## Failure Representation

The source executor preserves an Error cause directly and wraps a non-Error cause in
`AcousticAnalysisError` with the closed `ACOUSTIC_INTERNAL_FAILURE` code. Adapter
boundaries project known acoustic preparation and inference codes into typed causes.
The implementation attestation identifies the selected executor source bytes. Analysis
and source-adapter identities describe configuration and adapter-local facts respectively. Diagnostic source
summaries carry no authority to classify application failures. See
[failure boundaries](practice-failures.md).
