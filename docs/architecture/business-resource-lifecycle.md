# Business resource lifecycle integration

## Resource ownership and lifecycle matrix

Domain paths are relative to `backend/app/modules/`. The audit follows the customer router or worker
entry into the concrete transaction participant; physical existence is never readiness.

| Resource / real call path | Semantic owner and authorization | Usage / Quota | Creation and release transaction | Recovery and invariants |
| --- | --- | --- | --- | --- |
| `uploads/router.py → UploadService.create_request/finalize_upload/delete_upload → UploadRepository` | Uploader; authenticated upload and owner-only deletion | UPLOAD while no InputAsset refers to Upload; positive growth needs Hold | Hold committed before Objects prewrite; final Upload + adoption + consumed Hold + allocation; deletion releases before retirement | Intent cleans failed prewrite. Stable UploadCreationRequest identity owns capacity generations. Unknown COMMIT reads persisted completion; retry cannot allocate twice. |
| `import_jobs/router.py → ImportJobService`, `review/service.py → confirm → scores/input_asset_lifecycle.py` | Job user; Upload user must agree with job/Score owner | Independent Upload converts to INPUT_ASSET on first promotion; each later semantic input counts again | Upload locks serialize classification; source/inputs/job confirmation/accounting commit together | ScoreInputAssetLifecycle owns conversion/release; sorted Upload locks protect multiplicity. Net-zero same-user conversion needs no fresh capacity. |
| `revisions/router.py → RevisionService._append → RevisionWriter.write/_unused` | Score owner pays; ScoreAccessPolicy authorizes editor/owner | SOURCE; exact positive bytes require Hold; history retains each Source | Hold and prewrite phases precede Score lock; final source/head/outboxes + consumption + allocation | Same content/no-op releases unused Hold; expected-head/idempotency rechecks after IO. Capacity locks precede Objects adoption; active owner/actor re-admission follows IO. |
| `score_assets/score_revision_rendering.py → _render_records/render_for_worker` | Score owner; worker lease + revision fingerprint + Score admission | DERIVED_RENDER, non-quota | Asset replacement/adoption and Usage deltas atomic; retirement after release | Generation/lease tests fence late results. Usage serialization precedes Objects locks. |
| `playback/service.py → render/_render_worker_asset` | Score owner; same parent/lease boundaries | DERIVED_AUDIO, non-quota | Audio replacement + deltas + retirement in final transaction | Usage serialization precedes Objects adoption; no Source Hold for audio. |
| `import_jobs/pipeline/artifact_recorder.py → ImportExecutionRecorder.replace_artifacts` and `ImportReviewService.update` | Job user; current dispatch/job lease or review state | TEMP_IMPORT, non-quota | Intent prewrite, then Job/dispatch re-admission, artifact replacement + deltas + retirement | Dispatch/Job lease and active User re-admit after IO. Retirement follows Usage release. |
| `import_jobs/deletion_service.py → _release`, `maintenance_service.py → cleanup_orphan_uploads` | Job user; stopped job/customer rule; maintenance selects actual orphans | TEMP_IMPORT and standalone UPLOAD releases | Reference removal, accounting release and retirement share caller transaction; orphan item savepoints | Sorted Upload locks and fresh bulk reference checks protect shared resources; missing physical facts fail closed. |
| `scores/lifecycle_service.py → deletion admission → ScoreDeletionExecutor.execute` | Score owner lifecycle authority; tombstone cuts active access | SOURCE, INPUT_ASSET, DERIVED_* releases; surviving independent Upload returns to uploader | Durable Score deletion; graph removal + Usage + retirement atomic in worker | ScoreInputAssetLifecycle restores surviving Upload occupancy without new admission; orphan Upload removal creates no intermediate allocation. |
| `revisions/derived_asset_retention_service.py → cleanup_for_score` | Score policy protects current head | DERIVED_* releases, non-quota | Score-scoped worker transaction releases assets, counters and retirement | Head serialization and asset retention policy remain separate from Source history. |
| `performance_takes/router.py → reservation_service/reservation protocol → finalization.py → PerformanceTakeWriter.adopt` | Take user; exact Bundle admission; detached immutable Manifest | Hold reserves UPLOAD; only final recording allocates UPLOAD | Manifest/reservation/Hold commit; UploadSession transport and coordinator IO outside business locks; exact lease final admission atomically consumes and allocates | Small inputs verify full SHA-256 synchronously; large inputs use durable domain media processing. Unknown COMMIT reads fresh persisted lineage; no duplicate consumption. |
| `PerformanceTakeService.delete_take` | Take owner | Final UPLOAD release | Take removal + Usage release + retirement | Caller-owned deletion releases Usage before retirement. Manifest/reservation retain idempotency and temporary cleanup lineage. |
| `account/router.py → AvatarService.replace_user_avatar/clear_user_avatar` | Current User; User lock owns avatar reference | No Usage / no Hold | Normalize immutable JPEG, Intent prewrite; User reference replacement and prior retirement | User lock serializes clear/replacement; active-user recheck follows prewrite. |
| `practice/bundle/writer.py → ensure_binding`, `retention.py` | Score/Revision binding, shared derived Bundle | No Usage / no Hold | Both representations adopted before READY/binding; last binding release admits retirement | Content-addressed reuse is physical identity, not User quota. CREATING/READY and existing compiler/GC races remain business-owned. |
| Account deletion | `DELETE /me → AccountDeletionService → composition/account_deletion.py` | Owned semantic allocations are released without fresh capacity | Account tombstone/revocation and operation commit together; bounded worker units coordinate domain cleanup | Preserve UploadSession capability and unknown-IO cleanup evidence until settlement; do not use bare User CASCADE as a lifecycle implementation. |

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
ObjectWriteCoordinator persists write generation before releasing its Session for IO.
Fresh transactions fence receipt publication/adoption. Retirement owns destructive
object fencing independently of business and quota admission.

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
Runtime fence failures remain integrity failures, with no reference-waiting state. UploadSession cleanup retains capability expiry and unknown-IO evidence. Account
deactivation must not erase the rows that still own that cleanup.

