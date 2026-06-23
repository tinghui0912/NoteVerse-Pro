"""remove legacy task-as-score contract

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-06-22 12:00:00.000000
"""
import hashlib
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context
from alembic import op

revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _count(query: str) -> int:
    return int(op.get_bind().execute(sa.text(query)).scalar_one())


def _drop_fk_for_column(table: str, column: str) -> None:
    inspector = sa.inspect(op.get_bind())
    for constraint in inspector.get_foreign_keys(table):
        if column in constraint.get("constrained_columns", []):
            op.drop_constraint(constraint["name"], table, type_="foreignkey")


def _legacy_shares_without_grant_count() -> int:
    rows = op.get_bind().execute(sa.text("SELECT token FROM shares")).mappings()
    missing = 0
    for row in rows:
        token_hash = hashlib.sha256(row["token"].encode("utf-8")).hexdigest()
        exists = op.get_bind().execute(
            sa.text("SELECT 1 FROM score_share_grants WHERE token_hash=:token_hash LIMIT 1"),
            {"token_hash": token_hash},
        ).scalar_one_or_none()
        if exists is None:
            missing += 1
    return missing


def _legacy_saved_shares_without_bookmark_count() -> int:
    rows = op.get_bind().execute(
        sa.text(
            "SELECT ss.user_id, sh.token FROM saved_shares ss "
            "JOIN shares sh ON sh.id=ss.share_id"
        )
    ).mappings()
    missing = 0
    for row in rows:
        token_hash = hashlib.sha256(row["token"].encode("utf-8")).hexdigest()
        exists = op.get_bind().execute(
            sa.text(
                "SELECT 1 FROM score_share_grants g "
                "JOIN score_bookmarks b ON b.score_id=g.score_id "
                "WHERE g.token_hash=:token_hash AND b.user_id=:user_id LIMIT 1"
            ),
            {"token_hash": token_hash, "user_id": row["user_id"]},
        ).scalar_one_or_none()
        if exists is None:
            missing += 1
    return missing


def upgrade() -> None:
    offline = context.is_offline_mode()
    if offline:
        op.execute(
            "/* P4 cleanup requires a successful scripts/backfill_score_domain.py --apply "
            "validation report before this SQL is applied. */"
        )
    else:
        blockers = {
            "legacy_tasks_without_job": _count(
                "SELECT count(*) FROM tasks t WHERE NOT EXISTS "
                "(SELECT 1 FROM processing_jobs j WHERE j.job_uuid=t.task_uuid)"
            ),
            "legacy_xml_tasks_without_score": _count(
                "SELECT count(DISTINCT t.id) FROM tasks t "
                "JOIN files f ON f.task_id=t.id AND f.kind IN ('current_xml', 'final_xml') "
                "LEFT JOIN processing_jobs j ON j.job_uuid=t.task_uuid "
                "WHERE j.score_id IS NULL"
            ),
            "legacy_shares_without_grant": _legacy_shares_without_grant_count(),
            "legacy_saved_shares_without_bookmark": _legacy_saved_shares_without_bookmark_count(),
            "scores_without_head": _count("SELECT count(*) FROM scores WHERE head_revision_id IS NULL"),
            "revisions_without_musicxml": _count(
                "SELECT count(*) FROM score_revisions r WHERE NOT EXISTS "
                "(SELECT 1 FROM score_artifacts a WHERE a.revision_id=r.id AND a.kind='MUSICXML')"
            ),
            "practice_without_revision": _count(
                "SELECT count(*) FROM practice_sessions "
                "WHERE score_id IS NULL OR revision_id IS NULL OR access_origin IS NULL"
            ),
        }
        if any(blockers.values()):
            raise RuntimeError(
                "Legacy cleanup blocked; run scripts/backfill_score_domain.py --apply first: "
                f"{blockers}"
            )

    op.alter_column("practice_sessions", "score_id", existing_type=sa.BigInteger(), nullable=False)
    op.alter_column("practice_sessions", "revision_id", existing_type=sa.BigInteger(), nullable=False)
    op.alter_column(
        "practice_sessions",
        "access_origin",
        existing_type=sa.Enum(name="accessorigin"),
        nullable=False,
    )
    op.drop_index("idx_practice_sessions_task_created", table_name="practice_sessions")
    if not offline:
        _drop_fk_for_column("practice_sessions", "task_id")
    op.drop_column("practice_sessions", "task_id")
    op.drop_column("practice_sessions", "share_token")
    op.drop_column("practice_sessions", "source_type")

    op.drop_table("saved_shares")
    op.drop_table("shares")
    op.drop_table("files")
    op.drop_table("task_uploads")
    op.drop_table("task_steps")
    op.drop_table("tasks")

    for enum_name in ["practicesourcetype", "filekind", "taskstepstatus", "taskstate"]:
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    raise RuntimeError("The P4 legacy-contract cleanup is intentionally irreversible.")
