"""Persistent immutable physical objects shared by semantic owners."""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa

revision = "0056_stored_object_authority"
down_revision = "0055_take_score_timebase"
branch_labels = None
depends_on = None

CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}
HEX_CHECK = (
    "length(sha256) = 64 AND "
    + "replace(" * 16
    + "sha256"
    + "".join(f", '{char}', '')" for char in "0123456789abcdef")
    + " = ''"
)


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    names = [
        "users",
        "storage_blobs",
        "media_blobs",
        "uploads",
        "performance_takes",
        "import_artifacts",
        "score_revision_sources",
        "score_render_assets",
        "score_playback_assets",
        "practice_bundles",
    ]
    tables = {name: sa.Table(name, metadata, autoload_with=bind) for name in names}
    rows = {name: list(bind.execute(sa.select(table)).mappings()) for name, table in tables.items()}
    if any(row["avatar_url"] is not None for row in rows["users"]):
        raise RuntimeError(
            "StoredObject migration: avatar bytes have no verified database facts; recreate the pre-release environment"
        )

    facts: dict[str, tuple[int, str, str]] = {}
    owners: dict[tuple[str, int, str], str] = {}

    def admit(table: str, row, prefix: str, key, size, sha, mime) -> None:
        if (
            not isinstance(key, str)
            or not key.strip()
            or type(size) is not int
            or size < 0
            or not isinstance(sha, str)
            or re.fullmatch(r"[0-9a-f]{64}", sha) is None
            or not isinstance(mime, str)
            or re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", mime) is None
        ):
            raise RuntimeError(
                f"StoredObject migration: unverifiable physical facts in {table} row {row['id']}; recreate the pre-release environment"
            )
        value = (size, sha, mime)
        if key in facts and facts[key] != value:
            raise RuntimeError(
                f"StoredObject migration: conflicting physical facts for object key {key!r}; recreate the pre-release environment"
            )
        facts[key] = value
        owners[(table, row["id"], prefix)] = key

    for name in [
        "storage_blobs",
        "import_artifacts",
        "score_revision_sources",
        "score_render_assets",
        "score_playback_assets",
    ]:
        for row in rows[name]:
            mime = row["mime_type"]
            if name == "import_artifacts" and mime is None:
                mime = "application/octet-stream"
            admit(name, row, "", row["storage_key"], row["size_bytes"], row["sha256"], mime)
    for row in rows["media_blobs"]:
        admit(
            "media_blobs",
            row,
            "",
            row["object_key"],
            row["byte_size"],
            row["sha256"],
            row["content_type"],
        )
    for row in rows["practice_bundles"]:
        for prefix, mime in [
            ("prepared_musicxml", "application/vnd.recordare.musicxml+xml"),
            ("artifact", "application/json"),
        ]:
            admit(
                "practice_bundles",
                row,
                prefix,
                row[prefix + "_object_key"],
                row[prefix + "_byte_size"],
                row[prefix + "_sha256"],
                mime,
            )

    pk = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.create_table(
        "stored_objects",
        sa.Column("id", pk, primary_key=True, autoincrement=True),
        sa.Column("object_key", sa.String(768), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("object_key", name="uq_stored_object_locator"),
        sa.CheckConstraint("byte_size >= 0", name="ck_stored_object_nonnegative_size"),
        sa.CheckConstraint(
            "length(trim(object_key)) > 0 AND length(trim(content_type)) > 0",
            name="ck_stored_object_locator_type",
        ),
        sa.CheckConstraint(HEX_CHECK, name="ck_stored_object_digest"),
    )
    op.create_index("ix_stored_objects_sha256", "stored_objects", ["sha256"], unique=False)
    objects = sa.Table("stored_objects", sa.MetaData(), autoload_with=bind)
    ids = {
        key: bind.execute(
            objects.insert()
            .values(object_key=key, byte_size=value[0], sha256=value[1], content_type=value[2])
            .returning(objects.c.id)
        ).scalar_one()
        for key, value in facts.items()
    }

    links = [
        ("uploads", "stored_object_id", "storage_blobs", "blob_id", ""),
        ("performance_takes", "recording_object_id", "media_blobs", "media_blob_id", ""),
        ("import_artifacts", "stored_object_id", "import_artifacts", "id", ""),
        ("score_revision_sources", "stored_object_id", "score_revision_sources", "id", ""),
        ("score_render_assets", "stored_object_id", "score_render_assets", "id", ""),
        ("score_playback_assets", "stored_object_id", "score_playback_assets", "id", ""),
        (
            "practice_bundles",
            "prepared_musicxml_object_id",
            "practice_bundles",
            "id",
            "prepared_musicxml",
        ),
        ("practice_bundles", "artifact_object_id", "practice_bundles", "id", "artifact"),
    ]
    for name, column, source, old_id, prefix in links:
        op.add_column(name, sa.Column(column, pk, nullable=True))
        for row in rows[name]:
            key = owners[(source, row[old_id], prefix)]
            bind.execute(
                sa.text(f"UPDATE {name} SET {column} = :value WHERE id = :id"),
                {"value": ids[key], "id": row["id"]},
            )

    by_blob = {row["id"]: row for row in rows["storage_blobs"]}
    for row in rows["uploads"]:
        if not row["original_filename"]:
            bind.execute(
                tables["uploads"]
                .update()
                .where(tables["uploads"].c.id == row["id"])
                .values(original_filename=by_blob[row["blob_id"]]["filename"])
            )
    op.add_column("users", sa.Column("avatar_object_id", pk, nullable=True))
    physical = {"storage_key", "mime_type", "size_bytes", "sha256"}
    for name in [
        "uploads",
        "performance_takes",
        "import_artifacts",
        "score_revision_sources",
        "score_render_assets",
        "score_playback_assets",
        "practice_bundles",
        "users",
    ]:
        removed = (
            {"blob_id"}
            if name == "uploads"
            else {"media_blob_id"}
            if name == "performance_takes"
            else {"avatar_url"}
            if name == "users"
            else {
                prefix + suffix
                for prefix in ["prepared_musicxml", "artifact"]
                for suffix in ["_object_key", "_sha256", "_byte_size"]
            }
            if name == "practice_bundles"
            else physical
        )
        inspector = sa.inspect(bind)
        with op.batch_alter_table(name, naming_convention=CONVENTION) as batch:
            for fk in inspector.get_foreign_keys(name):
                if removed.intersection(fk["constrained_columns"]):
                    fk_name = (
                        fk["name"]
                        or f"fk_{name}_{fk['constrained_columns'][0]}_{fk['referred_table']}"
                    )
                    batch.drop_constraint(fk_name, type_="foreignkey")
            for unique in inspector.get_unique_constraints(name):
                if removed.intersection(unique["column_names"]):
                    batch.drop_constraint(unique["name"], type_="unique")
            for index in inspector.get_indexes(name):
                if not index.get("duplicates_constraint") and removed.intersection(
                    index["column_names"]
                ):
                    batch.drop_index(index["name"])
            for column in removed:
                batch.drop_column(column)
            current_links = [column for table, column, *_ in links if table == name]
            if name == "users":
                current_links = ["avatar_object_id"]
            for column in current_links:
                batch.create_foreign_key(
                    f"fk_{name}_{column}", "stored_objects", [column], ["id"], ondelete="RESTRICT"
                )
                batch.alter_column(column, existing_type=pk, nullable=name == "users")
            if name == "uploads":
                batch.alter_column(
                    "original_filename", existing_type=sa.String(255), nullable=False
                )
                batch.create_index("idx_uploads_stored_object", ["stored_object_id"])
            elif name == "performance_takes":
                batch.create_unique_constraint(
                    "uq_performance_takes_recording_object", ["recording_object_id"]
                )
            elif name == "practice_bundles":
                batch.create_unique_constraint(
                    "uq_practice_bundles_musicxml_object", ["prepared_musicxml_object_id"]
                )
                batch.create_unique_constraint(
                    "uq_practice_bundles_artifact_object", ["artifact_object_id"]
                )
            elif name != "users":
                batch.create_unique_constraint(f"uq_{name}_stored_object", ["stored_object_id"])
    op.drop_table("storage_blobs")
    op.drop_table("media_blobs")


def downgrade() -> None:
    raise RuntimeError("StoredObject schema downgrade requires pre-release environment recreation")
