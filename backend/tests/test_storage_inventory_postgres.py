"""Domain-owned SQL aggregates preserve semantic resource ownership on PostgreSQL."""

from sqlalchemy import select, event
from sqlalchemy.orm import Session

from app.db.models import (
    Score,
    ScoreInputAsset,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ImportArtifact,
    ImportJob,
    Upload,
    PerformanceTake,
    PerformanceTakeManifest,
)
from app.modules.import_jobs.domain import ImportArtifactKind
from app.modules.storage_governance.usage.domain import StorageUsageCategory as Category
from app.modules.revisions.domain import RevisionOrigin
from app.modules.revisions.domain import RevisionSourceFormat
from app.modules.score_assets.domain import RenderAssetKind
from app.modules.playback.domain import PlaybackAssetKind
from app.composition.storage_inventory import build_storage_inventory_registry
from app.modules.performance_takes.storage_inventory import PerformanceTakeStorageInventoryProvider
from app.modules.uploads.storage_inventory import UploadStorageInventoryProvider
from app.modules.scores.storage_inventory import ScoreInputStorageInventoryProvider
from app.shared.time import utc_now
from tests.test_storage_usage_reconciliation import database as database, inventory, upload, obj


def test_composed_inventory_has_complete_zero_totals_without_resources(database):
    with Session(database) as db:
        snapshot = build_storage_inventory_registry().snapshot_user(db, 1)
        assert snapshot.user_id == 1 and snapshot.used_bytes == dict.fromkeys(Category, 0)
        assert not db.new and not db.dirty


def test_each_upload_contribution_and_promoted_inputs_preserve_distinct_ownership(database):
    with Session(database) as db:
        expected = inventory(db)
        assert UploadStorageInventoryProvider().used_bytes_for_user(db, 1) == {Category.UPLOAD: 23}
        assert PerformanceTakeStorageInventoryProvider().used_bytes_for_user(db, 1) == {
            Category.UPLOAD: 31
        }
        assert ScoreInputStorageInventoryProvider().used_bytes_for_user(db, 1) == {
            Category.INPUT_ASSET: 58
        }
        assert build_storage_inventory_registry().snapshot_user(db, 1).used_bytes == expected
        assert UploadStorageInventoryProvider().used_bytes_for_user(db, 2) == {Category.UPLOAD: 0}
        assert PerformanceTakeStorageInventoryProvider().used_bytes_for_user(db, 2) == {
            Category.UPLOAD: 0
        }


def test_physical_object_reuse_preserves_semantic_and_cross_category_multiplicity(database):
    with Session(database) as db:
        inventory(db)
        source = db.scalar(select(ScoreRevisionSource))
        # One source object also backs two independent Upload allocations.
        for index in range(2):
            db.add(
                Upload(
                    upload_uuid=f"shared-object-{index}",
                    uploader_user_id=1,
                    stored_object_id=source.stored_object_id,
                    original_filename="shared.png",
                )
            )
        # A distinct final recording may share physical bytes with an Upload.
        take = db.scalar(select(PerformanceTake))
        db.add(
            Upload(
                upload_uuid="recording-reference",
                uploader_user_id=1,
                stored_object_id=take.recording_object_id,
                original_filename="recording.webm",
            )
        )
        db.commit()
        totals = build_storage_inventory_registry().snapshot_user(db, 1).used_bytes
        assert totals[Category.SOURCE] == 11
        assert totals[Category.UPLOAD] == 23 + 31 + 11 * 2 + 31
        assert totals[Category.INPUT_ASSET] == 58


def test_tombstones_and_user_transfer_keep_usage_until_semantic_reference_release(database):
    with Session(database) as db:
        expected = inventory(db)
        score = db.scalar(select(Score).where(Score.score_uuid == "score-1"))
        score.deleted_at = utc_now()
        db.commit()
        assert build_storage_inventory_registry().snapshot_user(db, 1).used_bytes == expected
        score.owner_user_id = 2
        db.commit()
        first = build_storage_inventory_registry().snapshot_user(db, 1).used_bytes
        second = build_storage_inventory_registry().snapshot_user(db, 2).used_bytes
        assert first == {
            **expected,
            Category.SOURCE: 0,
            Category.DERIVED_RENDER: 0,
            Category.DERIVED_AUDIO: 0,
            Category.INPUT_ASSET: 29,
        }
        assert second == {
            Category.SOURCE: 11,
            Category.DERIVED_RENDER: 13,
            Category.DERIVED_AUDIO: 17,
            Category.INPUT_ASSET: 29,
            Category.UPLOAD: 0,
            Category.TEMP_IMPORT: 0,
        }


