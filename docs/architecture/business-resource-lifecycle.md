# Business resource lifecycle integration

## Resource ownership and lifecycle matrix

Domain paths are relative to `backend/app/modules/`. The audit follows the customer router or worker
entry into the concrete transaction participant; physical existence is never readiness.

| Resource / real call path | Semantic owner and authorization | Usage / Quota | Creation and release transaction | Recovery and invariants |
| --- | --- | --- | --- | --- |
| `uploads/router.py → UploadService.create_upload/delete_upload → UploadRepository` | Uploader; authenticated upload and owner-only deletion | UPLOAD while no InputAsset refers to Upload; positive growth needs Hold | Hold committed before Objects prewrite; final Upload + adoption + consumed Hold + allocation; deletion releases before retirement | Intent cleans failed prewrite. Stable UploadCreationRequest identity owns capacity generations. Unknown COMMIT reads persisted completion; retry cannot allocate twice. |
| `import_jobs/router.py → ImportJobService`, `review/service.py → confirm → scores/input_asset_lifecycle.py` | Job user; Upload user must agree with job/Score owner | Independent Upload converts to INPUT_ASSET on first promotion; each later semantic input counts again | Upload locks serialize classification; source/inputs/job confirmation/accounting commit together | ScoreInputAssetLifecycle owns conversion/release; sorted Upload locks protect multiplicity. Net-zero same-user conversion needs no fresh capacity. |
| `revisions/router.py → RevisionService._append → RevisionWriter.write/_unused` | Score owner pays; ScoreAccessPolicy authorizes editor/owner | SOURCE; exact positive bytes require Hold; history retains each Source | Hold and prewrite phases precede Score lock; final source/head/outboxes + consumption + allocation | Same content/no-op releases unused Hold; expected-head/idempotency rechecks after IO. Capacity locks precede Objects adoption; active owner/actor re-admission follows IO. |
| `score_assets/score_revision_rendering.py → _render_records/render_for_worker` | Score owner; worker lease + revision fingerprint + Score admission | DERIVED_RENDER, non-quota | Asset replacement/adoption and Usage deltas atomic; retirement after release | Generation/lease tests fence late results. Usage serialization precedes Objects locks. |
| `playback/service.py → render/_render_worker_asset` | Score owner; same parent/lease boundaries | DERIVED_AUDIO, non-quota | Audio replacement + deltas + retirement in final transaction | Usage serialization precedes Objects adoption; no Source Hold for audio. |
| `import_jobs/pipeline/artifact_recorder.py → ImportExecutionRecorder.replace_artifacts` and `ImportReviewService.update` | Job user; current dispatch/job lease or review state | TEMP_IMPORT, non-quota | Intent prewrite, then Job/dispatch re-admission, artifact replacement + deltas + retirement | Dispatch/Job lease and active User re-admit after IO. Retirement follows Usage release. |
| `import_jobs/deletion_service.py → _release`, `maintenance_service.py → cleanup_orphan_uploads` | Job user; stopped job/customer rule; maintenance selects actual orphans | TEMP_IMPORT and standalone UPLOAD releases | Reference removal, accounting release and retirement share caller transaction; orphan item savepoints | Sorted Upload locks and fresh bulk reference checks protect shared resources; missing physical facts fail closed. |
| `scores/lifecycle_service.py → deletion admission → ScoreDeletionExecutor.execute` | Score owner lifecycle authority; tombstone cuts active access | SOURCE, INPUT_ASSET, DERIVED_* releases; surviving independent Upload returns to uploader | Durable Score deletion; graph removal + Usage + retirement atomic in worker | ScoreInputAssetLifecycle restores surviving Upload occupancy without new admission; orphan Upload removal creates no intermediate allocation. |
| `revisions/derived_asset_retention_service.py → cleanup_for_score` | Score policy protects current head | DERIVED_* releases, non-quota | Score-scoped worker transaction releases assets, counters and retirement | Head serialization and asset retention policy remain separate from Source history. |
| `performance_takes/router.py → reservation_service/reservation protocol → finalization.py → PerformanceTakeWriter.adopt` | Take user; exact Bundle admission; detached immutable Manifest | Hold reserves UPLOAD; only final recording allocates UPLOAD | Manifest/reservation/Hold commit; staging/candidate IO outside business locks; exact lease final admission atomically consumes and allocates | The business state machine verifies the full content hash. Unknown COMMIT reads fresh persisted lineage; no duplicate consumption. |
| `PerformanceTakeService.delete_take` | Take owner | Final UPLOAD release | Take removal + Usage release + retirement | Caller-owned deletion releases Usage before retirement. Manifest/reservation retain idempotency and temporary cleanup lineage. |
| `account/router.py → AvatarService.replace_user_avatar/clear_user_avatar` | Current User; User lock owns avatar reference | No Usage / no Hold | Normalize immutable JPEG, Intent prewrite; User reference replacement and prior retirement | User lock serializes clear/replacement; active-user recheck follows prewrite. |
| `practice/bundle/writer.py → ensure_binding`, `retention.py` | Score/Revision binding, shared derived Bundle | No Usage / no Hold | Both representations adopted before READY/binding; last binding release admits retirement | Content-addressed reuse is physical identity, not User quota. CREATING/READY and existing compiler/GC races remain business-owned. |
| Account deletion | `DELETE /me → AccountDeletionService → composition/account_deletion.py` | Owned semantic allocations are released without fresh capacity | Account tombstone/revocation and operation commit together; bounded worker units coordinate domain cleanup | Preserve Take capability/candidate cleanup evidence until its own grace ends; do not use bare User CASCADE as a lifecycle implementation. |

