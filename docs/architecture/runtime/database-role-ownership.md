# Database Role and Secret Ownership

## Ownership and provisioning

`backend/db/grants.sql` is the explicit table, column, sequence and function
allowlist. Every ORM table has a reviewed `-- TABLE` entry. No runtime inherits
privileges on newly created tables. A long-running runtime cannot own the
database. All application tables and the schema belong to `nv_migrator`; persistent
services never use that role. Roles are LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOREPLICATION and NOBYPASSRLS, with no role memberships.
`PUBLIC` has no schema CREATE, database CREATE/TEMPORARY or application table
access. Runtime roles have no DDL authority. PostgreSQL row locks require SELECT and UPDATE on at least one
column, so retention and reference-lock paths have narrow UPDATE columns even
when they do not modify a row. Each environment uses independent
credentials, managed outside Git.

Provision in this order:

1. A database administrator creates the database and supplies
   `NOTEVERSE_DB_ADMIN_URL` plus six distinct passwords in
   `NV_MIGRATOR_PASSWORD`, `NV_CUSTOMER_API_PASSWORD`, `NV_CONTROL_PLANE_PASSWORD`,
   `NV_WORKER_PASSWORD`, `NV_BEAT_PASSWORD` and `NV_OBSERVABILITY_PASSWORD`.
2. Run `python scripts/provision_database.py bootstrap --schema public` from
   `backend/`. This idempotently creates/validates the roles, rotates supplied
   passwords and assigns an empty application schema to `nv_migrator`. It refuses
   an occupied schema owned by another role or unsafe role attributes/memberships.
   Use a fresh development database, or an administrator-reviewed ownership
   procedure; the helper never discards application data.
   The administrator connection is provisioning-only, never a runtime Secret.
3. Set `DATABASE_URL` to the `nv_migrator` connection, run `alembic upgrade head`,
   then `python scripts/provision_database.py grants --schema public`.
   The container `migrate` command runs both steps. Apply grants after each schema
   change; newly added tables receive no runtime permissions by default.
4. Populate the six runtime Secrets using credential-only templates and validate
   them with `scripts/validate_runtime_secrets.py`. Use only the matching role in
   each runtime DB URL and scheduler-lock URL.

The provisioning helper does not print passwords or SQL on failure. PostgreSQL
server diagnostics require administrator access; production log policies must
protect database statements and credential provisioning operations.

`ALTER DEFAULT PRIVILEGES` revokes implicit table, sequence and function rights
at both global and schema scope. Schema CREATE and database CREATE/TEMPORARY
are revoked from both PUBLIC and the five long-running runtime roles.
Explicit per-table/column revocation precedes grants, so applying the contract
repeatedly removes excess permissions. All application objects must be owned by
`nv_migrator`. SQL functions use schema-qualified references, a fixed
`search_path=pg_catalog`, owner execution and explicit EXECUTE grants.

## Runtime privileges

S/I/U/D mean SELECT/INSERT/UPDATE/DELETE. Column-scoped entries name the exact
columns. Sequence USAGE belongs only to roles inserting generated IDs.
Migrator owns all reviewed schema objects. The SQL file remains the executable
authority; tests compare it with ORM metadata and exercise actual login roles.