## Account deletion

`DELETE /me` verifies the current password and returns 202 with an operation identity.
Its request transaction tombstones User, disables authentication, invalidates AuthToken and EmailChangeRequest credentials, revokes refresh tokens
and persists AccountDeletionOperation. Owned Scores cease active authority through the
canonical active-parent predicate. Request admission does not enumerate the graph.

`app/composition/account_deletion.py` composes domain-owned cleanup operations.
Account owns deletion admission and delivery facts; business resource owners do not
reverse-depend on cross-domain erasure orchestration.

Worker phases are SCORES, IMPORTS, TAKES, UPLOADS, TRANSFERS and FINALIZE, with one semantic unit
per transaction. Score tombstone admission commits before a fresh graph-execution
transaction acquires Operation → Score locks. Imports serialize Dispatch → Job.
Take erasure releases semantic recordings and unconsumed Holds without waiting for physical transfer work. TRANSFERS cancels UploadSessions and waits for cleanup ACK. FINALIZE removes command, reservation, Manifest and session history after physical settlement.
Account erasure never directly deletes physical objects.

Successful units remain committed on a later failure. Exact leases fence stale delivery;
bounded periodic recovery restores lost dispatches. Exhaustion is visible FAILED state.
Final erasure checks empty semantic inventory and zero aggregate/category usage, releases
remaining holds, removes private projections/history and retires the avatar. Unexpected
pre-admitted resources restart domain phases. Drift fails closed, without auto-repair.
Other users' resources and shared physical objects survive. Invitation creator and
terminal actor attribution is anonymized on closure while terminal outcome/time remain.
Notification actor and Score deletion owner IDs remain minimal historical snapshots.

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

## Account erasure ownership contract

Account Closure, Account Resource Erasure and StoredObject Retirement are independent.
Closure revokes access atomically with durable erasure admission. Account COMPLETED
means the owned semantic graph, allocations and identity are removed. It does not
assert destruction of shared physical bytes, provider versions or backups.

