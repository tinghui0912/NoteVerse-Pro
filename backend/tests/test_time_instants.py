"""Aware UTC instants across clock, API, PostgreSQL storage and nested output."""

from app.modules.import_jobs.requested_options import encode_requested_options

from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import TypeAdapter, ValidationError
from pydantic_core import PydanticSerializationError
from sqlalchemy import DateTime, inspect, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel
from alembic import command
from app.db.models import (
    User,
    RefreshToken,
    ImportJob,
    ImportJobState,
    ImportDispatch,
    ScoreInvite,
    Score,
    MembershipRole,
)
from app.shared.time import Instant, utc_now, require_utc
from app.shared.api_model import ApiModel
from app.shared.pagination import OffsetPage
from tests.support.postgres_schema import postgres_schema_database


def test_clock_and_normalization_produce_aware_utc_instants():
    now = utc_now()
    assert now.tzinfo is UTC and now.utcoffset() == timedelta(0)
    source = datetime(2026, 11, 15, 18, tzinfo=timezone(timedelta(hours=8)))
    assert require_utc(source) == datetime(2026, 11, 15, 10, tzinfo=UTC)
    assert require_utc(source).tzinfo is UTC
    with pytest.raises(ValueError):
        require_utc(datetime(2026, 11, 15, 10))


@pytest.mark.parametrize("value", ["2026-11-15T10:00:00Z", "2026-11-15T18:00:00+08:00"])
def test_http_instants_normalize_explicit_offsets(value):
    instant = TypeAdapter(Instant).validate_python(value)
    assert instant == datetime(2026, 11, 15, 10, tzinfo=UTC)
    assert instant.tzinfo is UTC
    assert TypeAdapter(Instant).json_schema()["format"] == "date-time"


def test_http_instants_require_timezone_evidence():
    with pytest.raises(ValidationError):
        TypeAdapter(Instant).validate_python("2026-11-15T10:00:00")


def test_all_persisted_datetimes_are_timezone_aware_instants():
    columns = [
        c
        for table in SQLModel.metadata.tables.values()
        for c in table.columns
        if isinstance(c.type, DateTime)
    ]
    assert columns
    assert all(c.type.timezone for c in columns)


def test_fresh_postgresql_instants_use_timestamptz_and_round_trip(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        schema = inspect(engine)
        instants = [
            (table.name, column.name)
            for table in SQLModel.metadata.tables.values()
            for column in table.columns
            if isinstance(column.type, DateTime)
        ]
        for table, column in instants:
            actual = next(c for c in schema.get_columns(table) if c["name"] == column)
            assert isinstance(actual["type"], DateTime) and actual["type"].timezone
        source = datetime(2026, 11, 15, 18, tzinfo=timezone(timedelta(hours=8)))
        with Session(engine) as db:
            assert db.scalar(text("SHOW timezone")) == "UTC"
            db.add(User(id=1, email="instant@example.test", password_hash="hash"))
            db.flush()
            job = ImportJob(
                requested_options=encode_requested_options(None),
                job_uuid="instant-job",
                user_id=1,
                state=ImportJobState.PROCESSING,
                processing_started_at=source,
            )
            score = Score(score_uuid="instant-score", owner_user_id=1, display_title="Instant")
            db.add_all([job, score])
            db.flush()
            dispatch = ImportDispatch(job_id=job.id, next_attempt_at=source)
            auth = RefreshToken(user_id=1, token_hash="hash", expires_at=source)
            invite = ScoreInvite(
                invite_uuid="instant-invite",
                score_id=score.id,
                token_hash="invite",
                email="invite@example.test",
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
                expires_at=source,
            )
            db.add_all([dispatch, auth, invite])
            db.commit()
            db.expire_all()
            for value in (
                auth.expires_at,
                dispatch.next_attempt_at,
                job.processing_started_at,
                invite.expires_at,
            ):
                assert (
                    value.tzinfo is not None
                    and value.utcoffset() == timedelta(0)
                    and value == source
                )
            job.processing_finished_at = datetime(2026, 11, 15, 10)
            with pytest.raises(ValueError):
                db.flush()
            db.rollback()


def test_nested_api_output_is_utc_and_preserves_the_instant():
    class Read(ApiModel):
        created_at: Instant

    source = datetime(2026, 11, 15, 18, tzinfo=timezone(timedelta(hours=8)))
    page = OffsetPage[Read](items=[Read(created_at=source)], limit=1, offset=0, has_more=False)
    value = datetime.fromisoformat(page.model_dump(mode="json")["items"][0]["created_at"])
    assert value.utcoffset() == timedelta(0) and value == source


def test_representation_serialization_rejects_timezone_free_programming_values():
    class Read(ApiModel):
        value: datetime

    with pytest.raises(PydanticSerializationError, match="explicit timezone"):
        Read(value=datetime(2026, 11, 15)).model_dump(mode="json")


@pytest.mark.parametrize(
    "value,accepted",
    [
        ("2026-11-15T10:00:00Z", True),
        ("2026-11-15T18:00:00+08:00", True),
        ("2026-11-15T10:00:00", False),
    ],
)
def test_invitation_expiry_is_an_explicit_instant(value, accepted):
    from app.modules.collaboration.schemas import InviteCreateRequest

    if accepted:
        request = InviteCreateRequest(email="invite@example.com", expires_at=value)
        assert request.expires_at == datetime(2026, 11, 15, 10, tzinfo=UTC)
        assert request.expires_at.tzinfo is UTC
    else:
        with pytest.raises(ValidationError):
            InviteCreateRequest(email="invite@example.com", expires_at=value)
