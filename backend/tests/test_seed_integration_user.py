from __future__ import annotations
from app.db.models import StoredObject

import pytest

from app.db.models import Score, ScoreRevision, ScoreRevisionSource, User
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from scripts import seed_integration_user
from tests.test_stored_object_retirement_postgres import retirement_postgres as retirement_postgres

pytest_plugins = ["tests.test_practice_bundle_postgres"]


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "put_failure", "writer_failure"])
async def test_seed_source_reservation_and_revision_have_explicit_durable_boundaries(
    retirement_postgres, monkeypatch, outcome
):
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession
    from app.db.models import StorageQuotaPolicy, StorageUsageAccount, StorageUsageReservation
    from app.storage import AsyncObjectStorage

    engine, sync, _, storage = retirement_postgres
    with Session(sync) as db:
        db.add(StorageQuotaPolicy(plan_code="FREE", quota_limit_bytes=10000))
        db.commit()
    monkeypatch.setattr(
        seed_integration_user,
        "AsyncSessionLocal",
        async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False),
    )
    monkeypatch.setattr(seed_integration_user, "object_storage", storage)
    monkeypatch.setattr(seed_integration_user, "async_object_storage", AsyncObjectStorage(storage))
    monkeypatch.setenv(
        seed_integration_user.INTEGRATION_PASSWORD_ENV, "explicit-integration-password"
    )
    size = len(
        seed_integration_user.admit_musicxml_document(seed_integration_user.INTEGRATION_MUSICXML)
    )
    put = storage.put_bytes
    observations = []

    def physical_put(**kwargs):
        with Session(sync) as observer:
            account = observer.scalar(select(StorageUsageAccount).with_for_update(nowait=True))
            assert account.reserved_bytes == size and account.used_bytes == 0
            observations.append(account.user_id)
        result = put(**kwargs)
        if outcome == "put_failure":
            raise RuntimeError("seed provider acknowledgement unavailable")
        return result

    monkeypatch.setattr(storage, "put_bytes", physical_put)
    write = seed_integration_user.revision_writer.write

    def reject_admission(*args, **kwargs):
        write(*args, **kwargs)
        raise RuntimeError("seed admission unavailable")

    if outcome == "writer_failure":
        monkeypatch.setattr(seed_integration_user.revision_writer, "write", reject_admission)
    if outcome == "success":
        await seed_integration_user.seed_user()
    else:
        with pytest.raises(RuntimeError, match="seed"):
            await seed_integration_user.seed_user()
    assert len(observations) == 1
    with Session(sync) as observer:
        account = observer.scalar(select(StorageUsageAccount))
        hold = observer.scalar(select(StorageUsageReservation))
        score = observer.scalar(
            select(Score).where(
                Score.score_uuid == seed_integration_user.INTEGRATION_PRACTICE_SCORE_ID
            )
        )
        assert account.reserved_bytes == 0
        assert account.used_bytes == (size if outcome == "success" else 0)
        assert hold.status.value == ("COMMITTED" if outcome == "success" else "RELEASED")
        assert (score is not None) == (outcome == "success")
        if score is not None:
            revision = observer.get(ScoreRevision, score.head_revision_id)
            assert revision.revision_uuid == seed_integration_user.INTEGRATION_PRACTICE_REVISION_ID


class _Result:
    def __init__(self, value: object | None) -> None:
        self.value = value

    def one_or_none(self) -> object | None:
        return self.value


class _FakeSeedSession:
    def __init__(self, values: list[object | None]) -> None:
        self._values = values
        self.added: list[object] = []
        self.committed = False

    async def __aenter__(self) -> "_FakeSeedSession":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def exec(self, _statement: object) -> _Result:
        return _Result(self._values.pop(0))

    def add(self, value: object) -> None:
        self.added.append(value)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.committed = True


class _FailingStorage:
    def exists(self, _key: str) -> bool:
        return False

    def put_bytes(self, **_kwargs: object) -> object:
        raise AssertionError("seed must not overwrite existing score resources")


