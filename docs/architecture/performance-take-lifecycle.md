# PerformanceTake lifecycle ownership

## Admission and upload capability

`PerformanceTakeManifest` is immutable admitted execution/capture truth. Its canonical
versioned JSON and SHA-256 preserve the exact Score/Revision/Bundle/artifact, resolved
scope, tempo and recording timebase evidence. It is created at reservation time.

`PerformanceTakeReservationService` owns reserve, idempotent replay, signed-upload
capability refresh, cancellation, expiry and the initial quota hold. The pure
`UploadReservationLifecycle` owns RESERVED, FINALIZING, COMPLETED, CANCELLED and EXPIRED,
`FinalizeLease`, orphan evidence and transition effects. Reservation persistence applies
those transitions; repository methods query, lock, add and flush without commit policy.

## Physical evidence and semantic adoption

`PerformanceTakeFinalizationService` claims one finite finalize lease and commits that
operational admission before slow storage IO. `PerformanceTakeFinalMedia` consumes only
an immutable Manifest, staging key and exact lease. It verifies staging existence,
size, optional provider MIME, container signature and full server SHA-256; copies to the
unique lease candidate key; and verifies candidate size, optional MIME and full SHA
agreement. It neither accesses the database nor deletes physical objects.

`VerifiedPerformanceTakeCandidate` contains the exact lease, immutable `StoredObjectFacts`,
Take/user identity, canonical Manifest document and digest. Its object key, MIME and byte
size agree with the lease and Manifest. It is physical evidence, not semantic ownership.

`PerformanceTakeWriter.adopt()` reacquires and refreshes the reservation under its row
lock, validates the exact live lease, persisted Manifest and verified candidate, resolves
an optional active Score navigation pointer, creates StoredObject and PerformanceTake,
applies COMPLETE and commits the quota reservation to the adopted object key. It flushes
but never commits, rolls back, signs URLs or calls ObjectStorage. The finalization service
owns the single semantic commit for StoredObject + Take + COMPLETED reservation + quota.
A missing/deleting Score yields a null navigation pointer and does not invalidate the
immutable Manifest. Finalize never reauthorizes a Bundle or replans a Practice execution.

## Failure and recovery

A known physical-validation/copy failure or known semantic rollback immediately relinquishes
the exact finalize lease. A live reservation returns to RESERVED with its quota hold and
Manifest intact; an expired reservation becomes EXPIRED and releases its hold. A candidate
that may exist is recorded for immediate orphan cleanup. Retrying uses the same request
identity and can obtain a fresh upload capability without waiting for lease timeout.

Pre-commit failures may recover using the healthy request session after its transaction
successfully rolls back. `recover_known_failure()` preserves immediate orphan eligibility.
A normal semantic COMMIT acknowledgement establishes success and needs no recovery.
Any semantic COMMIT invocation that raises or is interrupted has an unknown outcome,
regardless of exception type or the driver's `connection_invalidated` flag.

`PerformanceTakeFinalizationRecovery.recover_unknown_commit()` opens an independent fresh
session and reads persisted Reservation/Take lineage, without authorization, planning or
recopying. It accepts only user/Take identity and the immutable FinalizeLease, never ORM
instances from the request identity map. The uncertain request session is discarded as
best-effort connection hygiene; rollback/invalidation results do not determine the outcome.
A committed Take wins. If no Take exists and the old lease remains current, recovery
relinquishes it and records the candidate with thirty-minute `UNKNOWN_OUTCOME_GRACE`,
preserving quota hold unless the reservation expires. Expiry releases that hold.
A different lease remains untouched; late physical results refresh orphan evidence.
Unknown commit acknowledgement never permits guessing or direct candidate deletion.

Reconciliation runs in a shielded task and settles before cancellation propagates,
including repeated request cancellation. A non-cancellation COMMIT exception returns a
retryable database infrastructure error even when fresh lineage finds a committed Take.
The caller retries the same reservation to obtain that Take through COMPLETED replay.
If fresh reconciliation is unavailable, persisted lease/orphan evidence remains the
recovery authority; the request never claims semantic success.

An active lease excludes concurrent finalizers. Expired takeover uses a fresh token and
candidate key. Only the exact live lease can adopt. Completed reserve/finalize replay
returns the same Take. A deliberately deleted completed Take returns unavailable (404)
on replay; its Manifest and COMPLETED reservation remain lineage and never recreate it.

## Physical deletion owners

Temporary staging and abandoned candidates belong to `UploadReservationCleanupService`.
It uses the same domain transitions, grace periods and reference-aware checks, then
relocks the reservation to acknowledge cleanup against current state. A committed
StoredObject reference prevents orphan deletion. Requests do not physically delete
staging or candidate objects. These promotion attempts do not use ObjectWriteIntent.

Adopted recording deletion belongs to `PerformanceTakeService.delete_take()` and
StoredObjectRetirement. Semantic Take removal and quota release commit together;
physical deletion is deferred to retirement. Manifest and Reservation survive deletion.

## Browser Save application command

`PerformanceTakeSaveCommand` under `lib/practice/saved-take/save-command.ts` owns one
reserve → signed PUT → finalize operation and all Manifest/recording agreement checks.
Construction synchronously retains one exact LocalMediaAsset lease, before React Query
can schedule work. Execution/release is idempotent and releases that lease exactly once.
The Review owner is independent and may release while Save is pending. Review retains
the same clientRequestId across retries until save succeeds or its transient session ends.

RESERVED disagreement attempts cancellation before PUT. PUT failure attempts cancellation
without replacing the original error. FINALIZING replay skips PUT. COMPLETED replay
validates and returns the supplied Take. An unknown finalize outcome never cancels the
reservation. Browser code never deletes storage objects. `useSavePerformanceTake` only
creates/invokes the command, integrates React Query mutation state and invalidates library
and quota caches; the command has no queryClient dependency. Playback, local materialization
and composite-video export consume completed Takes through their independent read lifecycles.

The bodyless finalize endpoint and existing reserve/cancel APIs, Manifest schema,
My Performances routes and database schema remain their canonical contracts.
