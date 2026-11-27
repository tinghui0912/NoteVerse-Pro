"""Fresh-session SQL budgets and stable personal timeline continuations on PostgreSQL."""

from tests.support.runtime_resources import resources_for


from app.composition import storage_resources as _resource_wiring

import ast
import base64
import json
from contextlib import contextmanager
from pathlib import Path
from datetime import timedelta

import pytest
from sqlalchemy import select, event
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from app.db.models import (
    User,
    Score,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreRevisionEvent,
    ScoreRevisionNote,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    ScoreMembership,
    Notification,
    NotificationKind,
    PerformanceTake,
    PracticeBundleRecord,
)
from app.modules.revisions.domain import RevisionOrigin
from app.modules.metadata.domain import MetadataStatus
from app.modules.score_assets.domain import RenderAssetKind
from app.db.models.score_access import MembershipRole
from app.modules.playback.domain import PlaybackAssetKind
from app.modules.playback.domain import PlaybackOutboxStatus
from app.modules.revisions.render_states import ScoreRevisionRenderStatus
from app.modules.library.service import LibraryService
from app.modules.library.schemas import LibrarySort, LibraryView
from app.modules.revisions.service import RevisionService
from app.modules.notifications.service import NotificationService
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.media_storage.persistence import object_from_bytes
from app.shared.time import utc_now
from app.shared.feed_cursor import encode_cursor
from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.runtime.customer_api.main import app
from tests.support.take_fixtures import _manifest_row, VALID_WEBM_BYTES
from tests.support.runtime_resources import storage as _storage_provider


