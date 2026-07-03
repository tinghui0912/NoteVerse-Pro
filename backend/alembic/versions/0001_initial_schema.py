"""initial schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-07-03 07:19:22.733366

"""
from datetime import datetime, timezone
from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql



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

ENUM_TYPES = (
    "accessorigin",
    "artifactkind",
    "invitestatus",
    "libraryentrysourcetype",
    "librarypracticestate",
    "membershiprole",
    "metadatastatus",
    "practicereportstatus",
    "practicesessionstate",
    "processingjobstate",
    "processingjobstepstatus",
    "publicationstatus",
    "revisionorigin",
    "userrole",
)


def _seed_taxonomy_baseline() -> None:
    taxonomy_categories = sa.table(
        "taxonomy_categories",
        sa.column("id", sa.BigInteger()),
        sa.column("code", sa.String()),
        sa.column("name_key", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime()),
    )
    taxonomy_tags = sa.table(
        "taxonomy_tags",
        sa.column("category_id", sa.BigInteger()),
        sa.column("code", sa.String()),
        sa.column("name_key", sa.String()),
        sa.column("aliases", sa.JSON()),
        sa.column("sort_order", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime()),
    )
    bind = op.get_bind()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    op.bulk_insert(
        taxonomy_categories,
        [
            {
                "code": "genre",
                "name_key": "scoreStyles.category.genre",
                "sort_order": 10,
                "is_active": True,
                "created_at": now,
            }
        ],
    )
    category_id = bind.execute(
        sa.text("SELECT id FROM taxonomy_categories WHERE code = 'genre'")
    ).scalar_one()
    op.bulk_insert(
        taxonomy_tags,
        [
            {
                "category_id": category_id,
                "code": code,
                "name_key": name_key,
                "aliases": [],
                "sort_order": sort_order,
                "is_active": True,
                "created_at": now,
            }
            for code, name_key, sort_order in GENRE_TAGS
        ],
    )

# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create the current pre-release schema baseline.
    op.create_table('taxonomy_categories',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('name_key', sa.String(length=128), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code', name='uq_taxonomy_categories_code')
    )
    op.create_index('idx_taxonomy_categories_active_sort', 'taxonomy_categories', ['is_active', 'sort_order'], unique=False)
    op.create_table('users',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('display_name', sa.String(length=128), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.Enum('user', 'admin', name='userrole'), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('last_login', sa.DateTime(), nullable=True),
    sa.Column('password_changed_at', sa.DateTime(), nullable=True),
    sa.Column('avatar_url', sa.String(length=512), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('display_name'),
    sa.UniqueConstraint('email')
    )
    op.create_table('notification_events',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('notification_uuid', sa.String(length=36), nullable=False),
    sa.Column('recipient_user_id', sa.BigInteger(), nullable=False),
    sa.Column('actor_user_id', sa.BigInteger(), nullable=True),
    sa.Column('type', sa.String(length=80), nullable=False),
    sa.Column('dedupe_key', sa.String(length=160), nullable=True),
    sa.Column('resource_type', sa.String(length=40), nullable=False),
    sa.Column('resource_id', sa.String(length=128), nullable=True),
    sa.Column('score_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('body', sa.String(length=1024), nullable=True),
    sa.Column('data', sa.JSON(), nullable=False),
    sa.Column('read_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['recipient_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dedupe_key'),
    sa.UniqueConstraint('notification_uuid')
    )
    op.create_index('idx_notification_events_recipient_created', 'notification_events', ['recipient_user_id', 'created_at'], unique=False)
    op.create_index('idx_notification_events_recipient_read', 'notification_events', ['recipient_user_id', 'read_at'], unique=False)
    op.create_index('idx_notification_events_resource', 'notification_events', ['resource_type', 'resource_id'], unique=False)
    op.create_table('processing_jobs',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('job_uuid', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('state', sa.Enum('PENDING', 'PROGRESS', 'PENDING_REVIEW', 'SUCCESS', 'FAILURE', name='processingjobstate'), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('current_step', sa.String(length=64), nullable=True),
    sa.Column('idempotency_key', sa.String(length=128), nullable=True),
    sa.Column('requested_options', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('code', sa.String(length=64), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('error_type', sa.String(length=64), nullable=True),
    sa.Column('requested_at', sa.DateTime(), nullable=True),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('last_heartbeat_at', sa.DateTime(), nullable=True),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.Column('score_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], name='fk_processing_jobs_score_id', ondelete='SET NULL', use_alter=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('job_uuid'),
    sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_processing_jobs_user_idempotency_key')
    )
    op.create_index('idx_processing_jobs_state', 'processing_jobs', ['state'], unique=False)
    op.create_index('idx_processing_jobs_user_created', 'processing_jobs', ['user_id', 'created_at'], unique=False)
    op.create_table('refresh_tokens',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('device_id', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.String(length=512), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.Column('replaced_by_token_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_used_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['replaced_by_token_id'], ['refresh_tokens.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index('idx_refresh_tokens_expires', 'refresh_tokens', ['expires_at'], unique=False)
    op.create_index('idx_refresh_tokens_revoked', 'refresh_tokens', ['revoked_at'], unique=False)
    op.create_index('idx_refresh_tokens_user_created', 'refresh_tokens', ['user_id', 'created_at'], unique=False)
    op.create_table('score_library_folders',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('folder_uuid', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('parent_folder_id', sa.BigInteger(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint('position >= 0', name='ck_score_library_folders_position'),
    sa.ForeignKeyConstraint(['parent_folder_id'], ['score_library_folders.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('folder_uuid'),
    sa.UniqueConstraint('user_id', 'id', name='uq_score_library_folders_user_id_id')
    )
    op.create_index('idx_score_library_folders_user_parent', 'score_library_folders', ['user_id', 'parent_folder_id'], unique=False)
    op.create_index('uq_score_library_folders_active_name', 'score_library_folders', ['user_id', 'parent_folder_id', 'name'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'), sqlite_where=sa.text('deleted_at IS NULL'))
    op.create_table('taxonomy_tags',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('category_id', sa.BigInteger(), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('name_key', sa.String(length=128), nullable=False),
    sa.Column('aliases', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['taxonomy_categories.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('category_id', 'code', name='uq_taxonomy_tags_category_code')
    )
    op.create_index('idx_taxonomy_tags_category_active_sort', 'taxonomy_tags', ['category_id', 'is_active', 'sort_order'], unique=False)
    op.create_table('uploads',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('storage_backend', sa.String(length=32), nullable=False),
    sa.Column('storage_key', sa.String(length=768), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('original_filename', sa.String(length=255), nullable=True),
    sa.Column('size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('mime_type', sa.String(length=64), nullable=True),
    sa.Column('uploader_user_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['uploader_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('sha256'),
    sa.UniqueConstraint('storage_key')
    )
    op.create_table('processing_artifacts',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('artifact_uuid', sa.String(length=36), nullable=False),
    sa.Column('job_id', sa.BigInteger(), nullable=False),
    sa.Column('kind', sa.String(length=64), nullable=False),
    sa.Column('storage_backend', sa.String(length=32), nullable=False),
    sa.Column('storage_key', sa.String(length=768), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('mime_type', sa.String(length=128), nullable=True),
    sa.Column('size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('sha256', sa.String(length=64), nullable=True),
    sa.Column('page_number', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['job_id'], ['processing_jobs.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('artifact_uuid'),
    sa.UniqueConstraint('storage_key', name='uq_processing_artifacts_storage_key')
    )
    op.create_index('idx_processing_artifacts_job_kind', 'processing_artifacts', ['job_id', 'kind'], unique=False)
    op.create_table('processing_job_steps',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('job_id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('status', sa.Enum('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', name='processingjobstepstatus'), nullable=False),
    sa.Column('start_time', sa.DateTime(), nullable=True),
    sa.Column('end_time', sa.DateTime(), nullable=True),
    sa.Column('step_order', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['job_id'], ['processing_jobs.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('job_id', 'name', name='uq_processing_job_steps_job_name')
    )
    op.create_index('idx_processing_job_steps_job_order', 'processing_job_steps', ['job_id', 'step_order'], unique=False)
    op.create_table('processing_job_uploads',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('job_id', sa.BigInteger(), nullable=False),
    sa.Column('upload_id', sa.BigInteger(), nullable=False),
    sa.ForeignKeyConstraint(['job_id'], ['processing_jobs.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['upload_id'], ['uploads.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('job_id', 'upload_id', name='uq_processing_job_uploads_job_upload')
    )
    op.create_index('idx_processing_job_uploads_job', 'processing_job_uploads', ['job_id'], unique=False)
    op.create_table('scores',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('score_uuid', sa.String(length=36), nullable=False),
    sa.Column('owner_user_id', sa.BigInteger(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('head_revision_id', sa.BigInteger(), nullable=True),
    sa.Column('originating_job_id', sa.BigInteger(), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('version >= 1', name='ck_scores_version_positive'),
    sa.ForeignKeyConstraint(['id', 'head_revision_id'], ['score_revisions.score_id', 'score_revisions.id'], name='fk_scores_head_revision', use_alter=True),
    sa.ForeignKeyConstraint(['originating_job_id'], ['processing_jobs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('originating_job_id'),
    sa.UniqueConstraint('score_uuid')
    )
    op.create_index('idx_scores_owner_updated', 'scores', ['owner_user_id', 'updated_at'], unique=False)
    op.create_table('score_invites',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('invite_uuid', sa.String(length=36), nullable=False),
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('role', sa.Enum('EDITOR', 'VIEWER', name='membershiprole'), nullable=False),
    sa.Column('status', sa.Enum('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED', 'DECLINED', name='invitestatus'), nullable=False),
    sa.Column('created_by_user_id', sa.BigInteger(), nullable=False),
    sa.Column('accepted_by_user_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.Column('accepted_at', sa.DateTime(), nullable=True),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.Column('declined_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['accepted_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('invite_uuid')
    )
    op.create_index('idx_score_invites_email_status', 'score_invites', ['email', 'status'], unique=False)
    op.create_index('idx_score_invites_score_created', 'score_invites', ['score_id', 'created_at'], unique=False)
    op.create_index('idx_score_invites_token_hash', 'score_invites', ['token_hash'], unique=True)
    op.create_table('score_library_entries',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('entry_uuid', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('source_type', sa.Enum('SELF_ADDED', 'BOOKMARK', name='libraryentrysourcetype'), nullable=False),
    sa.Column('folder_id', sa.BigInteger(), nullable=True),
    sa.Column('is_favorite', sa.Boolean(), nullable=False),
    sa.Column('practice_state', sa.Enum('TO_PRACTICE', 'IN_PROGRESS', 'MASTERED', name='librarypracticestate'), nullable=False),
    sa.Column('last_practiced_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['folder_id'], ['score_library_folders.id'], ),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_score_library_entries_user_favorite', 'score_library_entries', ['user_id', 'is_favorite'], unique=False)
    op.create_index('idx_score_library_entries_user_folder', 'score_library_entries', ['user_id', 'folder_id'], unique=False)
    op.create_index('idx_score_library_entries_user_practice_state', 'score_library_entries', ['user_id', 'practice_state'], unique=False)
    op.create_index('idx_score_library_entries_user_practiced', 'score_library_entries', ['user_id', 'last_practiced_at'], unique=False)
    op.create_index('idx_score_library_entries_user_updated', 'score_library_entries', ['user_id', 'updated_at'], unique=False)
    op.create_index('uq_score_library_entries_active_source', 'score_library_entries', ['user_id', 'score_id', 'source_type'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'), sqlite_where=sa.text('deleted_at IS NULL'))
    op.create_index('uq_score_library_entries_active_uuid', 'score_library_entries', ['entry_uuid'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'), sqlite_where=sa.text('deleted_at IS NULL'))
    op.create_table('score_memberships',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('role', sa.Enum('EDITOR', 'VIEWER', name='membershiprole'), nullable=False),
    sa.Column('created_by_user_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('score_id', 'user_id', name='uq_score_memberships_score_user')
    )
    op.create_index('idx_score_memberships_user_active', 'score_memberships', ['user_id', 'revoked_at'], unique=False)
    op.create_table('score_revisions',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('revision_uuid', sa.String(length=36), nullable=False),
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('revision_number', sa.Integer(), nullable=False),
    sa.Column('parent_revision_id', sa.BigInteger(), nullable=True),
    sa.Column('base_revision_id', sa.BigInteger(), nullable=True),
    sa.Column('content_hash', sa.String(length=64), nullable=False),
    sa.Column('idempotency_key', sa.String(length=128), nullable=True),
    sa.Column('origin', sa.Enum('OMR', 'EDIT', 'IMPORT', name='revisionorigin'), nullable=False),
    sa.Column('created_by_user_id', sa.BigInteger(), nullable=True),
    sa.Column('created_by_job_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('revision_number >= 1', name='ck_score_revisions_number_positive'),
    sa.ForeignKeyConstraint(['created_by_job_id'], ['processing_jobs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['score_id', 'base_revision_id'], ['score_revisions.score_id', 'score_revisions.id'], name='fk_score_revisions_base'),
    sa.ForeignKeyConstraint(['score_id', 'parent_revision_id'], ['score_revisions.score_id', 'score_revisions.id'], name='fk_score_revisions_parent'),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('revision_uuid'),
    sa.UniqueConstraint('score_id', 'content_hash', name='uq_score_revisions_score_content_hash'),
    sa.UniqueConstraint('score_id', 'id', name='uq_score_revisions_score_id_id'),
    sa.UniqueConstraint('score_id', 'idempotency_key', name='uq_score_revisions_score_idempotency_key'),
    sa.UniqueConstraint('score_id', 'revision_number', name='uq_score_revisions_score_number')
    )
    op.create_index('idx_score_revisions_score_created', 'score_revisions', ['score_id', 'created_at'], unique=False)
    op.create_foreign_key(
        'fk_processing_jobs_score_id',
        'processing_jobs',
        'scores',
        ['score_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_scores_head_revision',
        'scores',
        'score_revisions',
        ['id', 'head_revision_id'],
        ['score_id', 'id'],
    )
    op.create_table('score_taxonomy_tags',
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('tag_id', sa.BigInteger(), nullable=False),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('confidence', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['taxonomy_tags.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('score_id', 'tag_id')
    )
    op.create_index('idx_score_taxonomy_tags_tag_score', 'score_taxonomy_tags', ['tag_id', 'score_id'], unique=False)
    op.create_table('score_artifacts',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('artifact_uuid', sa.String(length=36), nullable=False),
    sa.Column('revision_id', sa.BigInteger(), nullable=False),
    sa.Column('kind', sa.Enum('MUSICXML', 'RENDERED_PAGE', name='artifactkind'), nullable=False),
    sa.Column('storage_backend', sa.String(length=32), nullable=False),
    sa.Column('storage_key', sa.String(length=768), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('mime_type', sa.String(length=128), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('page_number', sa.Integer(), nullable=True),
    sa.Column('render_profile', sa.String(length=128), nullable=True),
    sa.Column('generator', sa.String(length=64), nullable=False),
    sa.Column('generator_version', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("kind != 'RENDERED_PAGE' OR (render_profile IS NOT NULL AND page_number IS NOT NULL)", name='ck_score_artifacts_rendered_page_fields'),
    sa.ForeignKeyConstraint(['revision_id'], ['score_revisions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('artifact_uuid'),
    sa.UniqueConstraint('revision_id', 'kind', 'render_profile', 'page_number', name='uq_score_artifacts_rendered_variant'),
    sa.UniqueConstraint('storage_key', name='uq_score_artifacts_storage_key')
    )
    op.create_index('idx_score_artifacts_revision_kind', 'score_artifacts', ['revision_id', 'kind'], unique=False)
    op.create_index('uq_score_artifacts_canonical_musicxml', 'score_artifacts', ['revision_id'], unique=True, postgresql_where=sa.text("kind = 'MUSICXML'"), sqlite_where=sa.text("kind = 'MUSICXML'"))
    op.create_table('score_publications',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('public_slug', sa.String(length=128), nullable=False),
    sa.Column('published_revision_id', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.Enum('PUBLISHED', 'UNPUBLISHED', name='publicationstatus'), nullable=False),
    sa.Column('allow_download', sa.Boolean(), nullable=False),
    sa.Column('allow_practice', sa.Boolean(), nullable=False),
    sa.Column('published_by_user_id', sa.BigInteger(), nullable=False),
    sa.Column('published_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['published_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['score_id', 'published_revision_id'], ['score_revisions.score_id', 'score_revisions.id'], name='fk_score_publications_revision'),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('public_slug'),
    sa.UniqueConstraint('score_id')
    )
    op.create_index('idx_score_publications_status', 'score_publications', ['status'], unique=False)
    op.create_table('score_revision_metadata',
    sa.Column('revision_id', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.Enum('PENDING', 'READY', 'FAILED', name='metadatastatus'), nullable=False),
    sa.Column('measure_count', sa.Integer(), nullable=True),
    sa.Column('playback_duration_ms', sa.BigInteger(), nullable=True),
    sa.Column('part_count', sa.Integer(), nullable=True),
    sa.Column('primary_key_fifths', sa.Integer(), nullable=True),
    sa.Column('primary_mode', sa.String(length=32), nullable=True),
    sa.Column('key_signature_events', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('time_signature_events', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('tempo_events', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('extractor_version', sa.String(length=64), nullable=False),
    sa.Column('error_code', sa.String(length=64), nullable=True),
    sa.Column('computed_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint("status != 'FAILED' OR error_code IS NOT NULL", name='ck_score_revision_metadata_failed_with_error'),
    sa.CheckConstraint("status != 'READY' OR error_code IS NULL", name='ck_score_revision_metadata_ready_without_error'),
    sa.ForeignKeyConstraint(['revision_id'], ['score_revisions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('revision_id')
    )
    op.create_index('idx_score_revision_metadata_measure_count', 'score_revision_metadata', ['measure_count'], unique=False)
    op.create_index('idx_score_revision_metadata_status', 'score_revision_metadata', ['status'], unique=False)
    op.create_table('score_share_grants',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('grant_uuid', sa.String(length=36), nullable=False),
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('allow_download', sa.Boolean(), nullable=False),
    sa.Column('allow_practice', sa.Boolean(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.Column('created_by_user_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('grant_uuid')
    )
    op.create_index('idx_score_share_grants_score_created', 'score_share_grants', ['score_id', 'created_at'], unique=False)
    op.create_index('idx_score_share_grants_token_hash', 'score_share_grants', ['token_hash'], unique=True)
    op.create_table('practice_sessions',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('session_uuid', sa.String(length=36), nullable=False),
    sa.Column('score_id', sa.BigInteger(), nullable=False),
    sa.Column('revision_id', sa.BigInteger(), nullable=False),
    sa.Column('access_origin', sa.Enum('OWNER', 'MEMBERSHIP', 'SHARE', 'PUBLICATION', name='accessorigin'), nullable=False),
    sa.Column('share_grant_id', sa.BigInteger(), nullable=True),
    sa.Column('user_id', sa.BigInteger(), nullable=True),
    sa.Column('state', sa.Enum('CREATED', 'STREAMING', 'PAUSED', 'FINISHED', 'FAILED', name='practicesessionstate'), nullable=False),
    sa.Column('sample_rate', sa.BigInteger(), nullable=False),
    sa.Column('channels', sa.BigInteger(), nullable=False),
    sa.Column('frame_format', sa.String(length=32), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.Column('last_beat_position', sa.Float(), nullable=True),
    sa.Column('last_confidence', sa.Float(), nullable=True),
    sa.Column('audio_path', sa.String(length=512), nullable=True),
    sa.Column('report_status', sa.Enum('NOT_REQUESTED', 'PENDING', 'READY', 'FAILED', name='practicereportstatus'), nullable=False),
    sa.Column('report_payload', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['revision_id'], ['score_revisions.id'], ),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ),
    sa.ForeignKeyConstraint(['share_grant_id'], ['score_share_grants.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('session_uuid')
    )
    op.create_index('idx_practice_sessions_revision_created', 'practice_sessions', ['revision_id', 'created_at'], unique=False)
    op.create_index('idx_practice_sessions_state', 'practice_sessions', ['state'], unique=False)
    op.create_index('idx_practice_sessions_user_created', 'practice_sessions', ['user_id', 'created_at'], unique=False)
    op.create_table('share_grant_redemptions',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('grant_id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['grant_id'], ['score_share_grants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('grant_id', 'user_id', name='uq_share_grant_redemptions_grant_user')
    )
    op.create_index('idx_share_grant_redemptions_user_created', 'share_grant_redemptions', ['user_id', 'created_at'], unique=False)
    _seed_taxonomy_baseline()


def downgrade() -> None:
    # Drop the current pre-release schema baseline.
    op.drop_constraint('fk_scores_head_revision', 'scores', type_='foreignkey')
    op.drop_constraint('fk_processing_jobs_score_id', 'processing_jobs', type_='foreignkey')
    op.drop_index('idx_share_grant_redemptions_user_created', table_name='share_grant_redemptions')
    op.drop_table('share_grant_redemptions')
    op.drop_index('idx_practice_sessions_user_created', table_name='practice_sessions')
    op.drop_index('idx_practice_sessions_state', table_name='practice_sessions')
    op.drop_index('idx_practice_sessions_revision_created', table_name='practice_sessions')
    op.drop_table('practice_sessions')
    op.drop_index('idx_score_share_grants_token_hash', table_name='score_share_grants')
    op.drop_index('idx_score_share_grants_score_created', table_name='score_share_grants')
    op.drop_table('score_share_grants')
    op.drop_index('idx_score_revision_metadata_status', table_name='score_revision_metadata')
    op.drop_index('idx_score_revision_metadata_measure_count', table_name='score_revision_metadata')
    op.drop_table('score_revision_metadata')
    op.drop_index('idx_score_publications_status', table_name='score_publications')
    op.drop_table('score_publications')
    op.drop_index('uq_score_artifacts_canonical_musicxml', table_name='score_artifacts', postgresql_where=sa.text("kind = 'MUSICXML'"), sqlite_where=sa.text("kind = 'MUSICXML'"))
    op.drop_index('idx_score_artifacts_revision_kind', table_name='score_artifacts')
    op.drop_table('score_artifacts')
    op.drop_index('idx_score_taxonomy_tags_tag_score', table_name='score_taxonomy_tags')
    op.drop_table('score_taxonomy_tags')
    op.drop_index('idx_score_revisions_score_created', table_name='score_revisions')
    op.drop_table('score_revisions')
    op.drop_index('idx_score_memberships_user_active', table_name='score_memberships')
    op.drop_table('score_memberships')
    op.drop_index('uq_score_library_entries_active_uuid', table_name='score_library_entries', postgresql_where=sa.text('deleted_at IS NULL'), sqlite_where=sa.text('deleted_at IS NULL'))
    op.drop_index('uq_score_library_entries_active_source', table_name='score_library_entries', postgresql_where=sa.text('deleted_at IS NULL'), sqlite_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_score_library_entries_user_updated', table_name='score_library_entries')
    op.drop_index('idx_score_library_entries_user_practiced', table_name='score_library_entries')
    op.drop_index('idx_score_library_entries_user_practice_state', table_name='score_library_entries')
    op.drop_index('idx_score_library_entries_user_folder', table_name='score_library_entries')
    op.drop_index('idx_score_library_entries_user_favorite', table_name='score_library_entries')
    op.drop_table('score_library_entries')
    op.drop_index('idx_score_invites_token_hash', table_name='score_invites')
    op.drop_index('idx_score_invites_score_created', table_name='score_invites')
    op.drop_index('idx_score_invites_email_status', table_name='score_invites')
    op.drop_table('score_invites')
    op.drop_index('idx_scores_owner_updated', table_name='scores')
    op.drop_table('scores')
    op.drop_index('idx_processing_job_uploads_job', table_name='processing_job_uploads')
    op.drop_table('processing_job_uploads')
    op.drop_index('idx_processing_job_steps_job_order', table_name='processing_job_steps')
    op.drop_table('processing_job_steps')
    op.drop_index('idx_processing_artifacts_job_kind', table_name='processing_artifacts')
    op.drop_table('processing_artifacts')
    op.drop_table('uploads')
    op.drop_index('idx_taxonomy_tags_category_active_sort', table_name='taxonomy_tags')
    op.drop_table('taxonomy_tags')
    op.drop_index('uq_score_library_folders_active_name', table_name='score_library_folders', postgresql_where=sa.text('deleted_at IS NULL'), sqlite_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_score_library_folders_user_parent', table_name='score_library_folders')
    op.drop_table('score_library_folders')
    op.drop_index('idx_refresh_tokens_user_created', table_name='refresh_tokens')
    op.drop_index('idx_refresh_tokens_revoked', table_name='refresh_tokens')
    op.drop_index('idx_refresh_tokens_expires', table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.drop_index('idx_processing_jobs_user_created', table_name='processing_jobs')
    op.drop_index('idx_processing_jobs_state', table_name='processing_jobs')
    op.drop_table('processing_jobs')
    op.drop_index('idx_notification_events_resource', table_name='notification_events')
    op.drop_index('idx_notification_events_recipient_read', table_name='notification_events')
    op.drop_index('idx_notification_events_recipient_created', table_name='notification_events')
    op.drop_table('notification_events')
    op.drop_table('users')
    op.drop_index('idx_taxonomy_categories_active_sort', table_name='taxonomy_categories')
    op.drop_table('taxonomy_categories')
    for enum_name in ENUM_TYPES:
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