def test_inventory_queries_return_sql_aggregates_with_resource_count_independent_query_budget(
    database,
):
    registry = build_storage_inventory_registry()
    with Session(database) as db:
        expected = inventory(db)
    counts = []
    for size in (1, 100):
        if size == 100:
            with Session(database) as db:
                backing = db.scalar(select(Upload).where(Upload.upload_uuid == "backing"))
                job = db.scalar(select(ImportJob))
                for index in range(99):
                    score = Score(
                        score_uuid=f"large-{index}", owner_user_id=1, display_title="Inventory"
                    )
                    db.add(score)
                    db.flush()
                    db.add(
                        ScoreInputAsset(
                            asset_uuid=f"large-input-{index}",
                            score_id=score.id,
                            upload_id=backing.id,
                        )
                    )
                    upload(db, f"large-upload-{index}", 3)
                    # ImportArtifact keeps its own logical allocation, independent of key shape.
                    db.add(
                        ImportArtifact(
                            job_id=job.id,
                            artifact_uuid=f"large-import-{index}",
                            kind=ImportArtifactKind.REVIEW_MUSICXML,
                            stored_object_id=obj(db, f"large-artifact-{index}", 5).id,
                            filename="score.musicxml",
                        )
                    )
                    new_revision = ScoreRevision(
                        revision_uuid=f"large-revision-{index}",
                        score_id=score.id,
                        revision_number=1,
                        origin=RevisionOrigin.EDIT,
                        content_hash="c" * 64,
                    )
                    db.add(new_revision)
                    db.flush()
                    db.add(
                        ScoreRevisionSource(
                            source_uuid=f"large-source-{index}",
                            revision_id=new_revision.id,
                            format=RevisionSourceFormat.MUSICXML,
                            stored_object_id=obj(db, f"large-source-{index}", 7).id,
                            filename="score.musicxml",
                            generator="test",
                            generator_version="1",
                        )
                    )
                    db.add(
                        ScoreRenderAsset(
                            asset_uuid=f"large-render-{index}",
                            revision_id=new_revision.id,
                            kind=RenderAssetKind.RENDERED_PAGE,
                            render_profile="default",
                            page_number=1,
                            stored_object_id=obj(db, f"large-render-{index}", 13).id,
                            filename="page.svg",
                            generator="test",
                            generator_version="1",
                        )
                    )
                    db.add(
                        ScorePlaybackAsset(
                            asset_uuid=f"large-audio-{index}",
                            revision_id=new_revision.id,
                            kind=PlaybackAssetKind.AUDIO,
                            source_fingerprint="f" * 64,
                            stored_object_id=obj(db, f"large-audio-{index}", 17).id,
                            filename="recording.wav",
                            generator="test",
                            generator_version="1",
                        )
                    )
                    manifest = PerformanceTakeManifest(
                        user_id=1,
                        take_uuid=f"large-take-{index}",
                        manifest_json="{}",
                        manifest_sha256="e" * 64,
                    )
                    db.add(manifest)
                    db.flush()
                    db.add(
                        PerformanceTake(
                            owner_user_id=1,
                            manifest_id=manifest.id,
                            recording_object_id=obj(db, f"large-recording-{index}", 11).id,
                        )
                    )
                db.commit()
                expected = {
                    **expected,
                    Category.INPUT_ASSET: 58 + 99 * 29,
                    Category.UPLOAD: 54 + 99 * 14,
                    Category.TEMP_IMPORT: 19 + 99 * 5,
                    Category.SOURCE: 11 + 99 * 7,
                    Category.DERIVED_RENDER: 13 * 100,
                    Category.DERIVED_AUDIO: 17 * 100,
                }
        statements = []
        returned_rows = []

        def record(_connection, _cursor, statement, *_args):
            statements.append(statement)

        def aggregate_rows(_connection, cursor, statement, *_args):
            # Each result is an aggregate/category group, never a resource list.
            returned_rows.append(cursor.rowcount)

        with Session(database) as fresh:
            event.listen(database, "before_cursor_execute", record)
            event.listen(database, "after_cursor_execute", aggregate_rows)
            try:
                assert registry.snapshot_user(fresh, 1).used_bytes == expected
            finally:
                event.remove(database, "before_cursor_execute", record)
                event.remove(database, "after_cursor_execute", aggregate_rows)
            assert len(fresh.identity_map) == 0
        assert all("sum(" in sql.lower() for sql in statements)
        assert all(0 <= rows <= 2 for rows in returned_rows)
        counts.append(len(statements))
    print(f"INVENTORY_QUERY_BUDGET 1={counts[0]}, 100={counts[1]}")
    assert counts[0] == counts[1] == 6