@pytest.mark.anyio
async def test_seed_existing_integration_user_is_read_only(monkeypatch: pytest.MonkeyPatch):
    user = User(
        id=101,
        email=seed_integration_user.INTEGRATION_EMAIL,
        display_name="Existing Integration User",
        password_hash="existing-password-hash",
        is_active=True,
    )
    score = Score(
        id=201,
        score_uuid=seed_integration_user.INTEGRATION_PRACTICE_SCORE_ID,
        owner_user_id=user.id,
        title="Existing Integration Score",
    )
    revision = ScoreRevision(
        id=301,
        revision_uuid=seed_integration_user.INTEGRATION_PRACTICE_REVISION_ID,
        score_id=score.id,
        revision_number=1,
        content_hash="6055090ea4efcc8dba0e5ce4fb7b1a84f25dd4f4de76f335958feb2104395e57",
        origin=RevisionOrigin.IMPORT,
        created_by_user_id=user.id,
    )
    source = ScoreRevisionSource(
        id=401,
        source_uuid="integration-practice-bundle",
        revision_id=revision.id,
        format=RevisionSourceFormat.MUSICXML,
        stored_object=StoredObject(
            object_key="scores/existing/score.musicxml",
            content_type="application/vnd.recordare.musicxml+xml",
            byte_size=123,
            sha256="7cf4e50990e5b99062a6743169e143abca1db3033b715d0827e0a7026bba8a37",
        ),
        filename="score.musicxml",
        generator="integration-fixture",
        generator_version="1",
    )
    session = _FakeSeedSession([user, score, revision, source])

    monkeypatch.setattr(seed_integration_user, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(seed_integration_user, "object_storage", _FailingStorage())

    await seed_integration_user.seed_user()

    assert user.password_hash == "existing-password-hash"
    assert user.is_active is True
    assert session.added == []
    assert session.committed is True


@pytest.mark.anyio
async def test_seed_existing_integration_user_inactive_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
):
    user = User(
        id=101,
        email=seed_integration_user.INTEGRATION_EMAIL,
        display_name="Existing Integration User",
        password_hash="existing-password-hash",
        is_active=False,
    )
    session = _FakeSeedSession([user])

    monkeypatch.setattr(seed_integration_user, "AsyncSessionLocal", lambda: session)

    with pytest.raises(RuntimeError, match="inactive"):
        await seed_integration_user.seed_user()

    assert user.password_hash == "existing-password-hash"
    assert user.is_active is False
    assert session.added == []
    assert session.committed is False


@pytest.mark.anyio
async def test_seed_new_integration_user_requires_explicit_password(
    monkeypatch: pytest.MonkeyPatch,
):
    session = _FakeSeedSession([None])

    monkeypatch.setattr(seed_integration_user, "AsyncSessionLocal", lambda: session)
    monkeypatch.delenv(seed_integration_user.INTEGRATION_PASSWORD_ENV, raising=False)

    with pytest.raises(RuntimeError, match=seed_integration_user.INTEGRATION_PASSWORD_ENV):
        await seed_integration_user.seed_user()

    assert session.added == []
    assert session.committed is False


@pytest.mark.anyio
async def test_seed_new_integration_score_refuses_existing_storage_key(
    monkeypatch: pytest.MonkeyPatch,
):
    session = _FakeSeedSession([None, None])

    class ExistingObjectStorage:
        def exists(self, _key: str) -> bool:
            return True

        def put_bytes(self, **_kwargs: object) -> object:
            raise AssertionError("seed must not overwrite existing storage object")

    monkeypatch.setattr(seed_integration_user, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(seed_integration_user, "object_storage", ExistingObjectStorage())
    monkeypatch.setenv(seed_integration_user.INTEGRATION_PASSWORD_ENV, "explicit-dev-password")

    with pytest.raises(RuntimeError, match="already exists"):
        await seed_integration_user.seed_user()

    assert session.committed is False
