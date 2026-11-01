"""Establish canonical durable PracticeSource ownership."""

from alembic import op
import sqlalchemy as sa

revision = "0055_durable_practice_source"
down_revision = "0054_take_upload_reservations"
branch_labels = None
depends_on = None


def _rename_constraint(table: str, before: str, after: str) -> None:
    op.execute(sa.text(f'ALTER TABLE "{table}" RENAME CONSTRAINT "{before}" TO "{after}"'))


def _rename_index(before: str, after: str) -> None:
    op.execute(sa.text(f'ALTER INDEX "{before}" RENAME TO "{after}"'))


def upgrade() -> None:
    source = "practice_sources"
    outbox = "practice_source_delete_outbox"
    op.rename_table("practice_source_snapshots", source)
    op.rename_table("practice_source_snapshot_delete_outbox", outbox)
    op.alter_column(source, "source_fingerprint", new_column_name="source_id")
    op.drop_constraint("uq_practice_source_snapshots_uuid", source, type_="unique")
    op.drop_column(source, "snapshot_uuid")
    for before, after in [
        ("practice_source_snapshots_pkey", "practice_sources_pkey"),
        ("uq_practice_source_snapshots_fingerprint", "uq_practice_sources_source_id"),
        ("uq_practice_source_snapshots_musicxml_key", "uq_practice_sources_musicxml_key"),
        ("uq_practice_source_snapshots_artifact_key", "uq_practice_sources_artifact_key"),
        ("ck_practice_source_snapshots_status", "ck_practice_sources_status"),
        ("ck_practice_source_snapshots_creation_lease", "ck_practice_sources_creation_lease"),
    ]:
        _rename_constraint(source, before, after)
    for suffix in ["source_score_revision", "status_creation"]:
        _rename_index(f"ix_practice_source_snapshots_{suffix}", f"ix_practice_sources_{suffix}")
    op.execute("ALTER SEQUENCE practice_source_snapshots_id_seq RENAME TO practice_sources_id_seq")
    op.add_column(source, sa.Column("live_revision_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_practice_sources_live_revision",
        source,
        "score_revisions",
        ["live_revision_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_practice_sources_live_revision_id", source, ["live_revision_id"])
    op.create_index("ix_practice_sources_status_owner", source, ["status", "live_revision_id"])
    op.execute(
        sa.text("""UPDATE practice_sources s SET live_revision_id = r.id
        FROM score_revisions r JOIN scores c ON c.id = r.score_id
        WHERE s.source_revision_uuid = r.revision_uuid AND s.source_score_uuid = c.score_uuid
          AND s.status != 'DELETING'""")
    )
    for table, before, after, index in [
        (
            "performance_takes",
            "fk_perf_takes_snapshot",
            "fk_performance_takes_practice_source",
            "ix_performance_takes",
        ),
        (
            "performance_take_upload_reservations",
            "fk_take_upload_reservation_snapshot",
            "fk_take_upload_reservation_practice_source",
            "ix_take_upload_reservation",
        ),
        (
            outbox,
            "fk_source_snapshot_delete_outbox_snapshot",
            "fk_practice_source_delete_source",
            None,
        ),
    ]:
        op.alter_column(table, "source_snapshot_id", new_column_name="practice_source_id")
        _rename_constraint(table, before, after)
        if index:
            _rename_index(f"{index}_source_snapshot_id", f"ix_{table}_practice_source_id")
    op.add_column(outbox, sa.Column("source_id", sa.String(128), nullable=True))
    op.execute(
        sa.text("""UPDATE practice_source_delete_outbox o SET source_id = s.source_id
        FROM practice_sources s WHERE o.practice_source_id = s.id""")
    )
    # Completed tombstones without a source have no remaining deletion work.
    op.execute(
        "DELETE FROM practice_source_delete_outbox WHERE source_id IS NULL AND status = 'COMPLETED'"
    )
    # An incomplete outbox without its source cannot be assigned a canonical identity.
    op.alter_column(outbox, "source_id", nullable=False)
    op.drop_index("ix_source_snapshot_delete_snapshot_uuid", table_name=outbox)
    op.drop_column(outbox, "snapshot_uuid")
    for before, after in [
        ("practice_source_snapshot_delete_outbox_pkey", "practice_source_delete_outbox_pkey"),
        ("uq_source_snapshot_delete_outbox_uuid", "uq_practice_source_delete_outbox_uuid"),
        ("ck_source_snapshot_delete_status", "ck_practice_source_delete_status"),
    ]:
        _rename_constraint(outbox, before, after)
    _rename_index("ix_source_snapshot_delete_status_next", "ix_practice_source_delete_status_next")
    op.create_index("ix_practice_source_delete_source_id", outbox, ["source_id"])
    op.create_index(
        "ix_practice_source_delete_outbox_practice_source_id", outbox, ["practice_source_id"]
    )
    op.execute(
        "ALTER SEQUENCE practice_source_snapshot_delete_outbox_id_seq RENAME TO practice_source_delete_outbox_id_seq"
    )
    op.execute("""UPDATE practice_source_delete_outbox SET status = 'PENDING',
        dispatched_at = NULL, started_at = NULL WHERE status IN ('DISPATCHED', 'PROCESSING')""")


def downgrade() -> None:
    raise RuntimeError(
        "Durable PracticeSource ownership requires restoring the pre-upgrade database backup"
    )
