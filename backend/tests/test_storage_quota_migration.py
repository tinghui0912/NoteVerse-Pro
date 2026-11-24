"""Persisted capacity lineage survives quota schema upgrade and finite downgrade."""

from datetime import timedelta
import json
import pytest
from alembic import command
from sqlalchemy import text, inspect
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


def seed(
    connection,
    *,
    status="RESERVED",
    business="RESERVED",
    expired=False,
    linked=True,
    owner=1,
    size=11,
):
    now = utc_now()
    created = now - timedelta(hours=3)
    expiry = now + timedelta(hours=1) if not expired else now - timedelta(hours=1)
    connection.execute(
        text(
            "INSERT INTO users(id,email,password_hash,is_active,email_verified_at,created_at,updated_at) VALUES (1,'migration@example.test','hash',true,:now,:now,:now),(2,'other@example.test','hash',true,:now,:now,:now)"
        ),
        {"now": created},
    )
    connection.execute(
        text(
            "INSERT INTO user_storage_entitlements(user_id,plan_code,limit_override_bytes,created_at,updated_at) VALUES (1,'FREE',0,:now,:now)"
        ),
        {"now": created},
    )
    connection.execute(
        text(
            "INSERT INTO storage_usage_accounts(user_id,used_bytes,reserved_bytes,created_at,updated_at) VALUES (1,0,11,:now,:now)"
        ),
        {"now": created},
    )
    connection.execute(
        text(
            "INSERT INTO storage_usage_reservations(reservation_uuid,user_id,category,bytes_reserved,counts_toward_quota_snapshot,status,reason,created_at,updated_at) VALUES ('capacity',:owner,'UPLOAD',:size,true,:status,'take',:created,:updated)"
        ),
        {
            "owner": owner,
            "size": size,
            "status": status,
            "created": created,
            "updated": created + timedelta(minutes=1),
        },
    )
    connection.execute(
        text(
            "INSERT INTO storage_usage_events(user_id,category,delta_bytes,counts_toward_quota_snapshot,reason,created_at) VALUES (1,'UPLOAD',11,true,'audit',:now)"
        ),
        {"now": created},
    )
    if linked:
        connection.execute(
            text(
                "INSERT INTO performance_take_manifests(id,user_id,take_uuid,manifest_json,manifest_sha256,created_at) VALUES (1,1,'take',:doc,:digest,:now)"
            ),
            {
                "doc": json.dumps({"manifest": {"capture": {"byte_size": 11}}}),
                "digest": "a" * 64,
                "now": created,
            },
        )
        connection.execute(
            text(
                "INSERT INTO performance_take_upload_reservations(reservation_uuid,user_id,manifest_id,client_request_id,staging_object_key,storage_reservation_id,expires_at,orphan_final_object_keys,status,created_at,updated_at) VALUES ('business',1,1,'request','staging','capacity',:expiry,'[]',:business,:created,:created)"
            ),
            {"expiry": expiry, "business": business, "created": created},
        )


@pytest.mark.parametrize(
    "status,business,expired,expected",
    [
        ("RESERVED", "RESERVED", False, "HELD"),
        ("RESERVED", "RESERVED", True, "EXPIRED"),
        ("COMMITTED", "COMPLETED", False, "CONSUMED"),
        ("RELEASED", "CANCELLED", False, "RELEASED"),
    ],
)
def test_upgrade_backfills_business_hold_lineage(monkeypatch, status, business, expired, expected):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0001_current_schema")
        with engine.begin() as connection:
            seed(connection, status=status, business=business, expired=expired)
        command.upgrade(config, "0002_storage_quota")
        with engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT h.status,h.hold_uuid,h.bytes_held,b.quota_hold_id=h.id AS linked FROM performance_take_upload_reservations b JOIN storage_quota_holds h ON b.quota_hold_id=h.id"
                )
            ).one()
            assert tuple(row) == (expected, "capacity", 11, True)
            assert connection.execute(
                text(
                    "SELECT mode_override,limit_override_bytes FROM user_storage_entitlements WHERE user_id=1"
                )
            ).one() == ("HARD_LIMIT", 0)
            assert (
                connection.scalar(
                    text(
                        "SELECT default_limit_bytes FROM storage_plan_policies WHERE plan_code='FREE'"
                    )
                )
                == 104857600
            )
            assert connection.scalar(text("SELECT delta_bytes FROM storage_usage_events")) == 11
        command.downgrade(config, "0001_current_schema")
        with engine.connect() as connection:
            assert (
                connection.scalar(
                    text("SELECT storage_reservation_id FROM performance_take_upload_reservations")
                )
                == "capacity"
            )
            assert connection.scalar(text("SELECT count(*) FROM storage_usage_events")) == 1
            expected_reserved = 11 if status == "RESERVED" else 0
            assert (
                connection.scalar(
                    text("SELECT reserved_bytes FROM storage_usage_accounts WHERE user_id=1")
                )
                == expected_reserved
            )
            if expected_reserved:
                assert (
                    connection.scalar(
                        text(
                            "SELECT reserved_bytes FROM storage_usage_counters WHERE user_id=1 AND category='UPLOAD'"
                        )
                    )
                    == 11
                )
        command.upgrade(config, "0002_storage_quota")


@pytest.mark.parametrize(
    "kwargs", [{"owner": 2}, {"size": 12}, {"linked": False}, {"business": "COMPLETED"}]
)
def test_ambiguous_persisted_lineage_aborts_without_schema_mutation(monkeypatch, kwargs):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0001_current_schema")
        with engine.begin() as connection:
            seed(connection, **kwargs)
        with pytest.raises(RuntimeError, match="unambiguous"):
            command.upgrade(config, "0002_storage_quota")
        with engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == "0001_current_schema"
            )
            assert "storage_quota_holds" not in inspect(connection).get_table_names()
            assert connection.scalar(text("SELECT count(*) FROM storage_usage_reservations")) == 1


def test_unlimited_downgrade_fails_without_inventing_finite_entitlement(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0002_storage_quota")
        with engine.begin() as connection:
            connection.execute(
                text("UPDATE storage_plan_policies SET mode='UNLIMITED', default_limit_bytes=NULL")
            )
        with pytest.raises(RuntimeError, match="no finite"):
            command.downgrade(config, "0001_current_schema")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT mode FROM storage_plan_policies")) == "UNLIMITED"
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == "0002_storage_quota"
            )
