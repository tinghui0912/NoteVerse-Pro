"""Isolated PostgreSQL locator/claim proof DDL. Never imported by application code.

SETTLED and resource-set closure are trusted execution declarations. These SQL
guards cannot establish that a Provider's internal late IO has ended.
"""

from sqlalchemy import text


def install_physical_ledger_design(db):
    schema = db.scalar(text("SELECT current_schema()"))
    assert schema.replace("_", "").isalnum()
    statements = [
        """ALTER TABLE gate_sessions ADD FOREIGN KEY(cleanup_operation_uuid)
          REFERENCES gate_physical_operations(operation_uuid) DEFERRABLE INITIALLY DEFERRED""",
        """CREATE TABLE gate_operation_claims (
          operation_uuid uuid NOT NULL REFERENCES gate_physical_operations(operation_uuid) ON DELETE RESTRICT,
          claim_epoch bigint NOT NULL CHECK(claim_epoch>0), attempt_token uuid NOT NULL UNIQUE,
          previous_epoch bigint, previous_token uuid,
          PRIMARY KEY(operation_uuid,claim_epoch), UNIQUE(operation_uuid,claim_epoch,attempt_token),
          CHECK((claim_epoch=1 AND previous_epoch IS NULL AND previous_token IS NULL)
             OR (claim_epoch>1 AND previous_epoch=claim_epoch-1 AND previous_token IS NOT NULL)),
          FOREIGN KEY(operation_uuid,previous_epoch,previous_token)
            REFERENCES gate_operation_claims(operation_uuid,claim_epoch,attempt_token)
        )""",
        """CREATE TABLE gate_physical_resources (
          resource_uuid uuid PRIMARY KEY, session_id bigint REFERENCES gate_sessions(id) ON DELETE SET NULL,
          session_uuid_snapshot uuid NOT NULL, session_generation integer NOT NULL CHECK(session_generation>0),
          cleanup_operation_uuid uuid NOT NULL REFERENCES gate_physical_operations(operation_uuid) ON DELETE RESTRICT,
          resource_kind text NOT NULL CHECK(resource_kind IN ('MPU','STAGING_OBJECT','COPY_CANDIDATE')),
          object_key text NOT NULL CHECK(length(object_key)>0), provider_upload_id text,
          physical_generation uuid NOT NULL, version_id text,
          locator_fingerprint text NOT NULL CHECK(locator_fingerprint ~ '^[0-9a-f]{64}$'),
          CHECK((resource_kind='MPU' AND provider_upload_id IS NOT NULL AND length(provider_upload_id)>0 AND version_id IS NULL)
             OR (resource_kind<>'MPU' AND provider_upload_id IS NULL)),
          CHECK(version_id IS NULL OR length(version_id)>0),
          UNIQUE NULLS NOT DISTINCT(session_uuid_snapshot,session_generation,resource_kind,object_key,provider_upload_id,physical_generation,version_id)
        )""",
        """CREATE TABLE gate_resource_settlements (
          resource_uuid uuid NOT NULL REFERENCES gate_physical_resources(resource_uuid) ON DELETE RESTRICT,
          operation_uuid uuid NOT NULL REFERENCES gate_physical_operations(operation_uuid) ON DELETE RESTRICT,
          claim_epoch bigint NOT NULL, attempt_token uuid NOT NULL,
          resource_kind text NOT NULL, object_key text NOT NULL, provider_upload_id text,
          physical_generation uuid NOT NULL, version_id text,
          settlement_status text NOT NULL DEFAULT 'SETTLED' CHECK(settlement_status='SETTLED'),
          operation_result text NOT NULL DEFAULT 'REMOVED' CHECK(operation_result='REMOVED'),
          PRIMARY KEY(resource_uuid,claim_epoch),
          FOREIGN KEY(operation_uuid,claim_epoch,attempt_token)
            REFERENCES gate_operation_claims(operation_uuid,claim_epoch,attempt_token)
        )""",
        """CREATE FUNCTION gate_cleanup_ready(target uuid) RETURNS boolean LANGUAGE sql AS $$
          SELECT EXISTS(SELECT 1 FROM gate_physical_operations o JOIN gate_sessions s ON s.id=o.session_id
            WHERE o.operation_uuid=target AND o.operation_kind='CLEANUP'
              AND s.cleanup_operation_uuid=o.operation_uuid AND s.session_uuid=o.session_uuid_snapshot
              AND s.generation=o.session_generation AND s.terminal AND s.resources_closed
              AND EXISTS(SELECT 1 FROM gate_physical_resources r WHERE r.session_id=s.id)
              AND NOT EXISTS(SELECT 1 FROM gate_physical_resources r
                WHERE (r.session_id=s.id OR r.session_uuid_snapshot=s.session_uuid)
                AND (r.session_uuid_snapshot<>s.session_uuid OR r.session_generation<>s.generation
                  OR r.cleanup_operation_uuid<>o.operation_uuid OR NOT EXISTS(
                    SELECT 1 FROM gate_resource_settlements a WHERE a.resource_uuid=r.resource_uuid
                      AND a.operation_uuid=o.operation_uuid AND a.claim_epoch=o.claim_epoch AND a.attempt_token=o.attempt_token
                      AND a.resource_kind=r.resource_kind AND a.object_key=r.object_key
                      AND a.provider_upload_id IS NOT DISTINCT FROM r.provider_upload_id
                      AND a.physical_generation=r.physical_generation AND a.version_id IS NOT DISTINCT FROM r.version_id
                      AND a.operation_result='REMOVED' AND a.settlement_status='SETTLED')))
              AND NOT EXISTS(SELECT 1 FROM gate_physical_operations other
                WHERE (other.session_id=s.id OR other.session_uuid_snapshot=s.session_uuid)
                  AND other.operation_uuid<>o.operation_uuid AND other.settlement_status<>'SETTLED'))
        $$""",
        """CREATE FUNCTION gate_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'execution evidence is immutable' USING ERRCODE='23514'; END $$""",
        "CREATE TRIGGER gate_claims_immutable BEFORE UPDATE OR DELETE ON gate_operation_claims FOR EACH ROW EXECUTE FUNCTION gate_evidence_immutable()",
        "CREATE TRIGGER gate_settlements_immutable BEFORE UPDATE OR DELETE ON gate_resource_settlements FOR EACH ROW EXECUTE FUNCTION gate_evidence_immutable()",
        """CREATE FUNCTION gate_session_resource_fence() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.cleanup_operation_uuid IS NOT NULL AND NEW.cleanup_operation_uuid IS DISTINCT FROM OLD.cleanup_operation_uuid THEN
            RAISE EXCEPTION 'cleanup operation identity is immutable' USING ERRCODE='23514';
          END IF;
          IF (OLD.resources_closed AND NOT NEW.resources_closed) OR (NEW.resources_closed AND NOT NEW.terminal) THEN
            RAISE EXCEPTION 'resource registration fence is irreversible' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$""",
        "CREATE TRIGGER gate_session_resource_fence BEFORE UPDATE ON gate_sessions FOR EACH ROW EXECUTE FUNCTION gate_session_resource_fence()",
        """CREATE FUNCTION gate_resource_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP='DELETE' THEN RAISE EXCEPTION 'physical evidence is retained' USING ERRCODE='23514'; END IF;
          IF TG_OP='UPDATE' THEN
            IF ROW(NEW.resource_uuid,NEW.session_uuid_snapshot,NEW.session_generation,NEW.cleanup_operation_uuid,NEW.resource_kind,NEW.object_key,NEW.provider_upload_id,NEW.physical_generation,NEW.version_id,NEW.locator_fingerprint) IS DISTINCT FROM ROW(OLD.resource_uuid,OLD.session_uuid_snapshot,OLD.session_generation,OLD.cleanup_operation_uuid,OLD.resource_kind,OLD.object_key,OLD.provider_upload_id,OLD.physical_generation,OLD.version_id,OLD.locator_fingerprint) OR NOT
              (OLD.session_id IS NOT NULL AND NEW.session_id IS NULL AND NOT EXISTS(SELECT 1 FROM gate_sessions WHERE id=OLD.session_id)) THEN
              RAISE EXCEPTION 'physical locator is immutable' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
          END IF;
          PERFORM 1 FROM gate_sessions s WHERE s.id=NEW.session_id AND s.session_uuid=NEW.session_uuid_snapshot
            AND s.generation=NEW.session_generation AND NOT s.resources_closed
            AND s.cleanup_operation_uuid=NEW.cleanup_operation_uuid FOR KEY SHARE;
          IF NOT FOUND THEN RAISE EXCEPTION 'resource registration identity or fence mismatch' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END $$""",
        "CREATE TRIGGER gate_resource_guard BEFORE INSERT OR UPDATE OR DELETE ON gate_physical_resources FOR EACH ROW EXECUTE FUNCTION gate_resource_guard()",
        """CREATE FUNCTION gate_resource_ack_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM 1 FROM gate_physical_operations WHERE operation_uuid=NEW.operation_uuid FOR SHARE;
          IF NOT EXISTS(SELECT 1 FROM gate_physical_resources r JOIN gate_physical_operations o ON o.operation_uuid=r.cleanup_operation_uuid
            JOIN gate_sessions s ON s.id=r.session_id
            WHERE r.resource_uuid=NEW.resource_uuid AND o.operation_uuid=NEW.operation_uuid AND o.operation_kind='CLEANUP'
              AND s.cleanup_operation_uuid=o.operation_uuid AND s.session_uuid=o.session_uuid_snapshot AND s.generation=o.session_generation
              AND r.session_uuid_snapshot=s.session_uuid AND r.session_generation=s.generation AND s.terminal AND s.resources_closed
              AND o.claim_epoch=NEW.claim_epoch AND o.attempt_token=NEW.attempt_token AND o.settlement_status<>'SETTLED'
              AND r.resource_kind=NEW.resource_kind AND r.object_key=NEW.object_key
              AND r.provider_upload_id IS NOT DISTINCT FROM NEW.provider_upload_id
              AND r.physical_generation=NEW.physical_generation AND r.version_id IS NOT DISTINCT FROM NEW.version_id) THEN
            RAISE EXCEPTION 'ACK must match registered physical locator and live claim' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$""",
        "CREATE TRIGGER gate_resource_ack_guard BEFORE INSERT ON gate_resource_settlements FOR EACH ROW EXECUTE FUNCTION gate_resource_ack_guard()",
        """CREATE FUNCTION gate_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP='DELETE' THEN RAISE EXCEPTION 'operation evidence requires approved retention' USING ERRCODE='23514'; END IF;
          IF TG_OP='INSERT' AND (NEW.claim_epoch<>1 OR NEW.settlement_status<>'PENDING' OR NEW.operation_result<>'NONE'
            OR NEW.published_attempt_token IS NOT NULL OR NEW.published_claim_epoch IS NOT NULL) THEN
            RAISE EXCEPTION 'operation must start pending without result' USING ERRCODE='23514';
          END IF;
          IF TG_OP='UPDATE' THEN
            IF ROW(NEW.id,NEW.operation_uuid,NEW.session_uuid_snapshot,NEW.session_generation,NEW.operation_kind)
              IS DISTINCT FROM ROW(OLD.id,OLD.operation_uuid,OLD.session_uuid_snapshot,OLD.session_generation,OLD.operation_kind) THEN
              RAISE EXCEPTION 'operation identity is immutable' USING ERRCODE='23514';
            END IF;
            IF NEW.session_id IS DISTINCT FROM OLD.session_id AND NOT
              (OLD.session_id IS NOT NULL AND NEW.session_id IS NULL AND NOT EXISTS(SELECT 1 FROM gate_sessions WHERE id=OLD.session_id)) THEN
              RAISE EXCEPTION 'operation parent cannot retarget' USING ERRCODE='23514';
            END IF;
            IF OLD.settlement_status='SETTLED' AND ROW(NEW.claim_epoch,NEW.attempt_token,NEW.published_claim_epoch,NEW.published_attempt_token,NEW.operation_result,NEW.settlement_status)
              IS DISTINCT FROM ROW(OLD.claim_epoch,OLD.attempt_token,OLD.published_claim_epoch,OLD.published_attempt_token,OLD.operation_result,OLD.settlement_status) THEN
              RAISE EXCEPTION 'settled result is immutable' USING ERRCODE='23514';
            END IF;
            IF ROW(NEW.claim_epoch,NEW.attempt_token) IS DISTINCT FROM ROW(OLD.claim_epoch,OLD.attempt_token) THEN
              IF NEW.claim_epoch<>OLD.claim_epoch+1 OR NOT EXISTS(SELECT 1 FROM gate_operation_claims c
                WHERE c.operation_uuid=OLD.operation_uuid AND c.claim_epoch=NEW.claim_epoch AND c.attempt_token=NEW.attempt_token
                  AND c.previous_epoch=OLD.claim_epoch AND c.previous_token=OLD.attempt_token) THEN
                RAISE EXCEPTION 'claim transition requires monotonic CAS evidence' USING ERRCODE='23514';
              END IF;
            END IF;
            IF NEW.operation_result<>'NONE' AND (NEW.claim_epoch<>OLD.claim_epoch OR NEW.attempt_token<>OLD.attempt_token
              OR NEW.published_claim_epoch IS DISTINCT FROM OLD.claim_epoch OR NEW.published_attempt_token IS DISTINCT FROM OLD.attempt_token) THEN
              RAISE EXCEPTION 'publication must match current attempt' USING ERRCODE='23514';
            END IF;
            IF NEW.operation_result='CLEANED' AND OLD.settlement_status<>'SETTLED' AND NOT gate_cleanup_ready(NEW.operation_uuid) THEN
              RAISE EXCEPTION 'all registered locators must settle before CLEANED' USING ERRCODE='23514';
            END IF;
          END IF;
          IF NEW.session_id IS NOT NULL THEN
            PERFORM 1 FROM gate_sessions WHERE id=NEW.session_id FOR KEY SHARE;
            IF NOT FOUND THEN RAISE EXCEPTION 'operation requires live parent' USING ERRCODE='23514'; END IF;
          ELSIF TG_OP='INSERT' THEN RAISE EXCEPTION 'new operation requires parent' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END $$""",
        "CREATE TRIGGER gate_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON gate_physical_operations FOR EACH ROW EXECUTE FUNCTION gate_operation_guard()",
        f'ALTER FUNCTION gate_operation_guard() SECURITY DEFINER SET search_path TO "{schema}",pg_temp',
        """CREATE FUNCTION gate_operation_registered() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO gate_operation_claims(operation_uuid,claim_epoch,attempt_token) VALUES(NEW.operation_uuid,1,NEW.attempt_token);
          IF NEW.operation_kind='CLEANUP' THEN
            UPDATE gate_sessions SET cleanup_operation_uuid=NEW.operation_uuid
              WHERE id=NEW.session_id AND session_uuid=NEW.session_uuid_snapshot AND generation=NEW.session_generation AND cleanup_operation_uuid IS NULL;
          END IF;
          RETURN NEW;
        END $$""",
        "CREATE TRIGGER gate_operation_registered AFTER INSERT ON gate_physical_operations FOR EACH ROW EXECUTE FUNCTION gate_operation_registered()",
        f"""CREATE FUNCTION gate_claim_operation(target uuid, expected_epoch bigint, expected_token uuid, new_token uuid)
          RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO "{schema}",pg_temp AS $$
        BEGIN
          PERFORM 1 FROM gate_sessions s JOIN gate_physical_operations o ON o.session_id=s.id WHERE o.operation_uuid=target FOR KEY SHARE OF s;
          PERFORM 1 FROM gate_physical_operations WHERE operation_uuid=target AND claim_epoch=expected_epoch
            AND attempt_token=expected_token AND settlement_status<>'SETTLED' FOR UPDATE;
          IF NOT FOUND THEN RETURN false; END IF;
          INSERT INTO gate_operation_claims(operation_uuid,claim_epoch,attempt_token,previous_epoch,previous_token)
            VALUES(target,expected_epoch+1,new_token,expected_epoch,expected_token);
          UPDATE gate_physical_operations SET claim_epoch=expected_epoch+1,attempt_token=new_token
            WHERE operation_uuid=target AND claim_epoch=expected_epoch AND attempt_token=expected_token AND settlement_status<>'SETTLED';
          RETURN FOUND;
        END $$""",
        "REVOKE ALL ON FUNCTION gate_claim_operation(uuid,bigint,uuid,uuid) FROM PUBLIC",
        """CREATE FUNCTION gate_binding_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM 1 FROM gate_sessions WHERE id=OLD.session_id FOR UPDATE;
          IF NOT EXISTS(SELECT 1 FROM gate_sessions s JOIN gate_physical_operations o ON o.operation_uuid=s.cleanup_operation_uuid
            WHERE s.id=OLD.session_id AND gate_cleanup_ready(o.operation_uuid) AND o.operation_result='CLEANED' AND o.settlement_status='SETTLED'
              AND o.published_claim_epoch=o.claim_epoch AND o.published_attempt_token=o.attempt_token) THEN
            RAISE EXCEPTION 'session cleanup must be acknowledged before unlink' USING ERRCODE='23514';
          END IF;
          RETURN OLD;
        END $$""",
        "CREATE TRIGGER gate_binding_release_guard BEFORE DELETE ON gate_session_bindings FOR EACH ROW EXECUTE FUNCTION gate_binding_release_guard()",
    ]
    for statement in statements:
        db.execute(text(statement))
