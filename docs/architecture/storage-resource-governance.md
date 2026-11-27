# Storage resource governance

This document defines the implemented resource-management authorities and their
transactional cooperation.

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

`media_storage` owns physical lifecycle, transfer, verification and delivery.
`storage_governance` contains separate quota, usage and inventory boundaries.

`StoredObject` is the sole admitted physical-object fact: immutable key, size, content
type, provider ETag and transport checksum, with optional full-object SHA-256.
A business reference grants semantic ownership; the physical row alone does not grant
access or establish a completed business resource. See [Object storage](object-storage.md)
for exact locks, write generations and retirement delivery.

## Accounting and capacity separation

[Storage Usage](storage-usage.md) owns committed category/account used-byte projections
and immutable audit events. [Storage Quota](storage-quota.md) owns current plan policy,
User entitlement and durable capacity holds. Its reader dependency is the explicit Usage
contract. Application composition supplies both authorities to business workflows and the
existing customer storage-usage endpoint. Neither domain owns business upload state.

Quota resolves one User entitlement through the finite FREE, PLUS or PRO policy.
The policy table is the only capacity configuration; no unlimited mode or arbitrary
user override exists. See [Quota](storage-quota.md) for the canonical contract.

PerformanceTakeUploadReservation references its distinct hold through `quota_hold_id`.
Its finalization lease, Manifest and unknown-COMMIT recovery remain business
lifecycle facts. UploadSession owns the physical transfer and cleanup responsibility. See the [Take reservation contract](performance-take-reservations.md).

## Logical resource categories

| Resource | Current category | User quota |
| --- | --- | --- |
| Revision source | SOURCE | Yes |
| Independent Upload and final Take recording | UPLOAD | Yes |
| Score input | INPUT_ASSET | Yes |
| Rendered page | DERIVED_RENDER | No |
| Playback audio | DERIVED_AUDIO | No |
| Import artifact | TEMP_IMPORT | No |
| Avatar / Practice Bundle | Outside Usage | No |

Logical resource multiplicity is independent of physical reuse. Staging and finalization
candidates are not final Take allocations. Unaccounted avatars/Bundles still participate
in Objects write/reference/retirement lifecycles.

## Domain-owned Inventory

`app/modules/storage_governance/inventory/contracts.py` defines read-only provider and consumer
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

## Integration and acceptance

Business protocols depend on the independent authorities through explicit composition.
The [business resource lifecycle matrix](business-resource-lifecycle.md) identifies
concrete participants, locks and recovery owners. [Migration and recovery](storage-resource-execution.md)
identifies initialization and operational failure boundaries. Provider/category changes
require semantic inventory and accounting tests. Account erasure coordinates domain
cleanup without replacing Take protocols or Objects fences.


## Executable module ownership

`app/modules/storage_governance/quota/` owns entitlement and hold admission;
`usage/` owns counters, events and reconciliation; `inventory/` owns read-only
contracts and registry completeness. `app/composition/storage_inventory.py` is the
only concrete cross-domain provider assembly. `app/modules/media_storage/` owns
physical object facts, independent write transactions, adoption, references,
retirement and delivery policy. Models import their pure domain enums; domain
services do not retrieve state taxonomy from ORM modules. Namespace placement
changes neither quota classification nor database schema semantics.


## Transfer and media readiness

UploadSession admission has independent active-session and temporary-byte limits.
Those transport budgets do not replace capacity Holds. No staging or part upload
creates Usage. Consumption atomically adopts StoredObject, consumes Hold and records
the domain allocation. Single PUT staging cleanup survives consumption; consumed
Multipart final objects belong exclusively to StoredObject retirement. Take media
verification has its own durable Outbox and readiness state. Signed playback requires
READY, while already committed logical recording usage remains counted during processing.