`account/resource_ownership.py` explicitly reviews every User FK. Metadata tests
compare actual ownership edges against that contract. Cleanup dispatch stays explicit;
no runtime scanning decides ownership. The Objects reference registry independently
covers all nine semantic StoredObject FKs, including both shared Bundle representations.

| Resource / User edge | Domain owner | Ownership | Deletion authority and completion | Storage references / accounting | Retention |
| --- | --- | --- | --- | --- | --- |
| `account_deletion_operations.user_id` | account | system | SET NULL after finalization; operation UUID and numeric subject snapshot remain for recovery | No direct counted allocation | Operation evidence; no email, password or content snapshot |
| `auth_tokens.user_id` | auth | owned | Bounded authentication erasure after closure revokes access | No direct counted allocation | Removed with its owned lifecycle |
| `email_change_requests.user_id` | account | owned | Bounded Account security erasure before identity removal | No direct counted allocation | Removed with its owned lifecycle |
| `import_jobs.user_id` | import_jobs | owned | Domain cleanup deletes artifacts and releases TEMP_IMPORT | ImportArtifact StoredObject; TEMP_IMPORT release | Removed with its owned lifecycle |
| `notifications.recipient_user_id` | notifications | owned | erase_recipient_history before User deletion | No direct counted allocation | Removed with its owned lifecycle |
| `upload_sessions.user_id` | media_storage | owned | TRANSFERS cancels and acknowledges exact physical cleanup; FINALIZE removes history | User RESTRICT; CONSUMED multipart belongs to StoredObject | Unknown provider IO retains responsibility |
| `performance_take_manifests.user_id` | performance_takes | owned | erase history only after UploadSession cleanup ACK | Recording through Take; UPLOAD release, temporary cleanup ACK | Removed with its owned lifecycle |
| `performance_take_upload_reservations.user_id` | performance_takes | owned | cancel business reservation; release hold; retain temporary cleanup lineage until ACK | quota_hold_id; UploadSession cleanup; no premature allocation | Removed with its owned lifecycle |
| `playback_outbox.requested_by_user_id` | playback | history | SET NULL; another owner retains playback work | No direct counted allocation | Minimal absent-actor context in surviving owner history |
| `practice_activities.user_id` | practice | owned | Bounded Practice activity erasure | No direct counted allocation | Removed with its owned lifecycle |
| `realtime_changes.recipient_user_id` | realtime | owned | Bounded recipient replay erasure | No direct counted allocation | Removed with its owned lifecycle |
| `realtime_stream_state.recipient_user_id` | realtime | owned | CASCADE private replay cursor | No direct counted allocation | Removed with its owned lifecycle |
| `refresh_tokens.user_id` | auth | owned | revoke immediately; bounded credential erasure | No direct counted allocation | Removed with its owned lifecycle |
| `score_invites.created_by_user_id` | collaboration | history | Close issuer pending invites, scrub contact and SET NULL creator; preserve foreign Score history | No direct counted allocation | Anonymized business outcome/time follows owning Score lifecycle |
| `score_library_folders.user_id` | library | owned | erase_user_state | No direct counted allocation | Removed with its owned lifecycle |
| `score_library_organizations.user_id` | library | owned | erase_user_state without deleting foreign Scores | No direct counted allocation | Removed with its owned lifecycle |
| `score_memberships.user_id` | collaboration | shared | erase_user_memberships preserves foreign Score | No direct counted allocation | Removed with its owned lifecycle |
| `score_memberships.created_by_user_id` | collaboration | history | SET NULL creator without changing other users role/revocation | No direct counted allocation | Surviving Membership lifecycle |
| `score_revision_events.actor_user_id` | revisions | history | SET NULL preserves foreign Score history | No direct counted allocation | Minimal absent-actor context in surviving owner history |
| `score_revision_notes.author_user_id` | revisions | history | SET NULL preserves foreign Score note | No direct counted allocation | Minimal absent-actor context in surviving owner history |
| `score_revision_render_outbox.requested_by_user_id` | revisions | history | SET NULL preserves foreign render work | No direct counted allocation | Minimal absent-actor context in surviving owner history |
| `score_revisions.created_by_user_id` | revisions | history | SET NULL preserves foreign Score revision | No direct counted allocation | Minimal absent-actor context in surviving owner history |
| `scores.owner_user_id` | scores | owned | ScoreLifecycleService and ScoreDeletionExecutor release graph and accounting | Revision Sources, input Uploads, render/playback; exact category releases and shared-reference retirement | Removed with its owned lifecycle |
| `storage_quota_holds.user_id` | storage_governance.quota | owned | release HELD; erase terminal holds after business lineage | Release remaining HELD; erase terminal history after business lineage | Removed with its owned lifecycle |
| `storage_usage_accounts.user_id` | storage_governance.usage | owned | assert zero then CASCADE | Aggregate must be zero | Removed with its owned lifecycle |
| `storage_usage_counters.user_id` | storage_governance.usage | owned | assert every category zero then CASCADE | Every category must be zero | Removed with its owned lifecycle |
| `storage_usage_events.user_id` | storage_governance.usage | owned | Bounded erasure after verified semantic release; events do not establish ownership | No direct counted allocation | Removed with its owned lifecycle |
| `upload_creation_requests.user_id` | uploads | owned | erase command history after semantic Upload erasure | No direct counted allocation | Removed with its owned lifecycle |
| `uploads.uploader_user_id` | uploads | owned | delete_upload releases standalone UPLOAD and retires only unreferenced object | Upload StoredObject; UPLOAD release exactly once | Removed with its owned lifecycle |
| `user_storage_entitlements.user_id` | storage_governance.quota | owned | CASCADE after holds released and usage verified zero | No direct counted allocation | Removed with its owned lifecycle |