| Table | Customer API | Worker | Control Plane | Beat | Exporter |
| --- | --- | --- | --- | --- | --- |
| `execution_manifests` | S, I | S, I | — | — | — |
| `mail_outbox` | S, I, U | S, U, D | S (id, outbox_uuid, source_kind, source_id, category, originating_request_id, traceparent, tracestate, status, attempt_token, attempt_count, next_attempt_at, expires_at, dispatched_at, started_at, completed_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable, created_at, updated_at), U (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (attempt_count, category, completed_at, created_at, expires_at, failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, next_attempt_at, originating_request_id, outbox_uuid, started_at, status, updated_at) |
| `object_write_intents` | S, I, U | S, I, U | — | — | S (created_at, status) |
| `operators` | — | — | S, I, U | — | — |
| `pending_registrations` | S, I, U, D | — | — | — | — |
| `scheduler_heartbeats` | — | S, I, U | — | — | S (id, job_key, last_started_at, last_success_at, last_failure_at, last_duration_ms, last_due_count, last_dispatched_count, total_duration_ms, total_due_count, total_dispatched_count, lock_acquired_count, lock_skipped_count, last_lock_skipped_at, success_count, failure_count, last_error, created_at, updated_at) |
| `scheduler_leader_statuses` | — | — | — | S, I, U | S (scheduler_name, last_acquired_at, last_heartbeat_at, last_standby_at, last_child_exit_at, acquired_count, standby_count, child_exit_count, last_error, created_at, updated_at) |
| `storage_plan_policies` | S | S | S | — | — |
| `stored_objects` | S, I, U (sha256) | S, I, D, U (sha256) | — | — | — |
| `ops_audit_events` | — | — | S, I | — | — |
| `practice_bundles` | S, I, U, D | S, D, U (creation_expires_at) | — | — | — |
| `stored_object_retirements` | S, I, U | S, I, U | S, U (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (attempt_count, completed_at, created_at, failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, next_attempt_at, retirement_uuid, started_at, status, updated_at) |
| `users` | S, I, U | S (id, display_name, email, is_active, deleted_at, avatar_object_id, created_at, updated_at), U (avatar_object_id, updated_at) | — | — | — |
| `account_deletion_operations` | S, I, U | S, I, U | S, U (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (attempt_count, completed_at, created_at, failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, next_attempt_at, operation_uuid, phase, started_at, status, updated_at) |
| `auth_tokens` | S, I, U | — | — | — | — |
| `email_change_requests` | S, I, U | — | — | — | — |
| `import_jobs` | S, I, U, D | S, U, D | S, U (state, progress, current_step, processing_started_at, processing_last_heartbeat_at, processing_finished_at, confirmed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, id, job_uuid, processing_finished_at, processing_started_at, state, updated_at) |
| `notifications` | S, I, U | S, I, D | — | — | — |
| `operator_sessions` | — | — | S, I, U | — | — |
| `operator_mfa_challenges` | — | — | S, I, U, D | — | — |
| `operator_recovery_codes` | — | — | S, I, U, D | — | — |
| `performance_take_manifests` | S, I | S, D | — | — | — |
| `realtime_changes` | S, I | S, I, D | — | — | — |
| `realtime_stream_state` | S, I, U, D | S, I, U | — | — | — |
| `user_sessions` | S, I, U | — | — | — | — |
| `score_library_folders` | S, I, U, D | S, D | — | — | — |
| `storage_quota_holds` | S, I, U | S, U, D | — | — | — |
| `storage_usage_accounts` | S, I, U | S, U | — | — | — |
| `storage_usage_counters` | S, I, U | S, I, U | — | — | — |
| `storage_usage_events` | S, I | S, I, D | — | — | — |
| `upload_sessions` | S, I, U | S, U, D | — | — | S (cleanup_completed_at, created_at, expires_at, mode, operation_unknown, status) |
| `user_storage_entitlements` | S, I, U | S, U (updated_at) | — | — | — |
| `import_artifacts` | S, D | S, I, D | — | — | — |
| `import_dispatches` | S, I, U | S, U | S, U (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (attempt_count, completed_at, created_at, dispatch_uuid, failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, job_id, next_attempt_at, originating_request_id, started_at, status, updated_at) |
| `import_job_steps` | S, D | S, I, U, D | S (job_id), D | — | — |
| `performance_take_upload_reservations` | S, I, U, D | S, U, D | — | — | — |
| `scores` | S, I, U | S, D, U (head_revision_id, deleted_at, updated_at) | — | — | — |
| `uploads` | S, I, D, U (updated_at) | S, U, D | — | — | — |
| `guest_preview_credentials` | S, I, U, D | S, D, U (issued_at) | — | — | — |
| `import_job_uploads` | S, I, D | S, D | — | — | — |
| `performance_takes` | S, I, D, U (updated_at) | S, D, U (media_status, updated_at) | — | — | — |
| `score_deletion_operations` | S, I, U | S, I, U | S, U (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (attempt_count, completed_at, created_at, failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, next_attempt_at, operation_uuid, originating_request_id, score_uuid, started_at, status, updated_at) |
| `score_input_assets` | S, I, D | S, D | — | — | — |
| `score_invites` | S, I, U | S, U (email, token_hash, terminal_outcome, terminal_at, terminal_actor_user_id, created_by_user_id) | — | — | — |
| `score_library_organizations` | S, I, U, D | S, D | — | — | — |
| `score_memberships` | S, I, U | S, D, U (created_by_user_id) | — | — | — |
| `score_revisions` | S, I | S, U (created_by_user_id) | S | — | S (id, revision_uuid) |
| `upload_creation_requests` | S, I, U | S, D | — | — | — |
| `playback_outbox` | S, I, U | S, U | S, U (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (asset_kind, attempt_count, completed_at, created_at, failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, next_attempt_at, originating_request_id, outbox_uuid, started_at, status, updated_at) |
| `practice_activities` | S, I | S, D | — | — | — |
| `revision_metadata_outbox` | S, I, U | S, U | — | — | — |
| `score_playback_assets` | S | S, I, D | — | — | — |
| `score_render_assets` | S | S, I, D | — | — | — |
| `score_revision_events` | S, I | S, U (actor_user_id) | — | — | — |
| `score_revision_metadata` | S, I, U, D | S, I, U | — | — | — |
| `score_revision_notes` | S, I, U, D | S, U (author_user_id, updated_at) | — | — | — |
| `score_revision_practice_bindings` | S, I, U (created_at) | S | — | — | — |
| `score_revision_render_outbox` | S, I, U | S, U | S, U (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) | — | S (attempt_count, completed_at, created_at, failure_classification, failure_code, failure_detail, failure_retryable, failure_stage, next_attempt_at, originating_request_id, outbox_uuid, revision_id, started_at, status, updated_at) |
| `score_revision_sources` | S, I | S | — | — | — |
| `take_processing_outbox` | S, I, U | S, U | — | — | S (created_at, started_at, status) |

## Credential and audit boundaries

Customer API cannot access operator identities, password credentials, sessions or
Ops audit records. Control Plane cannot access customer User rows, credentials,
registration, opaque sessions or email-change requests. Its audit rights are
SELECT and INSERT only; its resource writes are limited to delivery recovery
columns. Import recovery also deletes `import_job_steps` by `job_id` through the
existing domain reset. It cannot rewrite retirement fences or resource identity.

Worker can read only credential-free User columns and update avatar attribution.
`resource_user_query()` uses ORM load-only plus raiseload so accidental password
access fails. Worker has no direct customer authentication-table access, operator
or audit access. Beat touches only `scheduler_leader_statuses`: periodic task
publication uses the broker; maintenance execution belongs to Worker. Exporter
can select only columns needed by its real metric queries and has no write,
sequence, credential, session, payload or object-key access.

## Guarded database functions

| Function | Execute roles | Effect |
| --- | --- | --- |
| `nv_authentication_mail_source_active(text,bigint)` | Worker | Returns source liveness only; credential rows and hashes never leave the function |
| `nv_mail_has_payload(text)` | Control Plane, Exporter | Returns a boolean for retry admission without exposing recipient, subject, credential links or body |
| `nv_erase_closed_authentication_history(bigint,integer)` | Worker | Bounded deletion of AuthToken, UserSession and EmailChangeRequest history for a locked, inactive tombstoned User in a PROCESSING/FINALIZE deletion operation |
| `nv_erase_closed_identity(bigint)` | Worker | Deletes only an inactive tombstoned User with PROCESSING/FINALIZE operation authority; existing FKs remain enforced |

These functions express narrow capabilities instead of granting the Worker token
reads or arbitrary User deletion. Account erasure keeps its current phases,
transactions, quotas and inventory checks. The executor validates business
completion before final identity erasure. Worker remains trusted to execute domain
cleanup; the SQL boundary does not validate external task delivery authorization.
Migration installs functions; downgrade drops them before schema teardown. Runtime
grants are provisioning state, not ORM metadata.

## Administrative commands

Every CLI receives an explicit `DATABASE_URL`; none discovers an administrator URL.
`create_operator.py` uses `nv_control_plane`. `seed_integration_user.py` uses
`nv_customer_api`. `rebuild_score_metadata.py` and `reconcile_storage_usage.py` use
`nv_worker`. Alembic and destructive development `reset_alembic.py` use
`nv_migrator` and must not run as application services. `prepare_model_assets.py`
uses no database or application credentials. Provisioning alone uses the explicit
administrator URL. Local test fixtures use their dedicated test-database owner for
schema setup; role-isolation tests log in as each actual role, rather than relying
on an administrator connection with simulated permissions.

## Verification and deployment boundary

`tests/security/test_db_role_isolation.py` provisions an isolated schema on real
PostgreSQL 17.11, migrates as `nv_migrator`, applies the allowlist twice and exercises
both legitimate operations and `InsufficientPrivilege` denials. Metadata drift,
DDL, column leakage, append-only audit, guarded erasure and default privileges
are checked. `tests/security/test_runtime_deployment_contract.py` validates the
generated Settings schema, Secret references and credential templates. Application,
GitOps, exporter and release-package validators enforce the same contract.

Kubernetes manifests define exact references; credentials must be provisioned by
the environment administrator or secret-management system. Database passwords,
cloud IAM policy, actual cluster Secret rotation and operator MFA delivery
are outside this contract's runtime implementation.

See [Settings Ownership](settings-ownership.md).

Control Plane customer metadata access is restricted to
`nv_customer_directory(integer,integer)` and
`nv_set_customer_active(bigint,bigint,boolean)`. The latter requires an active,
MFA-enrolled SUPER_ADMIN, locks the User and expires customer session idle
deadlines on suspension. Neither function returns credential material or grants
direct table access. Operator challenge/recovery/session tables have no grants to
other runtimes. Audit SELECT/INSERT permits append-only events in the mutation
transaction; UPDATE/DELETE remain denied. See
[Control Plane Authentication](../control-plane-auth.md).
