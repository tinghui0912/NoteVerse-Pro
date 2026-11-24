# Storage resource governance

This document defines the accepted resource-management boundaries and the dependencies
between their implementation stages. Inventory, logical Usage and durable Quota holds are
implemented boundaries. Category extensions identified as targets remain design requirements.

## Authorities and scope

| Owner | Authority | Excludes |
| --- | --- | --- |
| Storage Objects | Admitted physical object facts, applicable write-intent protocol, retirement | Business readiness, access, quota policy, accounting multiplicity |
| Storage Usage | Logical user/category allocations and rebuildable usage projections | Cloud-provider cost, payment subscriptions, business lifecycle, quota admission policy |
| Storage Quota | Effective storage entitlement, capacity admission, durable capacity holds | Upload/finalization state machines, physical object deletion |
| Business lifecycle | Semantic references, authorization, completion, deletion and retention policy | Independent physical-object or accounting authorities |
| Storage Inventory | Read-only contract/aggregation of domain-owned semantic inventories | Resource mutation, provisioning, object-store scans, transaction commits |

The current quota subject is **User**. No Workspace or speculative multitenant subject
is introduced. Logical usage and physical storage costs are independent: shared physical
bytes can represent several logical allocations, while staging bytes can exist without
an admitted logical allocation. Provider billing metrics are not user quota counters.

`StoredObject` is the sole admitted physical-object fact: key, size, SHA and content type.
A business reference grants semantic ownership; the physical row alone does not grant
access or establish a completed business resource. See [Object storage](object-storage.md)
for exact locks, write generations and retirement delivery.

## Accounting and capacity separation

[Storage Usage](storage-usage.md) owns committed category/account used-byte projections
and immutable audit events. [Storage Quota](storage-quota.md) owns current plan policy,
User entitlement and durable capacity holds. Its reader dependency is the explicit Usage
contract. Application composition supplies both authorities to business workflows and the
existing customer storage-usage endpoint. Neither domain owns business upload state.

Quota models represent HARD_LIMIT and UNLIMITED, with NULL unlimited limits and explicit
finite/unlimited user overrides. FREE is the storage-only 100 MiB policy. Durable
StorageQuotaHold states are HELD, CONSUMED, RELEASED and EXPIRED; only an unexpired HELD
record can be consumed. Terminal identities never reactivate. The canonical Quota contract
specifies constraints, per-user locking, expiry and caller-transaction composition.

PerformanceTakeUploadReservation references its distinct hold through `quota_hold_id`.
Its finalization lease, candidate cleanup and unknown-COMMIT recovery remain business
lifecycle facts. See the [Take reservation contract](performance-take-reservations.md).

## Logical resource categories

| Target category | Counts toward User quota | Current category |
| --- | --- | --- |
| SOURCE | Yes | SOURCE |
| UPLOAD | Yes | UPLOAD for independent Uploads |
| INPUT_ASSET | Yes | INPUT_ASSET |
| PERFORMANCE_RECORDING | Yes | Final Take recordings contribute to UPLOAD |
| DERIVED_RENDER | No | DERIVED_RENDER |
| DERIVED_AUDIO | No | DERIVED_AUDIO |
| TEMP_IMPORT | No | TEMP_IMPORT |
| AVATAR | No | Excluded from current usage inventory |
| PRACTICE_BUNDLE | No | Excluded from current usage inventory |

The target categories do not imply distinct physical copies. The current database enum
continues to have six categories. Staging and finalize candidates are not final Take
recording allocations.

## Domain-owned Inventory

`app/modules/storage_inventory/contracts.py` defines read-only provider and consumer
contracts and an immutable user snapshot. Providers return database-aggregated bytes for
every declared current category, including explicit zero. They return neither ORM rows
nor object keys. Per-resource materialization and per-resource queries are prohibited.

| Domain provider | Current contribution and scope |
| --- | --- |
| revisions | SOURCE: each ScoreRevisionSource through Revision → Score owner |
| score_assets | DERIVED_RENDER and DERIVED_AUDIO: each revision asset through Score owner |
| scores | INPUT_ASSET: each ScoreInputAsset → Upload → StoredObject, charged to Score owner |
| uploads | UPLOAD: each uploader-owned Upload having no ScoreInputAsset reference at all |
| import_jobs | TEMP_IMPORT: each ImportArtifact through ImportJob user |
| performance_takes | UPLOAD: each final recording through TakeManifest user |

All byte facts come from the referenced `StoredObject.byte_size`. Queries retain semantic
multiplicity, with no DISTINCT over physical objects. Two input assets sharing one Upload
count twice; promotion excludes the backing Upload from standalone inventory for every
user. ImportJobUpload links do not themselves exclude an independent Upload. Score
soft-deleted rows retain allocations until semantic graph cleanup removes them. Existing
avatar and PracticeBundle references remain outside this inventory.