User profile and current avatar belong to Account. Avatar replacement/removal uses
AvatarService, releases its reference and admits retirement in the same transaction;
it has no Usage allocation. Practice Bundles belong to their Score/Revision bindings,
not to an uploader or physical byte payer. Score erasure releases bindings through
Practice retention; shared READY Bundles remain while any binding survives. ObjectWriteIntent
has no User ownership: unadopted generations keep their own cleanup lifecycle after
User erasure. UploadCreationRequest and Take reservation evidence are not deleted until
their domain permits final cleanup. Remaining healthy foreign-owner resources never
become account-erasure targets merely because the departing user once accessed them.

Account delivery preserves its phase on operator rearm. Integrity violations stop
automatic retry; repair the invariant before rearming through audited Ops. Remaining
Usage drift is not clamped, reconciled away or erased to force completion.

### Backup and retained-data boundary

The repository does not configure a backup schedule, provider version expiry or legal
retention period. These require deployment/product policy before launch; no immediate
backup-destruction guarantee is made. AccountDeletionOperation is the authoritative
closure/erasure evidence, including after User deletion. A restored database must not
serve traffic until deletion operations newer than the backup have been recovered from
the authoritative recovery set, closed subjects remain disabled and erasure is resumed.
Restoring only an old business backup without current deletion evidence is unsafe and
must fail the operational release gate. This requires an external backup/recovery process;
the application cannot reconstruct closure intents absent from every restored source.

FINALIZE drains private histories in domain-owned bounded batches controlled by
`ACCOUNT_DELETION_RESOURCE_BATCH_SIZE`. Take manifests/reservations are removed only
after temporary cleanup acknowledgements; Upload request history precedes terminal hold
erasure. Library organization, membership, recipient Notification, authentication/security,
practice activity, replay history and zero-account accounting evidence each have explicit
cleanup owners. Surviving foreign Revision actors/notes/events and render/playback requesters
are anonymized in bounded updates, preserving their owner's resources. The remaining User
cascades cover only the fixed-size account/counters/stream/entitlement projections.
Notification admission locks a live recipient before creating history; a closed or missing
recipient creates neither private history nor a realtime wake-up. This prevents foreign
business work from recreating an erased private graph.