@pytest.fixture
def pages(postgres_engine):
    now = utc_now()
    with Session(postgres_engine) as db:
        db.add_all(
            [
                User(id=i, email=f"page-{i}@example.test", password_hash="hash")
                for i in range(1, 301)
            ]
        )
        db.flush()
        for i in range(1, 55):
            score = Score(
                id=i,
                score_uuid=f"score-{i}",
                owner_user_id=1 if i <= 50 or i == 53 else 2,
                display_title=f"Score {i:03}",
                deleted_at=now if i == 53 else None,
            )
            db.add(score)
            db.flush()
            revision = ScoreRevision(
                id=i,
                score_id=i,
                revision_uuid=f"revision-{i}",
                revision_number=1,
                content_hash="a" * 64,
                origin=RevisionOrigin.EDIT,
                created_by_user_id=i + 10,
            )
            db.add(revision)
            db.flush()
            score.head_revision_id = i
            db.add(
                ScoreRevisionMetadata(
                    revision_id=i,
                    status=MetadataStatus.READY,
                    extractor_version="test",
                    measure_count=4,
                )
            )
            db.add(
                ScoreRevisionNote(
                    score_id=i, revision_id=i, note=f"Note {i}", author_user_id=i + 110
                )
            )
            db.add(
                ScoreRevisionEvent(
                    score_id=i,
                    revision_id=i,
                    target_revision_id=i,
                    actor_user_id=i + 210,
                    type="RESTORE",
                    note=f"Restore {i}",
                    created_at=now,
                )
            )
            # Equal-time events require deterministic row-id tie breaking.
            db.flush()
            db.add(
                ScoreRevisionEvent(
                    score_id=i,
                    revision_id=i,
                    target_revision_id=i,
                    actor_user_id=i + 210,
                    type="RESTORE",
                    note=f"Latest {i}",
                    created_at=now,
                )
            )
            ready = i % 2 == 1
            db.add(
                ScoreRevisionRenderOutbox(
                    outbox_uuid=f"render-{i}",
                    score_id=i,
                    revision_id=i,
                    source_fingerprint="a" * 64,
                    render_profile="default",
                    status=ScoreRevisionRenderStatus.PENDING,
                )
            )
            db.add(
                PlaybackOutbox(
                    outbox_uuid=f"playback-{i}",
                    score_id=i,
                    revision_id=i,
                    source_fingerprint="a" * 64,
                    status=PlaybackOutboxStatus.PENDING,
                )
            )
            if ready:
                for page in (2, 1):
                    obj = object_from_bytes(
                        object_key=f"render/{i}/{page}",
                        content=b"image",
                        content_type="image/svg+xml",
                    )
                    db.add(obj)
                    db.flush()
                    db.add(
                        ScoreRenderAsset(
                            asset_uuid=f"page-{i}-{page}",
                            revision_id=i,
                            kind=RenderAssetKind.RENDERED_PAGE,
                            render_profile="default",
                            page_number=page,
                            stored_object_id=obj.id,
                            filename="page.svg",
                            generator="test",
                            generator_version="1",
                        )
                    )
                obj = object_from_bytes(
                    object_key=f"audio/{i}", content=b"audio", content_type="audio/wav"
                )
                db.add(obj)
                db.flush()
                db.add(
                    ScorePlaybackAsset(
                        revision_id=i,
                        asset_uuid=f"audio-{i}",
                        kind=PlaybackAssetKind.AUDIO,
                        stored_object_id=obj.id,
                        filename="score.wav",
                        duration_ms=1000,
                        source_fingerprint="a" * 64,
                        generator="test",
                        generator_version="1",
                    )
                )
        history = Score(id=100, score_uuid="history", owner_user_id=1, display_title="Z History")
        db.add(history)
        db.flush()
        for i in range(1, 51):
            revision = ScoreRevision(
                id=1000 + i,
                score_id=100,
                revision_uuid=f"history-{i}",
                revision_number=i,
                content_hash="a" * 64,
                origin=RevisionOrigin.EDIT,
                created_by_user_id=i + 10,
            )
            db.add(revision)
            db.flush()
            db.add(
                ScoreRevisionNote(
                    score_id=100, revision_id=revision.id, note=f"Note {i}", author_user_id=i + 110
                )
            )
            for label in ("Earlier", "Latest"):
                db.add(
                    ScoreRevisionEvent(
                        score_id=100,
                        revision_id=revision.id,
                        target_revision_id=1001,
                        actor_user_id=i + 210,
                        type="RESTORE",
                        note=f"{label} {i}",
                        created_at=now,
                    )
                )
                db.flush()
        history.head_revision_id = 1050
        db.add(
            ScoreMembership(
                score_id=51, user_id=1, role=MembershipRole.VIEWER, created_by_user_id=2
            )
        )
        for i in range(1, 51):
            db.add(
                Notification(
                    notification_uuid=f"notification-{i}",
                    recipient_user_id=1,
                    kind=NotificationKind.SCORE_VERSION_CREATED
                    if i % 2 or i == 50
                    else NotificationKind.IMPORT_FAILED,
                    actor_user_id=i + 10 if i % 2 or i == 50 else None,
                    score_id="score-1" if i % 2 or i == 50 else None,
                    revision_id="revision-1" if i % 2 or i == 50 else None,
                    score_display_title_snapshot="Score" if i % 2 or i == 50 else None,
                    import_job_id=f"job-{i}" if not (i % 2 or i == 50) else None,
                    created_at=now,
                )
            )
            manifest = _manifest_row(
                PracticeBundleRecord(bundle_id="bundle", artifact_id="artifact"),
                user_id=1,
                take_uuid=f"take-{i}",
                title="Score",
            )
            obj = object_from_bytes(
                object_key=f"take/{i}", content=VALID_WEBM_BYTES, content_type="audio/webm"
            )
            db.add_all([manifest, obj])
            db.flush()
            db.add(
                PerformanceTake(
                    owner_user_id=1,
                    manifest_id=manifest.id,
                    recording_object_id=obj.id,
                    linked_score_id=1 if i == 50 else [1, 51, 52, 53, None][(i - 1) % 5],
                    created_at=now,
                )
            )
        db.commit()
    return postgres_engine, now


