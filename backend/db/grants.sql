-- Application PostgreSQL grants. Apply after migrations as nv_migrator.
-- No runtime owns schema objects or receives default privileges.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
REVOKE CREATE ON SCHEMA __APP_SCHEMA__ FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SCHEMA __APP_SCHEMA__ TO nv_customer_api, nv_worker, nv_control_plane, nv_beat;
-- Reset column ACLs from catalog facts; business columns need no grant checklist.
DO $column_privileges$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT format('%I.%I', n.nspname, c.relname) AS relation,
           string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) AS columns
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
     WHERE n.nspname=__APP_SCHEMA_LITERAL__ AND c.relkind IN ('r','p')
       AND a.attnum>0 AND NOT a.attisdropped
     GROUP BY n.nspname,c.relname
  LOOP
    EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE %2$s FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat', target.columns, target.relation);
  END LOOP;
END
$column_privileges$;

-- TABLE execution_manifests
REVOKE ALL ON TABLE __APP_SCHEMA__.execution_manifests FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.execution_manifests TO nv_customer_api;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.execution_manifests TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.execution_manifests_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.execution_manifests_id_seq TO nv_customer_api, nv_worker;
-- TABLE mail_outbox
REVOKE ALL ON TABLE __APP_SCHEMA__.mail_outbox FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.mail_outbox TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.mail_outbox TO nv_worker;
GRANT SELECT (id, outbox_uuid, source_kind, source_id, category, originating_request_id, traceparent, tracestate, status, attempt_token, attempt_count, next_attempt_at, expires_at, dispatched_at, started_at, completed_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable, created_at, updated_at), UPDATE (status, attempt_token, attempt_count, next_attempt_at, dispatched_at, started_at, completed_at, updated_at, failure_detail, failure_code, failure_stage, failure_classification, failure_retryable) ON TABLE __APP_SCHEMA__.mail_outbox TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.mail_outbox_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.mail_outbox_id_seq TO nv_customer_api;
-- TABLE object_write_intents
REVOKE ALL ON TABLE __APP_SCHEMA__.object_write_intents FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.object_write_intents TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.object_write_intents TO nv_worker;
GRANT SELECT ON TABLE __APP_SCHEMA__.object_write_intents TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.object_write_intents_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.object_write_intents_id_seq TO nv_customer_api, nv_worker;
-- TABLE pending_registrations
REVOKE ALL ON TABLE __APP_SCHEMA__.pending_registrations FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.pending_registrations TO nv_customer_api;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.pending_registrations_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.pending_registrations_id_seq TO nv_customer_api;
-- TABLE scheduler_heartbeats
REVOKE ALL ON TABLE __APP_SCHEMA__.scheduler_heartbeats FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.scheduler_heartbeats TO nv_worker;
GRANT SELECT ON TABLE __APP_SCHEMA__.scheduler_heartbeats TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.scheduler_heartbeats_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.scheduler_heartbeats_id_seq TO nv_worker;
-- TABLE scheduler_leader_statuses
REVOKE ALL ON TABLE __APP_SCHEMA__.scheduler_leader_statuses FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.scheduler_leader_statuses TO nv_beat;
GRANT SELECT ON TABLE __APP_SCHEMA__.scheduler_leader_statuses TO nv_control_plane;
-- TABLE storage_plan_policies
REVOKE ALL ON TABLE __APP_SCHEMA__.storage_plan_policies FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT ON TABLE __APP_SCHEMA__.storage_plan_policies TO nv_customer_api;
GRANT SELECT ON TABLE __APP_SCHEMA__.storage_plan_policies TO nv_worker;
GRANT SELECT ON TABLE __APP_SCHEMA__.storage_plan_policies TO nv_control_plane;
-- TABLE stored_objects
REVOKE ALL ON TABLE __APP_SCHEMA__.stored_objects FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.stored_objects TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.stored_objects TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.stored_objects_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.stored_objects_id_seq TO nv_customer_api, nv_worker;
-- TABLE practice_bundles
REVOKE ALL ON TABLE __APP_SCHEMA__.practice_bundles FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.practice_bundles TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.practice_bundles TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.practice_bundles_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.practice_bundles_id_seq TO nv_customer_api;
-- TABLE stored_object_retirements
REVOKE ALL ON TABLE __APP_SCHEMA__.stored_object_retirements FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.stored_object_retirements TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.stored_object_retirements TO nv_worker;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.stored_object_retirements TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.stored_object_retirements_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.stored_object_retirements_id_seq TO nv_customer_api, nv_worker;
-- TABLE users
REVOKE ALL ON TABLE __APP_SCHEMA__.users FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.users TO nv_customer_api;
GRANT SELECT (id, display_name, email, is_active, deleted_at, avatar_object_id, created_at, updated_at), UPDATE (avatar_object_id, updated_at) ON TABLE __APP_SCHEMA__.users TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.users_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.users_id_seq TO nv_customer_api;
-- TABLE account_deletion_operations
REVOKE ALL ON TABLE __APP_SCHEMA__.account_deletion_operations FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.account_deletion_operations TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.account_deletion_operations TO nv_worker;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.account_deletion_operations TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.account_deletion_operations_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.account_deletion_operations_id_seq TO nv_customer_api, nv_worker;
-- TABLE auth_tokens
REVOKE ALL ON TABLE __APP_SCHEMA__.auth_tokens FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.auth_tokens TO nv_customer_api;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.auth_tokens_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.auth_tokens_id_seq TO nv_customer_api;
-- TABLE email_change_requests
REVOKE ALL ON TABLE __APP_SCHEMA__.email_change_requests FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.email_change_requests TO nv_customer_api;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.email_change_requests_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.email_change_requests_id_seq TO nv_customer_api;
-- TABLE import_jobs
REVOKE ALL ON TABLE __APP_SCHEMA__.import_jobs FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.import_jobs TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.import_jobs TO nv_worker;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.import_jobs TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.import_jobs_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.import_jobs_id_seq TO nv_customer_api;
-- TABLE notifications
REVOKE ALL ON TABLE __APP_SCHEMA__.notifications FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.notifications TO nv_customer_api;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.notifications TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.notifications_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.notifications_id_seq TO nv_customer_api, nv_worker;
-- TABLE performance_take_manifests
REVOKE ALL ON TABLE __APP_SCHEMA__.performance_take_manifests FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.performance_take_manifests TO nv_customer_api;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.performance_take_manifests TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.performance_take_manifests_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.performance_take_manifests_id_seq TO nv_customer_api;
-- TABLE realtime_changes
REVOKE ALL ON TABLE __APP_SCHEMA__.realtime_changes FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.realtime_changes TO nv_customer_api;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.realtime_changes TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.realtime_changes_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.realtime_changes_id_seq TO nv_customer_api, nv_worker;
-- TABLE realtime_stream_state
REVOKE ALL ON TABLE __APP_SCHEMA__.realtime_stream_state FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.realtime_stream_state TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.realtime_stream_state TO nv_worker;
-- TABLE user_sessions
REVOKE ALL ON TABLE __APP_SCHEMA__.user_sessions FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.user_sessions TO nv_customer_api;
-- TABLE score_library_folders
REVOKE ALL ON TABLE __APP_SCHEMA__.score_library_folders FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.score_library_folders TO nv_customer_api;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.score_library_folders TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_library_folders_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_library_folders_id_seq TO nv_customer_api;
-- TABLE storage_quota_holds
REVOKE ALL ON TABLE __APP_SCHEMA__.storage_quota_holds FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.storage_quota_holds TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.storage_quota_holds TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.storage_quota_holds_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.storage_quota_holds_id_seq TO nv_customer_api;
-- TABLE storage_usage_accounts
REVOKE ALL ON TABLE __APP_SCHEMA__.storage_usage_accounts FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.storage_usage_accounts TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.storage_usage_accounts TO nv_worker;
-- TABLE storage_usage_counters
REVOKE ALL ON TABLE __APP_SCHEMA__.storage_usage_counters FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.storage_usage_counters TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.storage_usage_counters TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.storage_usage_counters_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.storage_usage_counters_id_seq TO nv_customer_api, nv_worker;
-- TABLE storage_usage_events
REVOKE ALL ON TABLE __APP_SCHEMA__.storage_usage_events FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.storage_usage_events TO nv_customer_api;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.storage_usage_events TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.storage_usage_events_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.storage_usage_events_id_seq TO nv_customer_api, nv_worker;
-- TABLE upload_sessions
REVOKE ALL ON TABLE __APP_SCHEMA__.upload_sessions FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.upload_sessions TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.upload_sessions TO nv_worker;
GRANT SELECT ON TABLE __APP_SCHEMA__.upload_sessions TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.upload_sessions_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.upload_sessions_id_seq TO nv_customer_api;
-- TABLE user_storage_entitlements
REVOKE ALL ON TABLE __APP_SCHEMA__.user_storage_entitlements FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.user_storage_entitlements TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.user_storage_entitlements TO nv_worker;
-- TABLE import_artifacts
REVOKE ALL ON TABLE __APP_SCHEMA__.import_artifacts FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.import_artifacts TO nv_customer_api;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.import_artifacts TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.import_artifacts_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.import_artifacts_id_seq TO nv_worker;
-- TABLE import_dispatches
REVOKE ALL ON TABLE __APP_SCHEMA__.import_dispatches FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.import_dispatches TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.import_dispatches TO nv_worker;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.import_dispatches TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.import_dispatches_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.import_dispatches_id_seq TO nv_customer_api;
-- TABLE import_job_steps
REVOKE ALL ON TABLE __APP_SCHEMA__.import_job_steps FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.import_job_steps TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.import_job_steps TO nv_worker;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.import_job_steps TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.import_job_steps_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.import_job_steps_id_seq TO nv_worker;
-- TABLE performance_take_upload_reservations
REVOKE ALL ON TABLE __APP_SCHEMA__.performance_take_upload_reservations FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.performance_take_upload_reservations TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.performance_take_upload_reservations TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.performance_take_upload_reservations_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.performance_take_upload_reservations_id_seq TO nv_customer_api;
-- TABLE scores
REVOKE ALL ON TABLE __APP_SCHEMA__.scores FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.scores TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.scores TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.scores_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.scores_id_seq TO nv_customer_api;
-- TABLE uploads
REVOKE ALL ON TABLE __APP_SCHEMA__.uploads FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.uploads TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.uploads TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.uploads_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.uploads_id_seq TO nv_customer_api;
-- TABLE guest_preview_credentials
REVOKE ALL ON TABLE __APP_SCHEMA__.guest_preview_credentials FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.guest_preview_credentials TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.guest_preview_credentials TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.guest_preview_credentials_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.guest_preview_credentials_id_seq TO nv_customer_api;
-- TABLE import_job_uploads
REVOKE ALL ON TABLE __APP_SCHEMA__.import_job_uploads FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.import_job_uploads TO nv_customer_api;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.import_job_uploads TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.import_job_uploads_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.import_job_uploads_id_seq TO nv_customer_api;
-- TABLE performance_takes
REVOKE ALL ON TABLE __APP_SCHEMA__.performance_takes FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.performance_takes TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.performance_takes TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.performance_takes_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.performance_takes_id_seq TO nv_customer_api;
-- TABLE score_deletion_operations
REVOKE ALL ON TABLE __APP_SCHEMA__.score_deletion_operations FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.score_deletion_operations TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.score_deletion_operations TO nv_worker;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.score_deletion_operations TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_deletion_operations_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_deletion_operations_id_seq TO nv_customer_api, nv_worker;
-- TABLE score_input_assets
REVOKE ALL ON TABLE __APP_SCHEMA__.score_input_assets FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.score_input_assets TO nv_customer_api;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.score_input_assets TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_input_assets_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_input_assets_id_seq TO nv_customer_api;
-- TABLE score_invites
REVOKE ALL ON TABLE __APP_SCHEMA__.score_invites FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.score_invites TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.score_invites TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_invites_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_invites_id_seq TO nv_customer_api;
-- TABLE score_library_organizations
REVOKE ALL ON TABLE __APP_SCHEMA__.score_library_organizations FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.score_library_organizations TO nv_customer_api;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.score_library_organizations TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_library_organizations_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_library_organizations_id_seq TO nv_customer_api;
-- TABLE score_memberships
REVOKE ALL ON TABLE __APP_SCHEMA__.score_memberships FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.score_memberships TO nv_customer_api;
GRANT SELECT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.score_memberships TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_memberships_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_memberships_id_seq TO nv_customer_api;
-- TABLE score_revisions
REVOKE ALL ON TABLE __APP_SCHEMA__.score_revisions FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.score_revisions TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.score_revisions TO nv_worker;
GRANT SELECT ON TABLE __APP_SCHEMA__.score_revisions TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_revisions_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_revisions_id_seq TO nv_customer_api;
-- TABLE upload_creation_requests
REVOKE ALL ON TABLE __APP_SCHEMA__.upload_creation_requests FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.upload_creation_requests TO nv_customer_api;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.upload_creation_requests TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.upload_creation_requests_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.upload_creation_requests_id_seq TO nv_customer_api;
-- TABLE playback_outbox
REVOKE ALL ON TABLE __APP_SCHEMA__.playback_outbox FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.playback_outbox TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.playback_outbox TO nv_worker;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.playback_outbox TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.playback_outbox_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.playback_outbox_id_seq TO nv_customer_api;
-- TABLE practice_activities
REVOKE ALL ON TABLE __APP_SCHEMA__.practice_activities FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.practice_activities TO nv_customer_api;
GRANT SELECT, DELETE ON TABLE __APP_SCHEMA__.practice_activities TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.practice_activities_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.practice_activities_id_seq TO nv_customer_api;
-- TABLE revision_metadata_outbox
REVOKE ALL ON TABLE __APP_SCHEMA__.revision_metadata_outbox FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.revision_metadata_outbox TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.revision_metadata_outbox TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.revision_metadata_outbox_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.revision_metadata_outbox_id_seq TO nv_customer_api;
-- TABLE score_playback_assets
REVOKE ALL ON TABLE __APP_SCHEMA__.score_playback_assets FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT ON TABLE __APP_SCHEMA__.score_playback_assets TO nv_customer_api;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.score_playback_assets TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_playback_assets_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_playback_assets_id_seq TO nv_worker;
-- TABLE score_render_assets
REVOKE ALL ON TABLE __APP_SCHEMA__.score_render_assets FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT ON TABLE __APP_SCHEMA__.score_render_assets TO nv_customer_api;
GRANT SELECT, INSERT, DELETE ON TABLE __APP_SCHEMA__.score_render_assets TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_render_assets_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_render_assets_id_seq TO nv_worker;
-- TABLE score_revision_events
REVOKE ALL ON TABLE __APP_SCHEMA__.score_revision_events FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.score_revision_events TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.score_revision_events TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_revision_events_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_revision_events_id_seq TO nv_customer_api;
-- TABLE score_revision_metadata
REVOKE ALL ON TABLE __APP_SCHEMA__.score_revision_metadata FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.score_revision_metadata TO nv_customer_api;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.score_revision_metadata TO nv_worker;
-- TABLE score_revision_notes
REVOKE ALL ON TABLE __APP_SCHEMA__.score_revision_notes FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.score_revision_notes TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.score_revision_notes TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_revision_notes_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_revision_notes_id_seq TO nv_customer_api;
-- TABLE score_revision_practice_bindings
REVOKE ALL ON TABLE __APP_SCHEMA__.score_revision_practice_bindings FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.score_revision_practice_bindings TO nv_customer_api;
GRANT SELECT ON TABLE __APP_SCHEMA__.score_revision_practice_bindings TO nv_worker;
-- TABLE score_revision_render_outbox
REVOKE ALL ON TABLE __APP_SCHEMA__.score_revision_render_outbox FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.score_revision_render_outbox TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.score_revision_render_outbox TO nv_worker;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.score_revision_render_outbox TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_revision_render_outbox_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_revision_render_outbox_id_seq TO nv_customer_api;
-- TABLE score_revision_sources
REVOKE ALL ON TABLE __APP_SCHEMA__.score_revision_sources FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.score_revision_sources TO nv_customer_api;
GRANT SELECT ON TABLE __APP_SCHEMA__.score_revision_sources TO nv_worker;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.score_revision_sources_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.score_revision_sources_id_seq TO nv_customer_api;
-- TABLE take_processing_outbox
REVOKE ALL ON TABLE __APP_SCHEMA__.take_processing_outbox FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.take_processing_outbox TO nv_customer_api;
GRANT SELECT, UPDATE ON TABLE __APP_SCHEMA__.take_processing_outbox TO nv_worker;
GRANT SELECT ON TABLE __APP_SCHEMA__.take_processing_outbox TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.take_processing_outbox_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.take_processing_outbox_id_seq TO nv_customer_api;
-- TABLE operators
REVOKE ALL ON TABLE __APP_SCHEMA__.operators FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.operators TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.operators_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.operators_id_seq TO nv_control_plane;
-- TABLE operator_sessions
REVOKE ALL ON TABLE __APP_SCHEMA__.operator_sessions FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE ON TABLE __APP_SCHEMA__.operator_sessions TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.operator_sessions_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.operator_sessions_id_seq TO nv_control_plane;
-- TABLE operator_mfa_challenges
REVOKE ALL ON TABLE __APP_SCHEMA__.operator_mfa_challenges FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.operator_mfa_challenges TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.operator_mfa_challenges_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.operator_mfa_challenges_id_seq TO nv_control_plane;
-- TABLE operator_recovery_codes
REVOKE ALL ON TABLE __APP_SCHEMA__.operator_recovery_codes FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE __APP_SCHEMA__.operator_recovery_codes TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.operator_recovery_codes_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.operator_recovery_codes_id_seq TO nv_control_plane;
-- TABLE ops_audit_events
REVOKE ALL ON TABLE __APP_SCHEMA__.ops_audit_events FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT SELECT, INSERT ON TABLE __APP_SCHEMA__.ops_audit_events TO nv_control_plane;
REVOKE ALL ON SEQUENCE __APP_SCHEMA__.ops_audit_events_id_seq FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT USAGE ON SEQUENCE __APP_SCHEMA__.ops_audit_events_id_seq TO nv_control_plane;
ALTER DEFAULT PRIVILEGES FOR ROLE nv_migrator REVOKE ALL ON TABLES FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
ALTER DEFAULT PRIVILEGES FOR ROLE nv_migrator REVOKE ALL ON SEQUENCES FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
ALTER DEFAULT PRIVILEGES FOR ROLE nv_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
ALTER DEFAULT PRIVILEGES FOR ROLE nv_migrator IN SCHEMA __APP_SCHEMA__ REVOKE ALL ON TABLES FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
ALTER DEFAULT PRIVILEGES FOR ROLE nv_migrator IN SCHEMA __APP_SCHEMA__ REVOKE ALL ON SEQUENCES FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
ALTER DEFAULT PRIVILEGES FOR ROLE nv_migrator IN SCHEMA __APP_SCHEMA__ REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_authentication_mail_source_active(text,bigint) FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT EXECUTE ON FUNCTION __APP_SCHEMA__.nv_authentication_mail_source_active(text,bigint) TO nv_worker;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_mail_has_payload(text) FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT EXECUTE ON FUNCTION __APP_SCHEMA__.nv_mail_has_payload(text) TO nv_control_plane;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_erase_closed_authentication_history(bigint,integer) FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT EXECUTE ON FUNCTION __APP_SCHEMA__.nv_erase_closed_authentication_history(bigint,integer) TO nv_worker;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_erase_closed_identity(bigint) FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT EXECUTE ON FUNCTION __APP_SCHEMA__.nv_erase_closed_identity(bigint) TO nv_worker;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_customer_directory(integer,integer) FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT EXECUTE ON FUNCTION __APP_SCHEMA__.nv_customer_directory(integer,integer) TO nv_control_plane;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_set_customer_active(bigint,bigint,boolean) FROM PUBLIC, nv_customer_api, nv_worker, nv_control_plane, nv_beat;
GRANT EXECUTE ON FUNCTION __APP_SCHEMA__.nv_set_customer_active(bigint,bigint,boolean) TO nv_control_plane;
