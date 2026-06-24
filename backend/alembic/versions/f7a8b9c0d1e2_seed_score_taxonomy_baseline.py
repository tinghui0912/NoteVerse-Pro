"""seed score taxonomy baseline

Revision ID: f7a8b9c0d1e2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-24 17:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
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
        sa.column("aliases", sa.JSON()),
        sa.column("sort_order", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
    )
    bind = op.get_bind()
    existing_category_id = bind.execute(
        sa.text("SELECT id FROM taxonomy_categories WHERE code = 'genre'")
    ).scalar()
    if existing_category_id is None:
        op.bulk_insert(
            taxonomy_categories,
            [
                {
                    "code": "genre",
                    "name_key": "scoreStyles.category.genre",
                    "sort_order": 10,
                    "is_active": True,
                }
            ],
        )
        existing_category_id = bind.execute(
            sa.text("SELECT id FROM taxonomy_categories WHERE code = 'genre'")
        ).scalar_one()
    else:
        bind.execute(
            sa.text(
                "UPDATE taxonomy_categories "
                "SET name_key = :name_key, sort_order = :sort_order, is_active = true "
                "WHERE id = :id"
            ),
            {
                "id": existing_category_id,
                "name_key": "scoreStyles.category.genre",
                "sort_order": 10,
            },
        )

    existing_tags = set(
        bind.execute(
            sa.text("SELECT code FROM taxonomy_tags WHERE category_id = :category_id"),
            {"category_id": existing_category_id},
        ).scalars()
    )
    missing_tags = [
        {
            "category_id": existing_category_id,
            "code": code,
            "name_key": name_key,
            "aliases": [],
            "sort_order": sort_order,
            "is_active": True,
        }
        for code, name_key, sort_order in GENRE_TAGS
        if code not in existing_tags
    ]
    if missing_tags:
        op.bulk_insert(taxonomy_tags, missing_tags)
    for code, name_key, sort_order in GENRE_TAGS:
        bind.execute(
            sa.text(
                "UPDATE taxonomy_tags "
                "SET name_key = :name_key, sort_order = :sort_order, is_active = true "
                "WHERE category_id = :category_id AND code = :code"
            ),
            {
                "category_id": existing_category_id,
                "code": code,
                "name_key": name_key,
                "sort_order": sort_order,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM taxonomy_tags "
            "WHERE category_id = (SELECT id FROM taxonomy_categories WHERE code = 'genre') "
            "AND code IN :codes"
        ).bindparams(sa.bindparam("codes", expanding=True)),
        {"codes": [code for code, _name_key, _sort_order in GENRE_TAGS]},
    )
