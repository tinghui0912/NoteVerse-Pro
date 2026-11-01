"""Persisted upload reservation lifecycle invariants."""

from datetime import datetime, timedelta, timezone
import json

from alembic import op
import sqlalchemy as sa

revision = "0057_take_reservation_lifecycle"
down_revision = "0056_practice_source_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    table = sa.Table("performance_take_upload_reservations", metadata, autoload_with=bind)
    takes = sa.Table("performance_takes", metadata, autoload_with=bind)
    quota = sa.Table("storage_usage_reservations", metadata, autoload_with=bind)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for row in bind.execute(sa.select(table)).mappings():
        take = (
            bind.execute(sa.select(takes).where(takes.c.upload_reservation_id == row["id"]))
            .mappings()
            .one_or_none()
        )
        status = row["status"]
        if take is not None:
            status = "COMPLETED"
        elif status == "COMPLETED" or (
            status in {"RESERVED", "FINALIZING"} and row["practice_source_id"] is None
        ):
            status = "EXPIRED"
        fields = (
            row["finalizing_token"],
            row["finalizing_object_key"],
            row["finalizing_expires_at"],
        )
        if status == "FINALIZING" and not all(fields):
            status = "RESERVED"
        current_key = row["finalizing_object_key"] if status == "FINALIZING" else None
        candidates: dict[str, datetime] = {}
        # Only the migration accepts the dev database's historical representations.
        decoded = json.loads(row["orphan_final_object_keys"] or "[]")
        if not isinstance(decoded, list):
            raise ValueError("Invalid orphan cleanup ownership")
        for item in decoded:
            key = item if isinstance(item, str) else item["key"]
            raw_after = item.get("remove_after") if isinstance(item, dict) else None
            after = datetime.fromisoformat(raw_after) if raw_after else now + timedelta(minutes=30)
            candidates[key] = max(candidates.get(key, after), after)
        for key in (row["final_object_key"], row["finalizing_object_key"]):
            if key and key != current_key and (take is None or key != take["media_object_key"]):
                candidates[key] = max(candidates.get(key, now), now + timedelta(minutes=30))
        if current_key is not None:
            candidates.pop(current_key, None)
        if take is not None:
            candidates.pop(take["media_object_key"], None)
        bind.execute(
            table.update()
            .where(table.c.id == row["id"])
            .values(
                status=status,
                practice_source_id=row["practice_source_id"]
                if status in {"RESERVED", "FINALIZING"}
                else None,
                finalizing_token=row["finalizing_token"] if status == "FINALIZING" else None,
                finalizing_object_key=current_key,
                finalizing_expires_at=row["finalizing_expires_at"]
                if status == "FINALIZING"
                else None,
                orphan_final_object_keys=json.dumps(
                    [
                        {"key": key, "remove_after": after.isoformat()}
                        for key, after in candidates.items()
                    ],
                    sort_keys=True,
                    separators=(",", ":"),
                ),
                staging_cleanup_after=max(
                    value
                    for value in (row["staging_cleanup_after"], row["last_put_url_expires_at"], now)
                    if value is not None
                ),
            )
        )
        if status in {"COMPLETED", "CANCELLED", "EXPIRED"}:
            hold = (
                bind.execute(
                    sa.select(quota).where(
                        quota.c.reservation_uuid == row["storage_reservation_id"],
                        quota.c.status == "RESERVED",
                    )
                )
                .mappings()
                .one_or_none()
            )
            if hold is not None:
                completed = take is not None
                for name in ("storage_usage_counters", "storage_usage_accounts"):
                    if name.endswith("accounts") and not hold["counts_toward_quota"]:
                        continue
                    usage = sa.Table(name, metadata, autoload_with=bind, extend_existing=True)
                    predicates = [usage.c.user_id == hold["user_id"]]
                    if name.endswith("counters"):
                        predicates.append(usage.c.category == hold["category"])
                    bind.execute(
                        usage.update()
                        .where(*predicates)
                        .values(
                            reserved_bytes=usage.c.reserved_bytes - hold["bytes_reserved"],
                            used_bytes=usage.c.used_bytes
                            + (hold["bytes_reserved"] if completed else 0),
                        )
                    )
                bind.execute(
                    quota.update()
                    .where(quota.c.id == hold["id"])
                    .values(status="COMMITTED" if completed else "RELEASED")
                )
    op.drop_column(table.name, "final_object_key")
    op.drop_column(table.name, "final_cleanup_completed_at")
    op.alter_column(table.name, "orphan_final_object_keys", nullable=False)
    op.create_check_constraint(
        "ck_take_reservation_status",
        table.name,
        "status IN ('RESERVED','FINALIZING','COMPLETED','CANCELLED','EXPIRED')",
    )
    op.create_check_constraint(
        "ck_take_reservation_source_owner",
        table.name,
        "(status IN ('RESERVED','FINALIZING') AND practice_source_id IS NOT NULL) OR (status IN ('COMPLETED','CANCELLED','EXPIRED') AND practice_source_id IS NULL)",
    )
    op.create_check_constraint(
        "ck_take_reservation_finalize_lease",
        table.name,
        "(status = 'FINALIZING' AND finalizing_token IS NOT NULL AND finalizing_object_key IS NOT NULL AND finalizing_expires_at IS NOT NULL) OR (status != 'FINALIZING' AND finalizing_token IS NULL AND finalizing_object_key IS NULL AND finalizing_expires_at IS NULL)",
    )


def downgrade() -> None:
    raise RuntimeError("Reservation lifecycle downgrade requires restoring a database backup")
