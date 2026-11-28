# Database Role and Secret Ownership

## Five-role runtime authority

Four long-lived backend deployments use distinct login roles and Secrets:
Customer API (`nv_customer_api`), Control Plane (`nv_control_plane`), Worker
(`nv_worker`) and Beat (`nv_beat`). The short-lived migration Job uses
`nv_migrator`, which owns the application schema, tables, sequences and functions.
Long-lived roles cannot own the database, inherit another role or execute DDL.

Roles are LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION
and NOBYPASSRLS. `PUBLIC` has no schema CREATE, database CREATE/TEMPORARY or
application table authority. Global and schema default privileges grant no
runtime access to new tables, sequences or functions.

## Three privilege tiers

1. Runtime authority determines which domain tables and operations each process
   can use. Beat has S/I/U only on `scheduler_leader_statuses`.
2. Ordinary business tables use explicit table-level S/I/U/D grants. A new
   non-sensitive column inherits only those reviewed operations; it needs no
   column checklist. Every new table requires a `-- TABLE` decision in
   `backend/db/grants.sql`, checked against ORM metadata.
3. Credential-bearing records retain strict boundaries. Cross-domain access to
   `users` is column- or function-scoped; customer sessions and operator identity
   records remain exclusive. Operator audit is append-only. Authentication-mail
   payloads are a credential-delivery boundary, not a general operational outbox
   projection.

The SQL file is the executable authority. Before granting access it revokes
ordinary table authority and clears column ACLs from catalog facts. Reapplication
removes excess column privileges without copying business column names into the
contract. Sequences receive USAGE only where generated IDs are inserted.

### Credential and audit boundaries

- `users`: Customer API owns S/I/U. Worker can SELECT only `id`, `display_name`,
  `email`, `is_active`, `deleted_at`, `avatar_object_id`, `created_at`, `updated_at`,
  and UPDATE only `avatar_object_id`, `updated_at`. Control Plane uses a bounded
  customer-directory function and a super-admin-checked status function. Worker,
  Control Plane and Beat cannot read `password_hash` or newly added identity columns.
- `user_sessions`, `auth_tokens`, `email_change_requests` and
  `pending_registrations` belong to Customer API. Other runtimes cannot directly
  inspect customer credential/token/session tables.
- The actual operator table is `operators`. It, `operator_sessions`,
  `operator_mfa_challenges` and `operator_recovery_codes` are Control Plane-only.
- `ops_audit_events`: Control Plane receives only SELECT/INSERT. No long-lived
  role receives UPDATE/DELETE; Customer API, Worker and Beat receive no access.
- `mail_outbox`: Worker reads credential-bearing payloads for delivery. Control
  Plane can read only the explicit operation/status projection and update retry
  state; it cannot read recipient, subject, text/HTML payloads or retarget the
  source identity. A bounded boolean function exposes payload presence only.

### Bounded functions

All functions use schema-qualified objects, `SECURITY DEFINER`,
`search_path=pg_catalog` and explicit EXECUTE grants:

- Worker: `nv_authentication_mail_source_active` returns source eligibility;
  `nv_erase_closed_authentication_history` erases bounded token/session batches;
  `nv_erase_closed_identity` deletes only an authorized closed identity. Erasure
  requires a closed user and active FINALIZE operation.
- Control Plane: `nv_customer_directory` returns bounded non-credential metadata;
  `nv_set_customer_active` verifies an active MFA-enrolled SUPER_ADMIN and expires
  customer sessions on disable; `nv_mail_has_payload` returns only a boolean.

Ordinary business-table operations need no privileged function wrapper.

## Exact table operations

S/I/U/D mean SELECT/INSERT/UPDATE/DELETE. `[columns]` means the explicit sensitive
projection in SQL. Migrator owns every reviewed object.

