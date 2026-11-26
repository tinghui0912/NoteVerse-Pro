"""Cleanup execution owns batch and lock-unit transactions on real PostgreSQL."""

from tests.support.uploads import settled_upload_session

from datetime import timedelta

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models import (
    Notification,
    MailOutbox,
    MailOutboxStatus,
    Upload,
    StoredObject,
    StoredObjectRetirement,
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageEvent,
    Score,
    ScoreRevision,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    SchedulerHeartbeat,
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.revisions.domain import RevisionOrigin
from app.modules.media_storage.persistence import object_from_bytes
from app.composition.storage_resources import storage_usage_service
from app.shared.time import utc_now
from tests.support.maintenance import configure_maintenance
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_guest_previews import add_page, add_audio


@pytest.fixture
def maintenance(score_service_session, monkeypatch):
    db, storage = score_service_session
    return db.get_bind(), storage, configure_maintenance(monkeypatch, db.get_bind())


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def seed_batch(engine, storage, kind):
    now = utc_now()
    identities = []
    with Session(engine) as db:
        for index in range(3):
            created = now - timedelta(days=365) if index < 2 else now
            if kind == "notification":
                row = Notification(
                    recipient_user_id=1,
                    kind="import.failed",
                    import_job_id=str(index),
                    created_at=created,
                )
            elif kind == "mail":
                row = MailOutbox(
                    source_kind="ACCOUNT",
                    source_id=1,
                    category="test",
                    dedupe_key=str(index),
                    recipient="recipient@example.com",
                    subject="Test",
                    status=MailOutboxStatus.SENT,
                    completed_at=created,
                )
            else:
                key = f"maintenance/upload-{index}.png"
                storage.put_bytes(key=key, content=b"png", content_type="image/png")
                obj = object_from_bytes(object_key=key, content=b"png", content_type="image/png")
                row = Upload(
                    upload_session=settled_upload_session(user_id=1),
                    stored_object=obj,
                    original_filename="upload.png",
                    uploader_user_id=1,
                    created_at=created,
                )
                storage_usage_service.record_allocation(
                    db,
                    user_id=1,
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=3,
                    reason="fixture",
                )
            db.add(row)
            db.flush()
            identities.append(row.id)
        db.commit()
    return identities


@pytest.mark.parametrize("kind", ["notification", "mail", "job"])
@pytest.mark.parametrize("outcome", ["success", "execution_failure", "caller_rollback"])
def test_batch_cleanup_obeys_its_execution_transaction(maintenance, monkeypatch, kind, outcome):
    engine, storage, worker = maintenance
    seed_batch(engine, storage, kind)
    service, method, execute, model, key, result_key = {
        "notification": (
            worker.notification_maintenance_service,
            "run",
            worker.execute_notification_maintenance,
            Notification,
            "notification_maintenance",
            "expired_notifications_deleted",
        ),
        "mail": (
            worker.mail_outbox_service,
            "cleanup",
            worker.execute_mail_outbox_cleanup,
            MailOutbox,
            "mail_outbox_cleanup",
            "deleted",
        ),
        "job": (
            worker.build_import_maintenance_service(),
            "run",
            worker.execute_job_maintenance,
            Upload,
            "job_maintenance",
            "orphan_uploads_deleted",
        ),
    }[kind]
    if kind == "job":
        monkeypatch.setattr(worker, "build_import_maintenance_service", lambda: service)
    mutate = getattr(service, method)
    if outcome == "caller_rollback":
        with Session(engine) as db:
            mutate(db)
            assert count(db, model) == 1
            db.rollback()
    elif outcome == "execution_failure":

        def interrupted(db):
            mutate(db)
            db.flush()
            assert count(db, model) == 1
            raise RuntimeError("cleanup interrupted")

        monkeypatch.setattr(service, method, interrupted)
        with pytest.raises(RuntimeError, match="cleanup interrupted"):
            execute()
    else:
        assert execute() == {result_key: 2}
    with Session(engine) as db:
        assert count(db, model) == (1 if outcome == "success" else 3)
        heartbeat = db.scalar(select(SchedulerHeartbeat).where(SchedulerHeartbeat.job_key == key))
        if outcome == "caller_rollback":
            assert heartbeat is None
        else:
            assert heartbeat.success_count == (1 if outcome == "success" else 0)
            assert heartbeat.failure_count == (1 if outcome == "execution_failure" else 0)
        if kind == "job":
            assert db.get(StorageUsageAccount, 1).used_bytes == (3 if outcome == "success" else 9)
            assert count(db, StoredObjectRetirement) == (2 if outcome == "success" else 0)
            assert count(db, StoredObject) == 3
            assert all(storage.exists(f"maintenance/upload-{i}.png") for i in range(3))


def test_orphan_savepoints_isolate_an_item_and_continue_the_worker_batch(maintenance, monkeypatch):
    from app.modules.import_jobs import maintenance_service as domain

    engine, storage, worker = maintenance
    ids = seed_batch(engine, storage, "job")
    with Session(engine) as db:
        db.get(Upload, ids[2]).created_at = utc_now() - timedelta(days=365)
        failing_object_id = db.get(Upload, ids[1]).stored_object_id
        db.commit()
    original = domain.retire_after_release

    def interrupted(db, object_id):
        result = original(db, object_id)
        if object_id == failing_object_id:
            raise RuntimeError("item retirement interrupted")
        return result

    monkeypatch.setattr(domain, "retire_after_release", interrupted)
    assert worker.execute_job_maintenance() == {"orphan_uploads_deleted": 2}
    with Session(engine) as db:
        assert list(db.scalars(select(Upload.id))) == [ids[1]]
        assert db.get(StorageUsageAccount, 1).used_bytes == 3
        assert count(db, StoredObjectRetirement) == 2
        assert set(db.scalars(select(StoredObjectRetirement.stored_object_id))) == set(
            db.scalars(select(StoredObject.id))
        ) - {failing_object_id}
        assert count(db, StorageUsageEvent) == 5  # Three allocations, two releases.
        assert all(storage.exists(f"maintenance/upload-{i}.png") for i in range(3))
        heartbeat = db.scalar(select(SchedulerHeartbeat))
        assert heartbeat.success_count == 1 and heartbeat.failure_count == 0


def seed_derived(engine, storage):
    facts = {}
    with Session(engine) as db:
        for score_id in (20, 10):
            score = Score(
                id=score_id,
                score_uuid=f"score-{score_id}",
                owner_user_id=1,
                display_title="Retention",
            )
            db.add(score)
            db.flush()
            for number in (1, 2):
                db.add(
                    ScoreRevision(
                        id=score_id + number,
                        revision_uuid=f"revision-{score_id}-{number}",
                        score_id=score_id,
                        revision_number=number,
                        origin=RevisionOrigin.EDIT,
                        content_hash=f"{score_id + number:064x}",
                    )
                )
            db.flush()
            score.head_revision_id = score_id + 2
            db.commit()
            add_page(db, storage, score_id + 1, f"page-{score_id}")
            add_audio(db, storage, score_id + 1)
            assets = [
                db.scalar(select(model).where(model.revision_id == score_id + 1))
                for model in (ScoreRenderAsset, ScorePlaybackAsset)
            ]
            facts[score_id] = {
                "objects": {a.stored_object_id for a in assets},
                "keys": [a.stored_object.object_key for a in assets],
                "bytes": sum(a.stored_object.byte_size for a in assets),
                "render_uuid": assets[0].asset_uuid,
            }
            for asset, category in zip(
                assets,
                (StorageUsageCategory.DERIVED_RENDER, StorageUsageCategory.DERIVED_AUDIO),
                strict=True,
            ):
                storage_usage_service.record_allocation(
                    db,
                    user_id=1,
                    category=category,
                    bytes_count=asset.stored_object.byte_size,
                    reason="fixture",
                    object_type=asset.__tablename__,
                    object_id=asset.asset_uuid,
                    storage_key=asset.stored_object.object_key,
                )
            db.commit()
    return facts


@pytest.mark.parametrize(
    "stage", ["success", "asset_deletion", "usage_release", "retirement", "caller_rollback"]
)
def test_derived_retention_commits_each_score_and_its_complete_release_graph(
    maintenance, monkeypatch, stage
):
    from app.modules.revisions import derived_asset_retention_service as domain

    engine, storage, worker = maintenance
    facts = seed_derived(engine, storage)
    with Session(engine) as db:
        assert worker.build_derived_asset_retention_service().candidate_score_ids(db) == [10, 20]
    if stage in {"asset_deletion", "usage_release"}:
        release = storage_usage_service.record_release

        def interrupted(db, **kwargs):
            failing = kwargs["object_id"] == facts[20]["render_uuid"]
            if not failing or stage == "usage_release":
                release(db, **kwargs)
            if failing:
                db.flush()
                raise RuntimeError("score cleanup interrupted")

        monkeypatch.setattr(storage_usage_service, "record_release", interrupted)
    elif stage == "retirement":
        retire = domain.retire_after_release

        def interrupted(db, *object_ids):
            result = retire(db, *object_ids)
            if set(object_ids) == facts[20]["objects"]:
                raise RuntimeError("score cleanup interrupted")
            return result

        monkeypatch.setattr(domain, "retire_after_release", interrupted)
    if stage == "caller_rollback":
        with Session(engine) as db:
            assert (
                worker.build_derived_asset_retention_service()
                .cleanup_for_score(db, score_id=10)
                .object_retirements_queued
                == 2
            )
            db.rollback()
    elif stage == "success":
        assert worker.execute_derived_asset_cleanup() == {
            "rendered_pages_deleted": 2,
            "playback_assets_deleted": 2,
            "object_retirements_queued": 4,
        }
    else:
        with pytest.raises(RuntimeError, match="score cleanup interrupted"):
            worker.execute_derived_asset_cleanup()
    with Session(engine) as db:
        retained_scores = (
            {10, 20} if stage == "caller_rollback" else set() if stage == "success" else {20}
        )
        for model in (ScoreRenderAsset, ScorePlaybackAsset):
            assert set(db.scalars(select(model.revision_id))) == {s + 1 for s in retained_scores}
        retained_bytes = sum(facts[s]["bytes"] for s in retained_scores)
        # Derived counters are accounting facts, outside quota-counted categories.
        assert db.get(StorageUsageAccount, 1).used_bytes == 0
        assert sum(db.scalars(select(StorageUsageCounter.used_bytes))) == retained_bytes
        expected_retired = set().union(*(facts[s]["objects"] for s in {10, 20} - retained_scores))
        assert set(db.scalars(select(StoredObjectRetirement.stored_object_id))) == expected_retired
        assert count(db, StorageUsageEvent) == 4 + len(expected_retired)
        assert all(storage.exists(key) for f in facts.values() for key in f["keys"])
        assert count(db, StoredObject) == 4
        heartbeat = db.scalar(select(SchedulerHeartbeat))
        if stage == "caller_rollback":
            assert heartbeat is None
        else:
            assert heartbeat.success_count == (1 if stage == "success" else 0)
            assert heartbeat.failure_count == (0 if stage == "success" else 1)
