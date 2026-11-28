-- __APP_SCHEMA__ is an identifier supplied by the database provisioning boundary.
CREATE OR REPLACE FUNCTION __APP_SCHEMA__.nv_authentication_mail_source_active(kind text, identity bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT CASE kind
    WHEN 'ACCOUNT' THEN EXISTS (SELECT 1 FROM __APP_SCHEMA__.users u
      WHERE u.id=identity AND u.is_active AND u.deleted_at IS NULL)
    WHEN 'AUTH_TOKEN' THEN EXISTS (SELECT 1 FROM __APP_SCHEMA__.auth_tokens t
      JOIN __APP_SCHEMA__.users u ON u.id=t.user_id
      WHERE t.id=identity AND t.used_at IS NULL AND t.expires_at>now()
        AND u.is_active AND u.deleted_at IS NULL)
    WHEN 'EMAIL_CHANGE' THEN EXISTS (SELECT 1 FROM __APP_SCHEMA__.email_change_requests t
      JOIN __APP_SCHEMA__.users u ON u.id=t.user_id
      WHERE t.id=identity AND t.consumed_at IS NULL AND t.expires_at>now()
        AND u.is_active AND u.deleted_at IS NULL)
    WHEN 'REGISTRATION' THEN EXISTS (SELECT 1 FROM __APP_SCHEMA__.pending_registrations t
      WHERE t.id=identity AND t.consumed_at IS NULL AND t.expires_at>now())
    ELSE false END
$function$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.nv_mail_has_payload(identity text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (SELECT 1 FROM __APP_SCHEMA__.mail_outbox
    WHERE outbox_uuid=identity AND text_body IS NOT NULL AND text_body<>'')
$function$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.nv_erase_closed_authentication_history(identity bigint, batch_size integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE affected integer;
BEGIN
  IF batch_size<1 OR batch_size>10000 THEN
    RAISE EXCEPTION 'Invalid erasure batch size' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM __APP_SCHEMA__.users WHERE id=identity
    AND deleted_at IS NOT NULL AND NOT is_active FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM __APP_SCHEMA__.account_deletion_operations
    WHERE user_id_snapshot=identity AND phase='FINALIZE' AND status='PROCESSING') THEN
    RAISE EXCEPTION 'Closed account erasure authority required' USING ERRCODE='42501';
  END IF;
  DELETE FROM __APP_SCHEMA__.auth_tokens WHERE id IN
    (SELECT id FROM __APP_SCHEMA__.auth_tokens WHERE user_id=identity ORDER BY id LIMIT batch_size);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected>0 THEN RETURN true; END IF;
  DELETE FROM __APP_SCHEMA__.user_sessions WHERE id IN
    (SELECT id FROM __APP_SCHEMA__.user_sessions WHERE user_id=identity ORDER BY id LIMIT batch_size);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected>0 THEN RETURN true; END IF;
  DELETE FROM __APP_SCHEMA__.email_change_requests WHERE id IN
    (SELECT id FROM __APP_SCHEMA__.email_change_requests WHERE user_id=identity ORDER BY id LIMIT batch_size);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected>0;
END
$function$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.nv_erase_closed_identity(identity bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM __APP_SCHEMA__.account_deletion_operations
    WHERE user_id_snapshot=identity AND phase='FINALIZE' AND status='PROCESSING') THEN
    RAISE EXCEPTION 'Closed account erasure authority required' USING ERRCODE='42501';
  END IF;
  DELETE FROM __APP_SCHEMA__.users WHERE id=identity AND deleted_at IS NOT NULL AND NOT is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Closed identity required' USING ERRCODE='42501';
  END IF;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_authentication_mail_source_active(text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_mail_has_payload(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_erase_closed_authentication_history(bigint,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_erase_closed_identity(bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.nv_customer_directory(page_size integer, page_offset integer)
RETURNS TABLE(user_id bigint, email text, display_name text, is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  IF page_size<1 OR page_size>501 OR page_offset<0 OR page_offset>10000 THEN
    RAISE EXCEPTION 'Invalid directory page' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT u.id, u.email::text, u.display_name::text, u.is_active
    FROM __APP_SCHEMA__.users u ORDER BY u.id LIMIT page_size OFFSET page_offset;
END
$function$;

CREATE OR REPLACE FUNCTION __APP_SCHEMA__.nv_set_customer_active(actor bigint, identity bigint, active boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM 1 FROM __APP_SCHEMA__.operators WHERE id=actor AND role='SUPER_ADMIN'
    AND status='active' AND totp_enabled_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM __APP_SCHEMA__.users WHERE id=identity AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE __APP_SCHEMA__.users SET is_active=active, updated_at=now() WHERE id=identity;
  IF NOT active THEN
    UPDATE __APP_SCHEMA__.user_sessions SET idle_expires_at=LEAST(idle_expires_at, now())
      WHERE user_id=identity AND revoked_at IS NULL;
  END IF;
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_customer_directory(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION __APP_SCHEMA__.nv_set_customer_active(bigint,bigint,boolean) FROM PUBLIC;
