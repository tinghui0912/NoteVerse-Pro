# Media storage recovery

## Responsibility and monitoring

The exporter reads persistent facts. `noteverse_media_resource_backlog{kind=...}`
and `noteverse_media_resource_oldest_age_seconds{kind=...}` cover `write_unknown`,
`upload_unknown`, `upload_expired_uncleaned`, `upload_active`,
`take_processing_pending`, `take_processing_failed` and `take_processing_lease_expired`.
Metrics never contain User IDs, keys, UploadIds, credential URLs or payloads.
`noteverse_outbox_records_by_status{kind="take_media_processing"}` exposes processing
status. Scheduler heartbeat/lag reports the `take_media_processing`,
`stored_object_retirement` and `object_write_cleanup` scans independently.

Check exporter freshness and Beat leadership before interpreting an empty backlog.
Check Worker queue consumption, provider connectivity and shared configuration.
The signed endpoint must be reachable from the browser; the internal endpoint must
be reachable from API and Worker. Check CORS against the actual Customer Web origin
and verify ETag exposure. Do not log signed URLs or raw provider exception bodies.

## Unknown write or transfer

ObjectWriteIntent in WRITE_UNKNOWN retains its exact key, generation and token.
UploadSession with `operation_unknown` retains CREATE/COMPLETE/CLEANUP responsibility.
Inspect the safe failure code and exact internal identity through authorized database
access. Compare exact-key MPU discovery and object metadata with the committed facts.
An empty listing is an observation, not proof that a delayed mutation cannot finish.
Never delete the intent/session, clear unknown flags or reuse its key just to unblock GC.

Session maintenance resolves discoverable CREATE and COMPLETE outcomes using durable
facts; it cannot infer permanent non-execution from NOT_FOUND alone. A verified final
object is consumed atomically with the business resource. CONSUMED Multipart objects
belong to StoredObject retirement and are excluded from transfer deletion. Single PUT
sessions retain disposable staging cleanup after consumption. Garbage collection
waits for issued capability expiry, aborts exact MPU handles and checks physical facts.
This observation does not establish provider-wide permanent late-IO settlement.

For an unresolved outcome, preserve the rows, contact the provider with a redacted
request correlation, establish whether requests can still finish and obtain a reviewed
repair decision. WRITE_UNKNOWN has no automatic operator reset command. Lifecycle
configuration is a secondary physical backstop; it is not permission to erase evidence.

## Expired sessions and account erasure

StoredObject retirement maintenance includes UploadSession recovery/GC. Confirm
`run_stored_object_retirement_maintenance` remains registered and its scheduler scan
succeeds. Inspect session expiry, capability expiry, mode, status, cleanup timestamp
and unknown operation before acting. A live capability delays physical deletion.
Account closure immediately denies access; account erasure waits for transfer cleanup
before deleting User and retained reservation/Manifest/request history. User RESTRICT
protects unresolved physical responsibility. Do not bypass the FK or zero Usage counters.

## Take media processing

TakeProcessingOutbox owns the attempt token, next-attempt time, lease and structured
failure facts. UPLOADED/PROCESSING media is not playable. Provider outages retry with
bounded attempts; integrity failures stop and remain visible as FAILED. Confirm
`run_take_processing_maintenance` and `take_media_processing_task` registration,
Beat heartbeat and queue routing. Expired dispatch/processing leases recover through
the same durable lifecycle. Fix connectivity, object integrity or Worker faults at
the responsible boundary. Exhausted or permanent failures require a reviewed domain
repair; the system does not silently mark media READY or restart terminal attempts.
A product-wide operator retry interface for Take processing is not exposed.

## Deployment policy

Review [object-storage deployment inputs](../../../deploy/object-storage/README.md)
with the deployment owner. Bucket CORS, Lifecycle, versioning, IAM and encryption
must be independently applied and verified; repository examples do not change a bucket.
Backups, legal retention and provider version policy have separate owners and durations.
No successful database cleanup or zero-inventory sample claims instantaneous destruction
of backups or permanent cessation of all provider IO.