| Table | Customer API | Control Plane | Worker | Beat |
| --- | --- | --- | --- | --- |
| `execution_manifests` | S, I | — | S, I | — |
| `mail_outbox` | S, I, U | S [columns], U [columns] | S, U, D | — |
| `object_write_intents` | S, I, U | S | S, I, U | — |
| `pending_registrations` | S, I, U, D | — | — | — |
| `scheduler_heartbeats` | — | S | S, I, U | — |
| `scheduler_leader_statuses` | — | S | — | S, I, U |
| `storage_plan_policies` | S | S | S | — |
| `stored_objects` | S, I, U | — | S, I, U, D | — |
| `practice_bundles` | S, I, U, D | — | S, U, D | — |
| `stored_object_retirements` | S, I, U | S, U | S, I, U | — |
| `users` | S, I, U | — | S [columns], U [columns] | — |
| `account_deletion_operations` | S, I, U | S, U | S, I, U | — |
| `auth_tokens` | S, I, U | — | — | — |
| `email_change_requests` | S, I, U | — | — | — |
| `import_jobs` | S, I, U, D | S, U | S, U, D | — |
| `notifications` | S, I, U | — | S, I, D | — |
| `performance_take_manifests` | S, I | — | S, D | — |
| `realtime_changes` | S, I | — | S, I, D | — |
| `realtime_stream_state` | S, I, U, D | — | S, I, U | — |
| `user_sessions` | S, I, U | — | — | — |
| `score_library_folders` | S, I, U, D | — | S, D | — |
| `storage_quota_holds` | S, I, U | — | S, U, D | — |
| `storage_usage_accounts` | S, I, U | — | S, U | — |
| `storage_usage_counters` | S, I, U | — | S, I, U | — |
| `storage_usage_events` | S, I | — | S, I, D | — |
| `upload_sessions` | S, I, U | S | S, U, D | — |
| `user_storage_entitlements` | S, I, U | — | S, U | — |
| `import_artifacts` | S, D | — | S, I, D | — |
| `import_dispatches` | S, I, U | S, U | S, U | — |
| `import_job_steps` | S, D | S, D | S, I, U, D | — |
| `performance_take_upload_reservations` | S, I, U, D | — | S, U, D | — |
| `scores` | S, I, U | — | S, U, D | — |
| `uploads` | S, I, U, D | — | S, U, D | — |
| `guest_preview_credentials` | S, I, U, D | — | S, U, D | — |
| `import_job_uploads` | S, I, D | — | S, D | — |
| `performance_takes` | S, I, U, D | — | S, U, D | — |
| `score_deletion_operations` | S, I, U | S, U | S, I, U | — |
| `score_input_assets` | S, I, D | — | S, D | — |
| `score_invites` | S, I, U | — | S, U | — |
| `score_library_organizations` | S, I, U, D | — | S, D | — |
| `score_memberships` | S, I, U | — | S, U, D | — |
| `score_revisions` | S, I | S | S, U | — |
| `upload_creation_requests` | S, I, U | — | S, D | — |
| `playback_outbox` | S, I, U | S, U | S, U | — |
| `practice_activities` | S, I | — | S, D | — |
| `revision_metadata_outbox` | S, I, U | — | S, U | — |
| `score_playback_assets` | S | — | S, I, D | — |
| `score_render_assets` | S | — | S, I, D | — |
| `score_revision_events` | S, I | — | S, U | — |
| `score_revision_metadata` | S, I, U, D | — | S, I, U | — |
| `score_revision_notes` | S, I, U, D | — | S, U | — |
| `score_revision_practice_bindings` | S, I, U | — | S | — |
| `score_revision_render_outbox` | S, I, U | S, U | S, U | — |
| `score_revision_sources` | S, I | — | S | — |
| `take_processing_outbox` | S, I, U | S | S, U | — |
| `operators` | — | S, I, U | — | — |
| `operator_sessions` | — | S, I, U | — | — |
| `operator_mfa_challenges` | — | S, I, U, D | — | — |
| `operator_recovery_codes` | — | S, I, U, D | — | — |
| `ops_audit_events` | — | S, I | — | — |

## Provisioning and process credentials

1. A database administrator supplies `NOTEVERSE_DB_ADMIN_URL` and five distinct
   passwords: `NV_MIGRATOR_PASSWORD`, `NV_CUSTOMER_API_PASSWORD`,
   `NV_CONTROL_PLANE_PASSWORD`, `NV_WORKER_PASSWORD`, `NV_BEAT_PASSWORD`.
2. From `backend/`, run `python scripts/provision_database.py bootstrap --schema public`.
   The helper validates role attributes/memberships and schema ownership. It
   refuses an occupied schema owned by another role and never discards data.
3. Set `DATABASE_URL` to `nv_migrator`, run `alembic upgrade head`, then
   `python scripts/provision_database.py grants --schema public`. The container
   migrate command performs both. New tables have no automatic runtime authority.
4. Populate the five runtime database Secrets from `backend/db/secret-templates/`
   and run `scripts/validate_runtime_secrets.py`. Worker/Beat scheduler-lock URLs
   use their own role. Secrets and Settings share the
   [settings ownership contract](settings-ownership.md).

CLI bootstrap/operator commands use the explicit Control Plane DB URL; resource
seed/metadata commands use Customer API; reconciliation/cleanup commands use
Worker. Administrative provisioning and migrations are not persistent services.
The helper does not print credentials or SQL diagnostics on failure.

## Internal metrics and infrastructure

Control Plane's internal `/metrics` runs under `nv_control_plane` and projects
bounded operation counts, ages, durations, scheduler state and storage cleanup
backlogs. Its SELECT authority covers the exact metric source tables above.
Prometheus reaches TCP 8000 inside the cluster; Gateway routing preserves `/api`
and cannot forward or rewrite requests to `/metrics`.

PostgreSQL connections, locks, bloat and replication belong to standard
`postgres_exporter`, operated by database infrastructure with separate
infrastructure credentials. The five application roles do not receive
`pg_monitor` or administrative observation rights.
