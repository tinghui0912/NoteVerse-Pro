"""Rename user-finished completion reason.

Revision ID: 0048_rename_user_finished
Revises: 0047_practice_completion_reason
"""

from collections.abc import Sequence

from alembic import op


revision: str = "0048_rename_user_finished"
down_revision: str | None = "0047_practice_completion_reason"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_enum value
                JOIN pg_type enum_type ON enum_type.oid = value.enumtypid
                WHERE enum_type.typname = 'practicesessioncompletionreason'
                  AND value.enumlabel = 'USER_FINISHED'
            ) AND NOT EXISTS (
                SELECT 1
                FROM pg_enum value
                JOIN pg_type enum_type ON enum_type.oid = value.enumtypid
                WHERE enum_type.typname = 'practicesessioncompletionreason'
                  AND value.enumlabel = 'STOPPED_BY_USER'
            ) THEN
                ALTER TYPE practicesessioncompletionreason
                    RENAME VALUE 'USER_FINISHED' TO 'STOPPED_BY_USER';
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_enum value
                JOIN pg_type enum_type ON enum_type.oid = value.enumtypid
                WHERE enum_type.typname = 'practicesessioncompletionreason'
                  AND value.enumlabel = 'STOPPED_BY_USER'
            ) AND NOT EXISTS (
                SELECT 1
                FROM pg_enum value
                JOIN pg_type enum_type ON enum_type.oid = value.enumtypid
                WHERE enum_type.typname = 'practicesessioncompletionreason'
                  AND value.enumlabel = 'USER_FINISHED'
            ) THEN
                ALTER TYPE practicesessioncompletionreason
                    RENAME VALUE 'STOPPED_BY_USER' TO 'USER_FINISHED';
            END IF;
        END
        $$;
        """
    )
