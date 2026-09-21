from __future__ import annotations

import pytest

from app.db.models import Score, ScoreRevision, ScoreRevisionSource, User
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from scripts import seed_integration_user


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
    backend_name = "s3"

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
        content_hash="existing-content-hash",
        origin=RevisionOrigin.IMPORT,
        created_by_user_id=user.id,
    )
    source = ScoreRevisionSource(
        id=401,
        source_uuid="integration-practice-source",
        revision_id=revision.id,
        format=RevisionSourceFormat.MUSICXML,
        storage_backend="s3",
        storage_key="scores/existing/score.musicxml",
        filename="score.musicxml",
        mime_type="application/vnd.recordare.musicxml+xml",
        size_bytes=123,
        sha256="existing-sha256",
        generator="integration-fixture",
        generator_version="1",
    )
    session = _FakeSeedSession([user, score, revision, source])

    monkeypatch.setattr(seed_integration_user, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(seed_integration_user, "file_storage", _FailingStorage())

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
