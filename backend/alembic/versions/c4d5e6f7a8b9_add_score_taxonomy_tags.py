"""add score taxonomy tags

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-06-23 18:10:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


GENRE_TAGS = (
    ("classical", "scoreStyles.genre.classical", 10),
    ("pop", "scoreStyles.genre.pop", 20),
    ("jazz", "scoreStyles.genre.jazz", 30),
    ("rock", "scoreStyles.genre.rock", 40),
    ("folk", "scoreStyles.genre.folk", 50),
    ("blues", "scoreStyles.genre.blues", 60),
    ("soundtrack", "scoreStyles.genre.soundtrack", 70),
    ("anime_game", "scoreStyles.genre.animeGame", 80),
    ("religious", "scoreStyles.genre.religious", 90),
    ("latin", "scoreStyles.genre.latin", 100),
    ("children", "scoreStyles.genre.children", 110),
    ("original", "scoreStyles.genre.original", 120),
    ("other", "scoreStyles.genre.other", 130),
)


def upgrade() -> None:
    aliases_type = sa.JSON().with_variant(postgresql.JSONB, "postgresql")
    op.create_table(
        "taxonomy_categories",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name_key", sa.String(length=128), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_taxonomy_categories_code"),
    )
    op.create_index(
        "idx_taxonomy_categories_active_sort",
        "taxonomy_categories",
        ["is_active", "sort_order"],
    )
    op.create_table(
        "taxonomy_tags",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("category_id", sa.BigInteger(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name_key", sa.String(length=128), nullable=False),
        sa.Column("aliases", aliases_type, nullable=False, server_default="[]"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["category_id"], ["taxonomy_categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category_id", "code", name="uq_taxonomy_tags_category_code"),
    )
    op.create_index(
        "idx_taxonomy_tags_category_active_sort",
        "taxonomy_tags",
        ["category_id", "is_active", "sort_order"],
    )
    op.create_table(
        "score_taxonomy_tags",
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("tag_id", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="USER"),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["taxonomy_tags.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("score_id", "tag_id"),
    )
    op.create_index(
        "idx_score_taxonomy_tags_tag_score",
        "score_taxonomy_tags",
        ["tag_id", "score_id"],
    )

    taxonomy_categories = sa.table(
        "taxonomy_categories",
        sa.column("id", sa.BigInteger()),
        sa.column("code", sa.String()),
        sa.column("name_key", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
    )
    taxonomy_tags = sa.table(
        "taxonomy_tags",
        sa.column("category_id", sa.BigInteger()),
        sa.column("code", sa.String()),
        sa.column("name_key", sa.String()),
        sa.column("aliases", aliases_type),
        sa.column("sort_order", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
    )
    op.bulk_insert(
        taxonomy_categories,
        [
            {
                "id": 1,
                "code": "genre",
                "name_key": "scoreStyles.category.genre",
                "sort_order": 10,
                "is_active": True,
            }
        ],
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "SELECT setval(pg_get_serial_sequence('taxonomy_categories', 'id'), "
            "(SELECT max(id) FROM taxonomy_categories))"
        )
    op.bulk_insert(
        taxonomy_tags,
        [
            {
                "category_id": 1,
                "code": code,
                "name_key": name_key,
                "aliases": [],
                "sort_order": sort_order,
                "is_active": True,
            }
            for code, name_key, sort_order in GENRE_TAGS
        ],
    )

    op.drop_column("scores", "difficulty")


def downgrade() -> None:
    raise RuntimeError("The score taxonomy migration is intentionally irreversible.")