Actor/requester anonymization uses guarded SQL updates: the actor must still be the
closed subject when the write executes. A concurrent surviving-owner edit or new requester
is preserved. Revision render outbox attribution belongs to Revisions delivery; Playback
owns playback requester attribution. PostgreSQL tests interleave selection, another user's
committed note edit and erasure to verify that no new attribution is overwritten.


## Credential and contact-data lifecycle

Authentication credential mutation serializes User → AuthToken/EmailChangeRequest →
MailOutbox. Credential commands and Account Closure use User NO KEY UPDATE locks,
which serialize with one another and remain compatible with resource KEY SHARE admission. Closure invalidates
all unused AuthTokens and unconsumed email changes, revokes refresh tokens and cancels
its source-owned mail in the same transaction as the tombstone and erasure operation.
Password reset discovers the token without mutation, locks and refreshes the User,
requires active/not-deleted state, then locks and rechecks the token. Token issuance,
password change and email-change commands use the same User-first serialization.
The clock is checked after lock acquisition. A closed principal cannot reset a
password or generate a password-change notification. Token rows remain for bounded
FINALIZE history erasure; invalidation does not substitute for that cleanup.

Personal data is not limited to User foreign keys. `ACCOUNT_CONTACT_DATA_POLICIES`
is an explicit review contract alongside the User-FK and StoredObject-reference
contracts. Metadata tests require every email/contact/body column to have a policy;
application cleanup never discovers ownership by reflection or recipient matching.

| Data | Responsible domain / ownership | Closure, invalidation and minimization | Retention / completion |
| --- | --- | --- | --- |
| `ScoreInvite.email`, token hash | Collaboration; recipient personal data, distinct from Score ownership | Closure scrubs invitations targeting the primary email with created_at <= closed_at, and all issuer-owned invitations. New post-closure invitations from another live issuer survive. | Terminal outcome/time remains anonymized in the owning Score history. Scrubbed tokens never become reusable. |
| `MailOutbox.recipient`, subject, text/html bodies | Mail delivery payload, owned by explicit source kind + numeric source ID | Account authentication mail uses ACCOUNT, AUTH_TOKEN or EMAIL_CHANGE; signup uses REGISTRATION; Collaboration uses SCORE_INVITE. Source invalidation cancels unfinished attempts and scrubs recipient, subject, bodies, provider ID, raw dedupe content and error detail. No recipient-email bulk deletion. | SENT, CANCELLED, EXPIRED and PERMANENT_FAILURE evidence is cleaned after configured `MAIL_OUTBOX_RETENTION_DAYS` (default 7 days). SENT bodies are cleared at accepted completion; source invalidation clears remaining contact data immediately. |
| Password reset / email-change / verification URLs | Auth owns credentials; Mail holds a temporary delivery copy | Token consumption/replacement/closure or verification cancels the exact source delivery. Worker validates domain source before claim and before provider handoff. TTL also bounds validity. | No URL is copied into Ops or a new deletion ledger. Credential history follows its domain cleanup; bodies follow Mail retention. |
| `EmailChangeRequest.new_email`, token hash, IP/User-Agent | Authenticated requester, not the owner of the proposed address | Closure invalidates immediately, cancels source mail, and bounded Account security erasure removes history. Completed old-address notices belong to ACCOUNT source identity and are scrubbed on closure. | Removed before User erasure completes. A matching third-party address never grants ownership of that third party's data. |
| `PendingRegistration.email`, display name, password/token hashes, IP/User-Agent | Independent unverified applicant | Verification consumes and removes the row and cancels its source mail; re-registration replaces the credential and cancels previous delivery. TTL makes expired tokens unusable. It is not assigned to an existing User merely by email equality. | Successful verification removes it. Expired pending-registration row retention has no configured purge policy in this repository; a product/deployment retention decision is still required. |
| AuthToken/RefreshToken hashes and client metadata | Auth; explicit User ownership | Immediate credential invalidation/revocation, then bounded erasure | Removed before User deletion; never restored by mail retry. |
| Foreign-owner content and minimal actor snapshots | Owning Score/Notification domain | Departing actor attribution is anonymized where nullable; content is not deleted merely because it mentions a person. Numeric historical actor snapshots reveal no email/name. | Surviving resource lifecycle and existing Notification retention apply; no blanket legal-retention claim. |
| Ops operator identity and audit reason | Platform operator / Ops | Operator identity is separate from customer User. Erasure audit uses stable internal IDs; customer mail content and credential URLs are not operation payloads. | Existing operational policy applies; legal retention periods are not configured here. |