`registry.py` receives explicit providers, validates complete enum coverage and aggregates
their contributions. Multiple providers may contribute disjoint resources to one category;
UPLOAD is supplied by both Upload and Performance Take providers. Missing providers,
undeclared/omitted return categories, invalid categories and negative/noninteger amounts
fail explicitly. A missing provider never means an empty inventory.

Only `composition.py` imports all concrete domain providers. It constructs the registry
and supplies the injection entry point. `StorageUsageReconciliation` receives the Inventory
consumer contract; it never imports concrete providers or the composition root.

```text
Business provider -> Inventory contracts + required read-only ORM joins
Composition      -> concrete domain providers + Registry
Registry         -> Inventory contracts
Storage Usage    -> Inventory consumer contract + its own accounting models
Application/CLI  -> Composition -> injected Reconciliation
```

Storage Usage must not import business ORM or business services. Registry/contracts must
not import concrete providers. Providers may use necessary read-only cross-resource joins
to express allocation ownership, but do not call other domains' services. No dynamic
registration, scanning, reflection, global plugin registry or event bus supplies inventory.

## Allocation, release and transactions

A business command admits semantic references and their logical allocation in the same
transaction. Releasing a resource removes its logical allocation exactly once with its
semantic reference; ordinary underflow is an invariant failure, not a clamped subtraction.
Sharing a physical object does not make an additional semantic allocation free. Physical
retirement is admitted only when no semantic references remain, and never substitutes for
a logical usage release. Business deletion/retention selects the resources to release;
Storage Objects does not decide product retention policy.

Pure-DB HTTP commands use `get_command_db`; services may flush but do not commit the outer
transaction. Periodic cleanup execution owns one bounded-batch transaction or one
transaction per semantic lock unit. See the [backend transaction rules](../../backend/docs/backend_engineering_principles.md#9-coding-standards).
Inventory reads never commit or flush pending caller changes. Reconciliation repair locks
the existing account before inventory/counter work and participates in the explicit
caller's transaction; inspect is read-only. It does not provision users or entitlements.

External IO cannot be enclosed by a distributed database commit. Applicable server writes
use durable ObjectWriteIntent phases before adoption. Semantic reference, final accounting
and write adoption commit together; failure leaves a recoverable write rather than an
untracked permanent object. Final semantic release and retirement admission commit
together; retirement execution performs idempotent physical deletion under its fence.

Performance Take staging and finalize candidates remain owned by the Take reservation
workflow. It verifies copies and hashes, fences finalization, and either adopts a formal
StoredObject with Take/accounting or schedules its own temporary candidate cleanup. These
objects are not forced into ObjectWriteIntent or formal-object retirement before adoption.

Quota reservation is capacity permission, not proof of upload, object existence or business
success. Hold consumption and semantic allocation commit atomically; business
failure releases/lets expiry retire the hold without manufacturing a completed resource.
Retry identities, immutable write facts, lock order and terminal-state fences prevent
duplicate allocation, late adoption and revival. Durable state/recovery provides
correctness; immediate dispatch is only a latency optimization. An audit event alone
cannot establish resource ownership or revive a consumed hold.

## Reconciliation

Reconciliation rebuilds expected used bytes from Registry's semantic inventory. It compares
category counters and the User aggregate, then repairs projections in a caller-owned
transaction. Repeated repair is idempotent. Events explain corrections; they are not
replayed to infer current resources. Quota holds are authoritative capacity facts rather
than Usage projections and are not reconstructed by Usage reconciliation.

Reconciliation does not call the object store, repair missing entitlement/provisioning,
change business lifecycle, delete objects or choose retention. Logical reconciliation and
physical reference/retirement recovery answer different questions. Additional physical
cost reporting requires its own provider metrics rather than repurposed quota totals.

## Implementation dependencies

1. Domain Inventory contracts, Registry, explicit composition and PostgreSQL equivalence
   tests establish the semantic ownership boundary used by reconciliation.
2. The Storage Quota boundary, HARD_LIMIT/UNLIMITED entitlement contract and durable
   StorageQuotaHold schema consume the Usage reader/locking contract.
3. Business protocol integration consumes the Quota API and explicit `quota_hold_id`.
   Take reservation lifecycle and applicable write/adoption protocols remain independent.
4. Category expansion and caller allocation/release updates add PERFORMANCE_RECORDING,
   AVATAR and PRACTICE_BUNDLE with provider coverage, accounting and reconciliation tests
   in the same reviewed change. They depend on agreed quota classification and ownership.
5. Retention/recovery integration verifies the complete release graph and effective holds
   against those boundaries. It must preserve transaction lock units and physical cleanup
   ownership; it does not authorize a Realtime relay or Ops architecture change.

Each stage validates fresh schema/contracts when it changes them, preserves explicit
transaction ownership, and delivers one current truth without dual writes, fallback
inventory or compatibility aliases.