## Shared authorities

Objects owns facts, write generations, explicit nine-FK reference protection and irreversible
retirement. Usage owns logical allocation/release and strict underflow. Quota owns the User's
finite plan entitlement and positive capacity admission. Inventory providers aggregate each
logical resource in SQL, preserving multiplicity. Only composition imports all providers.

## Lock and transaction integration

Parent admission precedes capacity/Usage serialization, followed by write intents, StoredObject
and retirement. Business uploads are locked by ascending relational PK, never page/input order.
Quota order remains Entitlement → UsageAccount → Hold → category counters. No physical write
holds Score, Upload or quota locks: durable prewrite phases release them and re-admit afterward.
The narrow Intent/destructive object locks fence physical IO itself; removing them would allow
stale writes or deletion to race adoption. They do not span quota or business admission.

Pure database HTTP commands use the command dependency. External-IO coordinators own their
explicit durable phases; transaction participants only flush. Worker execution owns graph cleanup
and maintenance transactions. Reference removal, logical release and retirement admission commit
atomically. A caller rollback preserves all three; physical deletion is later durable work.

## Classification and capacity

User is the only quota subject. A new semantic counted allocation needs admission for its
**positive net increase**. A same-user UPLOAD/INPUT_ASSET reclassification preserves already
admitted occupancy and must remain possible over quota. Additional inputs count independently.
Cross-user transfer is not implicit permission: Import ownership must match Upload and Score.
Deletion cannot require new capacity for a net-decreasing same-user conversion.

## Failure and recovery

Use durable Hold identity, business idempotency/lease identity, write generation and operation
UUIDs. Inventory/Usage reconciliation does not infer ownership from events or provider scans.
Runtime fence failures remain integrity failures, with no reference-waiting state. Staging and
candidate cleanup retain the Take protocol's capability and unknown-COMMIT grace. Account
deactivation must not erase the rows that still own that cleanup.

## Account deletion

`DELETE /me` verifies the current password and returns 202 with an operation identity.
Its request transaction tombstones User, disables authentication, revokes refresh tokens
and persists AccountDeletionOperation. Owned Scores cease active authority through the
canonical active-parent predicate. Request admission does not enumerate the graph.

`app/composition/account_deletion.py` composes domain-owned cleanup operations.
Account owns deletion admission and delivery facts; business resource owners do not
reverse-depend on cross-domain erasure orchestration.

Worker phases are SCORES, IMPORTS, TAKES, UPLOADS and FINALIZE, with one semantic unit
per transaction. Score tombstone admission commits before a fresh graph-execution
transaction acquires Operation → Score locks. Imports serialize Dispatch → Job.
Take erasure cancels its own active reservation and preserves capability expiry and
uncertain-candidate grace. Its staging/candidate cleanup must ACK before history removal.
Account erasure never directly deletes physical objects.

Successful units remain committed on a later failure. Exact leases fence stale delivery;
bounded periodic recovery restores lost dispatches. Exhaustion is visible FAILED state.
Final erasure checks empty semantic inventory and zero aggregate/category usage, releases
remaining holds, removes private projections/history and retires the avatar. Unexpected
pre-admitted resources restart domain phases. Drift fails closed, without auto-repair.
Other users' resources and shared physical objects survive. Invite terminal actor,
Notification actor and Score deletion owner IDs are immutable historical snapshots;
these survive identity erasure, with absent actor presentation.

Resource admission uses User KEY SHARE after business parents and before capacity.
Request tombstoning uses NO KEY UPDATE without Score locks. Final erasure uses User
FOR UPDATE and takes no Score lock, waiting for admitted creators without inversion.
Retirement/write cleanup evidence survives User erasure and continues independently.

## Verification

PostgreSQL suites cover account erasure, Upload command replay/unknown COMMIT,
InputAsset conversion, Quota concurrency, Usage reconciliation, Objects races and
Take temporary cleanup. Migration/schema tests verify constraints and snapshots.


Notification read commands acquire their User lifecycle fence before history rows.
Realtime change admission takes a recipient User KEY SHARE before its stream row and
omits closed recipients. This preserves final User erasure lock order; delivery,
transport, replay and emission identities retain their existing architecture.


Final Account erasure acquires capacity/Usage locks with SKIP LOCKED after its
exclusive User fence. A busy accounting transaction yields a durable retry checkpoint;
missing entitlement/Usage still fails closed. It never waits on an audit writer that
needs the User FK parent, avoiding a parent/account lock cycle. Take cleanup holds a
non-active User KEY SHARE only during DB phases and releases it before temporary IO.