Mail cancellation is terminal and clears the attempt capability. Late provider
completion/failure cannot revive a cancelled operation; Ops cannot rearm it. SENT
history remains SENT rather than claiming a delivered message was recalled. FAILED
mail can retry only while its source and expiry are valid; exhausted recoverable
failures remain visible to Ops until repair/rearm or source cancellation. Expired
and permanent delivery failures cannot be rearmed. No second queue or status copy
exists. Score tombstone and invitation-mail cancellation commit together, before
asynchronous Score graph erasure. Batch Score deletion cancels the complete invitation
source set in constant-count SQL statements, without a per-Score mail loop.

Source validity is a domain read composed in `app/composition/mail_delivery.py`.
This also rejects mail admitted by a pre-closure business transaction that finishes
after the closure's cancellation scan. No DB lock spans provider IO. A provider
handoff already admitted before closure can be in flight and cannot be recalled;
its credential is still invalid after closure, and cancellation prevents further
retry. Mail remains at-least-once external delivery, not an atomic DB/provider send.

MailOutbox stores exact source identities and domain-owned cancellation fences.


## Account Closure and Collaboration Retention

Closure destroys the principal and its old access, while preserving another owner's
business continuity. Collaboration owns `close_account_collaboration_data`; Account
passes the locked User ID, normalized primary email and immutable `deleted_at` in the
same request transaction as credential invalidation and durable erasure admission.
There is no email blacklist, new deletion ledger, new queue or resource inference.

| Matching fact | Pending invitation | Existing terminal invitation | Contact / attribution |
| --- | --- | --- | --- |
| Recipient primary email matches and `created_at <= closed_at` | RECIPIENT_ACCOUNT_CLOSED | Preserve ACCEPTED / DECLINED / REVOKED and original terminal time | Clear email and token hash together; clear closing actor attribution |
| Creator is the closing User, irrespective of creation time | INVITER_ACCOUNT_CLOSED | Preserve existing outcome and terminal time | Clear email/hash and creator; clear closing terminal actor |
| Both recipient and creator match | RECIPIENT_ACCOUNT_CLOSED has priority | Preserve existing outcome/time | Apply both contact and attribution rules |
| Only terminal actor matches | No new outcome | Preserve existing outcome/time | Clear actor ID; unrelated recipient contact stays with its own lifecycle |
| Other live creator invites the same email after closure | Remains a fresh invitation | Its own lifecycle | Preserve new identity, credential, contact, creation time and expiry |

Recipient invalidation includes expired invitations whose terminal_outcome is still
NULL. System closure outcomes have terminal_at but no human actor. Human terminal
history also permits an absent actor after anonymization. The database requires email
and token_hash to be present together for unresolved invitations, or absent together
only for terminal history. Closure outcomes require both absent and no actor; issuer-closure rows also require
no creator reference. The
unique token-hash index permits multiple NULLs, never duplicate live hashes.
Creator foreign keys on Invite and Membership are nullable ON DELETE SET NULL;
closure actively removes them rather than waiting for User deletion.

`score_memberships.user_id` is the member identity. The existing Membership erasure
removes the closing user's own rows in bounded background work. `created_by_user_id`
is historical attribution: another user's Membership, role and revoked_at survive.
Bob's Score, revisions, sources, render/playback assets, notes, events and other
members are not Alice's erasure targets. Owned Scores still use ScoreLifecycleService
and ScoreDeletionExecutor for graph/accounting release and retirement admission.
No Collaboration cleanup physically deletes objects or adjusts Usage/Quota.