@contextmanager
def statements(engine):
    calls = []

    def observe(_conn, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            calls.append(statement)

    event.listen(engine, "before_cursor_execute", observe)
    try:
        yield calls
    finally:
        event.remove(engine, "before_cursor_execute", observe)


def load(db, kind, limit):
    if kind == "library":
        return LibraryService().list_scores(
            db,
            1,
            view=LibraryView.ALL,
            folder_id=None,
            search=None,
            sort=LibrarySort.NAME_ASC,
            page=1,
            page_size=limit,
        )[0]
    if kind == "revision":
        return (
            RevisionService(
                quota=_resource_wiring.storage_quota_service,
                revision_writer=resources_for().build_revision_writer(),
                writes=resources_for(_storage_provider).build_object_write_coordinator(),
                post_commit=resources_for().post_commit,
            )
            .list(db, "history", 1, limit=limit)
            .items
        )
    if kind == "notifications":
        return NotificationService().list_for_user(db, 1, limit=limit).items
    return (
        PerformanceTakeService(
            usage=_resource_wiring.storage_usage_service,
            delivery=resources_for(_storage_provider).build_media_delivery_service(),
        )
        .list_takes(db, 1, limit=limit)
        .items
    )


@pytest.mark.parametrize("kind", ["library", "revision", "notifications", "takes"])
def test_page_statement_budget_is_independent_of_item_count(pages, kind):
    engine, _ = pages
    counts = []
    for limit in (1, 50):
        with Session(engine) as db, statements(engine) as calls:
            values = load(db, kind, limit)
            assert len(values) == limit
            if kind == "library":
                for value in values:
                    i = int(value.score_id.split("-")[-1])
                    assert value.derived_assets.preview.status == (
                        "ready" if i % 2 else "processing"
                    )
                    assert value.derived_assets.audio.status == ("ready" if i % 2 else "processing")
                    if i % 2:
                        assert value.derived_assets.preview.asset_id == f"page-{i}-1"
                    assert value.metadata.measure_count == 4
            if kind == "revision":
                assert all(
                    value.created_by and value.note.author and value.restore.actor
                    for value in values
                )
                assert all(value.restore.note.startswith("Latest") for value in values)
                assert all(
                    value.restore.restored_from_revision_id == "history-1"
                    and value.restore.restored_from_revision_number == 1
                    for value in values
                )
            if kind == "takes" and limit == 50:
                by_id = {row.take_id: row for row in values}
                assert by_id["take-1"].linked_score_id == "score-1"
                assert by_id["take-2"].linked_score_id == "score-51"
                for identity in ("take-3", "take-4", "take-5"):
                    assert (
                        by_id[identity].linked_score_id is None
                        and not by_id[identity].can_open_score
                    )
            counts.append(len(calls))
    print(f"QUERY_BUDGET {kind}: 1 item={counts[0]}, 50 items={counts[1]}")
    assert counts[0] == counts[1]
    assert counts[0] <= {"library": 6, "revision": 5, "notifications": 3, "takes": 2}[kind]


@pytest.mark.parametrize("kind", ["notifications", "takes"])
def test_keyset_continuation_survives_equal_times_and_anchor_mutation(pages, kind):
    engine, now = pages
    service = (
        NotificationService()
        if kind == "notifications"
        else PerformanceTakeService(
            usage=_resource_wiring.storage_usage_service,
            delivery=resources_for(_storage_provider).build_media_delivery_service(),
        )
    )

    def page(db, cursor=None):
        return (
            service.list_for_user(db, 1, limit=7, cursor=cursor)
            if kind == "notifications"
            else service.list_takes(db, 1, limit=7, cursor=cursor)
        )

    def identity(row):
        return row.notification_id if kind == "notifications" else row.take_id

    with Session(engine) as db:
        first = page(db)
        ids = [identity(row) for row in first.items]
        cursor = first.next_cursor
        assert cursor
        if kind == "notifications":
            anchor = db.scalar(
                select(Notification).where(Notification.notification_uuid == ids[-1])
            )
            db.delete(anchor)
            db.add(
                Notification(
                    notification_uuid="new",
                    recipient_user_id=1,
                    kind=NotificationKind.IMPORT_FAILED,
                    import_job_id="new",
                    created_at=now + timedelta(seconds=1),
                )
            )
            db.scalar(
                select(Notification).where(Notification.notification_uuid == "notification-1")
            ).read_at = now
        else:
            from app.db.models import PerformanceTakeManifest

            anchor = db.scalar(
                select(PerformanceTake)
                .join(PerformanceTakeManifest)
                .where(PerformanceTakeManifest.take_uuid == ids[-1])
            )
            db.delete(anchor)
            # Insert a newer Take by cloning admitted manifest/media into distinct semantic records.
            manifest = _manifest_row(
                PracticeBundleRecord(bundle_id="bundle", artifact_id="artifact"),
                user_id=1,
                take_uuid="new",
                title="New",
            )
            obj = object_from_bytes(
                object_key="take/new", content=VALID_WEBM_BYTES, content_type="audio/webm"
            )
            db.add_all([manifest, obj])
            db.flush()
            db.add(
                PerformanceTake(
                    owner_user_id=1,
                    manifest_id=manifest.id,
                    recording_object_id=obj.id,
                    created_at=now + timedelta(seconds=1),
                )
            )
            db.scalar(select(PerformanceTake).order_by(PerformanceTake.id)).updated_at = (
                now + timedelta(seconds=2)
            )
        db.commit()
    while cursor is not None:
        with Session(engine) as db:
            next_page = page(db, cursor)
            ids.extend(identity(row) for row in next_page.items)
            assert next_page.next_cursor != cursor
            cursor = next_page.next_cursor
    assert len(ids) == len(set(ids)) == 50
    assert "new" not in ids
    assert set(ids) == {
        f"notification-{i}" if kind == "notifications" else f"take-{i}" for i in range(1, 51)
    }


@pytest.mark.parametrize("kind", ["notifications", "takes"])
def test_cursor_payload_and_scope_fail_closed_over_http(pages, kind):
    engine, now = pages
    collection = "notifications" if kind == "notifications" else "performance_takes"
    scope = "1" if kind == "notifications" else "[1,null]"
    good = encode_cursor(collection, scope, now, 1)
    payload = json.loads(base64.urlsafe_b64decode(good + "=" * (-len(good) % 4)))
    invalid = [
        "",
        "***",
        "e30",
        encode_cursor(collection, "2" if kind == "notifications" else "[2,null]", now, 1),
        encode_cursor(
            "performance_takes" if kind == "notifications" else "notifications", scope, now, 1
        ),
    ]
    for key, value in [
        ("version", 2),
        ("version", True),
        ("collection", "other"),
        ("scope", "2"),
        ("row_id", "1"),
        ("unknown", 1),
    ]:
        invalid.append(
            base64.urlsafe_b64encode(json.dumps({**payload, key: value}).encode())
            .decode()
            .rstrip("=")
        )

    def database():
        with Session(engine) as db:
            yield db

    def user():
        with Session(engine) as db:
            return db.get(User, 1)

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    try:
        with TestClient(app) as client:
            url = (
                "/api/v1/me/notifications"
                if kind == "notifications"
                else "/api/v1/performance-takes"
            )
            for cursor in invalid:
                assert client.get(url, params={"cursor": cursor}).status_code == 422
            assert client.get(url, params={"cursor": good}).status_code == 200
            if kind == "takes":
                scoped = encode_cursor(collection, '[1,"score-1"]', now, 1)
                assert (
                    client.get(url, params={"cursor": scoped, "score_id": "score-1"}).status_code
                    == 200
                )
                assert (
                    client.get(url, params={"cursor": scoped, "score_id": "score-51"}).status_code
                    == 422
                )
                assert client.get(url, params={"cursor": scoped}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_page_paths_delegate_to_query_specific_projection_owners():
    root = Path(__file__).parents[1] / "app/modules"
    for file, method, forbidden in [
        ("library/service.py", "list_scores", {"get", "score_derived_assets"}),
        ("performance_takes/service.py", "list_takes", {"authorize_score", "_can_open_score"}),
        ("notifications/read_model.py", "notification_page", {"get"}),
    ]:
        tree = ast.parse((root / file).read_text())
        function = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == method
        )
        calls = {
            node.func.attr if isinstance(node.func, ast.Attribute) else node.func.id
            for node in ast.walk(function)
            if isinstance(node, ast.Call) and isinstance(node.func, (ast.Name, ast.Attribute))
        }
        assert not calls & forbidden


def test_take_visibility_query_errors_propagate_instead_of_becoming_access_denial(pages):
    engine, _ = pages

    def fail_visibility(_conn, _cursor, sql, *_args):
        if "score_memberships" in sql and "scores.score_uuid" in sql:
            raise RuntimeError("visibility query unavailable")

    event.listen(engine, "before_cursor_execute", fail_visibility)
    try:
        with (
            Session(engine) as db,
            pytest.raises(RuntimeError, match="visibility query unavailable"),
        ):
            PerformanceTakeService(
                usage=_resource_wiring.storage_usage_service,
                delivery=resources_for(_storage_provider).build_media_delivery_service(),
            ).list_takes(db, 1)
    finally:
        event.remove(engine, "before_cursor_execute", fail_visibility)


@pytest.mark.parametrize("score_filter", [None, "score-1"])
def test_take_timeline_owns_its_seek_with_other_user_noise(pages, score_filter):
    engine, now = pages
    with Session(engine) as db:
        for i in range(200):
            manifest = _manifest_row(
                PracticeBundleRecord(bundle_id="bundle", artifact_id="artifact"),
                user_id=2,
                take_uuid=f"other-{i}",
                title="Other user",
            )
            obj = object_from_bytes(
                object_key=f"noise/{i}", content=VALID_WEBM_BYTES, content_type="audio/webm"
            )
            db.add_all([manifest, obj])
            db.flush()
            db.add(
                PerformanceTake(
                    owner_user_id=2,
                    manifest_id=manifest.id,
                    recording_object_id=obj.id,
                    linked_score_id=1,
                    created_at=now + timedelta(seconds=i % 3),
                )
            )
        db.commit()
    cursor, seen = None, []
    while True:
        with Session(engine) as db:
            page = PerformanceTakeService(
                usage=_resource_wiring.storage_usage_service,
                delivery=resources_for(_storage_provider).build_media_delivery_service(),
            ).list_takes(db, 1, score_id=score_filter, limit=7, cursor=cursor)
            seen.extend(row.take_id for row in page.items)
        if page.next_cursor is None:
            break
        assert page.next_cursor != cursor
        cursor = page.next_cursor
    expected = [
        f"take-{i}" for i in range(50, 0, -1) if score_filter is None or i == 50 or (i - 1) % 5 == 0
    ]
    assert seen == expected
    with Session(engine) as db:
        other = PerformanceTakeService(
            usage=_resource_wiring.storage_usage_service,
            delivery=resources_for(_storage_provider).build_media_delivery_service(),
        ).list_takes(db, 2, score_id=score_filter, limit=100)
        assert len(other.items) == 100
        assert all(row.take_id.startswith("other-") for row in other.items)
        assert other.next_cursor is not None


def test_take_timeline_where_clause_uses_direct_relational_owner(pages):
    from sqlalchemy.sql import visitors
    from app.modules.performance_takes.repository import PerformanceTakeRepository

    engine, _ = pages
    selects = []
    with Session(engine) as db:

        def observe(state):
            if state.is_select:
                selects.append(state.statement)

        event.listen(db, "do_orm_execute", observe)
        PerformanceTakeRepository().list_takes(db, 1, limit=7)
    assert len(selects) == 1
    columns = {
        (node.table.name, node.name)
        for node in visitors.iterate(selects[0].whereclause)
        if getattr(node, "table", None) is not None
    }
    assert ("performance_takes", "owner_user_id") in columns
    assert ("performance_take_manifests", "user_id") not in columns


@pytest.mark.parametrize(
    "failure", [RuntimeError("query unavailable"), ValueError("programming error")]
)
def test_take_detail_propagates_authorization_system_failures(pages, failure):
    from unittest.mock import Mock
    from app.modules.score_access.policy import ScoreAccessPolicy

    engine, _ = pages
    policy = Mock(spec=ScoreAccessPolicy)
    policy.authorize_score.side_effect = failure
    with Session(engine) as db, pytest.raises(type(failure), match=str(failure)):
        PerformanceTakeService(
            score_access_policy=policy,
            usage=_resource_wiring.storage_usage_service,
            delivery=resources_for(_storage_provider).build_media_delivery_service(),
        ).get_take(db, 1, "take-1")


@pytest.mark.parametrize("denial", ["unauthorized", "not_found"])
def test_take_detail_projects_explicit_access_denial(pages, denial):
    from unittest.mock import Mock
    from app.core.exceptions import UnauthorizedException, ResourceNotFoundException
    from app.modules.score_access.policy import ScoreAccessPolicy
    from app.shared.error_codes import CustomerErrorCode

    engine, _ = pages
    policy = Mock(spec=ScoreAccessPolicy)
    policy.authorize_score.side_effect = (
        UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        if denial == "unauthorized"
        else ResourceNotFoundException("score", "score-1", CustomerErrorCode.SCORE_NOT_FOUND)
    )
    with Session(engine) as db:
        result = PerformanceTakeService(
            score_access_policy=policy,
            usage=_resource_wiring.storage_usage_service,
            delivery=resources_for(_storage_provider).build_media_delivery_service(),
        ).get_take(db, 1, "take-1")
        assert result.linked_score_id is None
        assert result.can_open_score is False


def test_take_detail_does_not_convert_driver_failure_to_a_successful_access_projection(pages):
    from sqlalchemy.exc import OperationalError

    engine, _ = pages
    failure = OperationalError("score authorization query", {}, RuntimeError("driver unavailable"))

    def fail_authorization(_conn, _cursor, sql, *_args):
        if "FROM scores" in sql and "scores.score_uuid =" in sql:
            raise failure

    event.listen(engine, "before_cursor_execute", fail_authorization)
    try:
        with Session(engine) as db, pytest.raises(OperationalError) as raised:
            PerformanceTakeService(
                usage=_resource_wiring.storage_usage_service,
                delivery=resources_for(_storage_provider).build_media_delivery_service(),
            ).get_take(db, 1, "take-1")
        assert raised.value is failure
    finally:
        event.remove(engine, "before_cursor_execute", fail_authorization)
