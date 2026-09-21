"""Harden performance_takes foreign keys and add scope_type.

Revision ID: 0055_performance_take_fk_and_scope_fix
Revises: 0054_performance_take_score_independence
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0055_performance_take_fk_and_scope_fix"
down_revision: str | None = "0054_performance_take_score_independence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("performance_takes")]

    if bind.dialect.name == "postgresql":
        if "score_title" not in columns:
            op.add_column(
                "performance_takes",
                sa.Column("score_title", sa.String(length=255), nullable=True),
            )
        if "scope_type" not in columns:
            op.add_column(
                "performance_takes",
                sa.Column("scope_type", sa.String(length=16), nullable=False, server_default="FULL"),
            )

        # Backfill score_title for existing takes that have a score_id
        bind.execute(
            sa.text(
                "UPDATE performance_takes "
                "SET score_title = scores.title "
                "FROM scores "
                "WHERE performance_takes.score_id = scores.id "
                "AND performance_takes.score_title IS NULL"
            )
        )

        op.alter_column("performance_takes", "score_id", nullable=True)

        fks = inspector.get_foreign_keys("performance_takes")
        for fk in fks:
            fk_name = fk.get("name")
            constrained = fk.get("constrained_columns", [])
            referred = fk.get("referred_table")
            if referred == "scores" and "score_id" in constrained:
                if fk_name:
                    op.drop_constraint(fk_name, "performance_takes", type_="foreignkey")
            elif referred == "score_revisions" and "revision_id" in constrained:
                if fk_name:
                    op.drop_constraint(fk_name, "performance_takes", type_="foreignkey")

        op.create_foreign_key(
            "fk_performance_takes_score_id_scores",
            "performance_takes",
            "scores",
            ["score_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            "fk_performance_takes_revision_id_score_revisions",
            "performance_takes",
            "score_revisions",
            ["revision_id"],
            ["id"],
            ondelete="SET NULL",
        )

    elif bind.dialect.name == "sqlite":
        # SQLite clean recreate table to ensure foreign keys have ON DELETE SET NULL,
        # avoiding duplicate constraints and preserving all indexes and data.
        bind.execute(sa.text("PRAGMA foreign_keys = OFF;"))
        bind.execute(
            sa.text(
                """
            CREATE TABLE _new_performance_takes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                take_uuid VARCHAR(36) NOT NULL,
                user_id BIGINT NOT NULL,
                score_id BIGINT,
                revision_id BIGINT,
                artifact_id VARCHAR(128),
                client_request_id VARCHAR(128) NOT NULL,
                media_kind VARCHAR(16) NOT NULL DEFAULT 'AUDIO',
                media_mime_type VARCHAR(64) NOT NULL,
                media_byte_size BIGINT NOT NULL,
                media_object_key VARCHAR(768) NOT NULL,
                storage_backend VARCHAR(32) NOT NULL,
                duration_ms INTEGER NOT NULL,
                scope_start_beat FLOAT NOT NULL,
                scope_terminal_beat FLOAT NOT NULL,
                tempo_selection TEXT,
                resolved_tempo_plan TEXT,
                sync_metadata TEXT,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                score_title VARCHAR(255),
                scope_type VARCHAR(16) NOT NULL DEFAULT 'FULL',
                CONSTRAINT fk_performance_takes_user_id_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_performance_takes_score_id_scores FOREIGN KEY (score_id) REFERENCES scores(id) ON DELETE SET NULL,
                CONSTRAINT fk_performance_takes_revision_id_score_revisions FOREIGN KEY (revision_id) REFERENCES score_revisions(id) ON DELETE SET NULL,
                CONSTRAINT uq_performance_takes_user_client_request_id UNIQUE (user_id, client_request_id)
            );
        """
            )
        )

        has_score_title = "score_title" in columns
        has_scope_type = "scope_type" in columns

        score_title_expr = (
            "COALESCE(score_title, (SELECT title FROM scores WHERE scores.id = performance_takes.score_id))"
            if has_score_title
            else "(SELECT title FROM scores WHERE scores.id = performance_takes.score_id)"
        )
        scope_type_expr = "COALESCE(scope_type, 'FULL')" if has_scope_type else "'FULL'"

        bind.execute(
            sa.text(
                f"""
            INSERT INTO _new_performance_takes (
                id, take_uuid, user_id, score_id, revision_id, artifact_id, client_request_id,
                media_kind, media_mime_type, media_byte_size, media_object_key, storage_backend,
                duration_ms, scope_start_beat, scope_terminal_beat, tempo_selection, resolved_tempo_plan,
                sync_metadata, created_at, updated_at, score_title, scope_type
            )
            SELECT 
                id, take_uuid, user_id, score_id, revision_id, artifact_id, client_request_id,
                media_kind, media_mime_type, media_byte_size, media_object_key, storage_backend,
                duration_ms, scope_start_beat, scope_terminal_beat, tempo_selection, resolved_tempo_plan,
                sync_metadata, created_at, updated_at,
                {score_title_expr},
                {scope_type_expr}
            FROM performance_takes;
        """
            )
        )

        bind.execute(sa.text("DROP TABLE performance_takes;"))
        bind.execute(sa.text("ALTER TABLE _new_performance_takes RENAME TO performance_takes;"))
        bind.execute(
            sa.text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_performance_takes_take_uuid ON performance_takes (take_uuid);"
            )
        )
        bind.execute(
            sa.text("CREATE INDEX IF NOT EXISTS ix_performance_takes_user_id ON performance_takes (user_id);")
        )
        bind.execute(
            sa.text("CREATE INDEX IF NOT EXISTS ix_performance_takes_score_id ON performance_takes (score_id);")
        )
        bind.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_performance_takes_revision_id ON performance_takes (revision_id);"
            )
        )
        bind.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_performance_takes_client_request_id ON performance_takes (client_request_id);"
            )
        )
        bind.execute(sa.text("PRAGMA foreign_keys = ON;"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("performance_takes")]

    if bind.dialect.name == "postgresql":
        if "scope_type" in columns:
            op.drop_column("performance_takes", "scope_type")
    elif bind.dialect.name == "sqlite":
        with op.batch_alter_table("performance_takes", recreate="always") as batch_op:
            if "scope_type" in columns:
                batch_op.drop_column("scope_type")