All new invitations default to `SCORE_INVITE_TTL_DAYS=7`. Explicit future expiry is
honored; already-expired creation is rejected. Invite and MailOutbox share the exact
same expires_at. Pending lists require a live creator and usable credentials.
Inspection, acceptance and decline also verify the creator in the business path;
mail validity alone is insufficient. A NULL/closed creator fails closed. No API
returns a token hash or restores scrubbed contact for display.

Same-email registration creates a new User ID. It inherits no old Membership, role,
invite UUID or token. Only a fresh invitation from a live authorized issuer can be
accepted by that new principal. The owner sees anonymized recipient/creator labels
and the business terminal outcome; no placeholder email, token or system User is used.

### Transaction and concurrency boundary

Invitation creation acquires the normalized recipient email's PostgreSQL transaction
advisory lock before Score/issuer admission, then retains recipient User KEY SHARE
when that User exists, before assigning created_at. Registration and verification
acquire the same email lock before pending-registration mutation or User creation;
verification discovers the email without locking and rechecks the credential after
acquiring the lock. Email-change confirmation takes its credential User NO KEY UPDATE
lock, then the target email lock and credential row. The namespace also serializes
an invitation for an absent User with that email's next identity lifetime. It stores
no address history, provides no authorization and releases at transaction end.

Invitation responses retain Score → Invite → creator/recipient User KEY SHARE
admission and then their semantic/Mail consequences. User KEY SHARE is compatible
with request tombstoning's NO KEY UPDATE lock.

Account Closure takes User NO KEY UPDATE → current email lock → Invite locks in ID order → Mail locks,
without acquiring Score locks. Acceptance/decline retain Invite before Mail as well.
An in-flight response that owns the Invite can finish before closure commits; closure
then preserves its outcome/time and scrubs identity. A response blocked behind closure
re-reads the terminal Invite and cannot grant access. Active-user admission excludes
closed principals. Membership creator anonymization never changes role/revocation.

FINALIZE retains Operation → User FOR UPDATE → nonblocking email lock acquisition
→ capacity/Usage locks and takes no Score lock. If the email lock is held, it commits
the existing busy checkpoint and releases the User lock; it never waits in the reverse
email/User order. Its exclusive User fence waits for prior recipient/issuer admissions.
It repeats Collaboration cleanup in bounded batches using the original email/cutoff.
Each successful unit commits independently; new recipient invitations with creation
time after the cutoff remain untouched. The initial closure processes bounded SQL
chunks within its one atomic request transaction, avoiding an unbounded list of IDs.

Mail cancellation uses only invitation source IDs, clears active delivery leases and
scrubs recipient/subject/body/provider and raw dedupe data. Late results cannot revive
cancelled attempts. SENT evidence stays SENT: provider requests already in flight
cannot be recalled. Existing MAIL_OUTBOX_RETENTION_DAYS remains the one mail retention
policy. The independent Account and StoredObject deletion lifecycles do not change.

### Schema and verification

The initial schema defines closure outcomes, nullable contact/creator attribution and terminal-fact constraints.

PostgreSQL tests cover recipient/issuer and existing outcomes, expiry, same-email
re-registration, old UUID/token rejection, new-invitation preservation, delivery lease
fencing, source-owned cancellation, bounded repeats, shared physical references,
atomic rollback and concurrent acceptance/decline/creation/finalization. Migration
and metadata checks validate actual FKs, indexes, enums and constraints. The explicit
ACCOUNT_RESOURCE_POLICIES and ACCOUNT_CONTACT_DATA_POLICIES remain review contracts,
not runtime discovery or automatic deletion registries.

Backups, provider-held email copies, legal retention and personal information in
another owner's free text require independent governance decisions. This implementation
does not invent legal deadlines or claim to erase backups or arbitrary free text.
