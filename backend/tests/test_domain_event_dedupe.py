"""A semantic journal key identifies one complete immutable fact."""

from datetime import timedelta
from typing import ClassVar
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db.models import DomainEvent
from app.modules.domain_events import journal
from app.modules.domain_events.journal import DomainEventDedupeConflict, append_fact
from app.modules.import_jobs.events import ImportJobCompleted, ImportJobFailed
from app.shared.error_codes import ErrorCode
from app.utils.timezone import utc_now_naive


class CompletedV2(ImportJobCompleted):
    schema_version: ClassVar[int] = 2


class OtherEventType(ImportJobCompleted):
    event_type: ClassVar[str] = "import.job.other"

    @property
    def dedupe_key(self) -> str:
        return "import.job.completed:job"


class OtherAggregateType(ImportJobCompleted):
    aggregate_type: ClassVar[str] = "other_aggregate"


class OtherAggregateIdentity(ImportJobCompleted):
    @property
    def aggregate_id(self) -> str:
        return "other_job"


COMPLETED = ImportJobCompleted(job_id="job", recipient_user_id=1, requested_title="Etudes")
FAILED = ImportJobFailed(
    job_id="job", recipient_user_id=1, public_failure_code=ErrorCode.TASK_TIMEOUT
)
CONFLICTS = [
    (COMPLETED, OtherEventType(**COMPLETED.model_dump())),
    (COMPLETED, CompletedV2(**COMPLETED.model_dump())),
    (COMPLETED, OtherAggregateType(**COMPLETED.model_dump())),
    (COMPLETED, OtherAggregateIdentity(**COMPLETED.model_dump())),
    (COMPLETED, COMPLETED.model_copy(update={"recipient_user_id": 2})),
    (COMPLETED, COMPLETED.model_copy(update={"requested_title": "Sonatas"})),
    (FAILED, FAILED.model_copy(update={"public_failure_code": ErrorCode.TASK_ERROR})),
]
CONFLICT_NAMES = [
    "event_type",
    "schema_version",
    "aggregate_type",
    "aggregate_id",
    "recipient",
    "title",
    "failure_code",
]


@pytest.fixture
def database():
    engine = create_engine("sqlite:///:memory:")
    DomainEvent.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as db:
        yield db
    engine.dispose()


@pytest.mark.parametrize("fact", [COMPLETED, FAILED], ids=["completed", "failed"])
def test_identical_fact_returns_first_persisted_identity_and_execution_metadata(database, fact):
    occurred_at = utc_now_naive()
    first = append_fact(database, fact, occurred_at=occurred_at)
    identity = (first.id, first.event_uuid, first.recorded_at, first.occurred_at)
    database.commit()
    duplicate = append_fact(database, fact, occurred_at=occurred_at + timedelta(days=1))
    database.commit()
    assert (
        duplicate.id,
        duplicate.event_uuid,
        duplicate.recorded_at,
        duplicate.occurred_at,
    ) == identity
    assert duplicate.payload == fact.model_dump(mode="json")
    assert database.scalar(select(func.count()).select_from(DomainEvent)) == 1


@pytest.mark.parametrize("persisted,incoming", CONFLICTS, ids=CONFLICT_NAMES)
def test_existing_key_requires_identical_type_version_aggregate_and_canonical_payload(
    database, monkeypatch, persisted, incoming
):
    first = append_fact(database, persisted, occurred_at=utc_now_naive())
    first_id, first_payload = first.id, first.payload.copy()
    database.commit()
    log = Mock()
    monkeypatch.setattr(journal, "logger", log)
    with pytest.raises(DomainEventDedupeConflict) as conflict:
        append_fact(database, incoming, occurred_at=utc_now_naive())
    assert not any(
        value in str(conflict.value)
        for value in [
            "Etudes",
            "Sonatas",
            "task_timeout",
            "task_error",
            "requested_title",
            "recipient_user_id",
        ]
    )
    log.bind.assert_not_called()
    database.rollback()
    row = database.get(DomainEvent, first_id)
    assert row.payload == first_payload
    assert database.scalar(select(func.count()).select_from(DomainEvent)) == 1


def test_canonical_payload_comparison_is_independent_of_json_object_key_order(database):
    payload = COMPLETED.model_dump(mode="json")
    reordered = dict(reversed(list(payload.items())))
    persisted = DomainEvent(
        event_type=COMPLETED.event_type,
        schema_version=1,
        aggregate_type=COMPLETED.aggregate_type,
        aggregate_id=COMPLETED.aggregate_id,
        dedupe_key=COMPLETED.dedupe_key,
        payload=reordered,
        occurred_at=utc_now_naive(),
    )
    database.add(persisted)
    database.commit()
    assert list(persisted.payload) != list(payload)
    assert append_fact(database, COMPLETED, occurred_at=utc_now_naive()).id == persisted.id


@pytest.mark.parametrize("incoming_title,conflicts", [("Etudes", False), ("Sonatas", True)])
def test_equivalence_uses_persisted_facts_instead_of_cached_json_values(
    database, incoming_title, conflicts
):
    persisted = append_fact(database, COMPLETED, occurred_at=utc_now_naive())
    database.commit()
    # Plain JSON in-place changes do not dirty the ORM row or alter the database.
    persisted.payload["requested_title"] = "Sonatas"
    incoming = COMPLETED.model_copy(update={"requested_title": incoming_title})
    if conflicts:
        with pytest.raises(DomainEventDedupeConflict):
            append_fact(database, incoming, occurred_at=utc_now_naive())
    else:
        assert append_fact(database, incoming, occurred_at=utc_now_naive()).id == persisted.id
    assert persisted.payload["requested_title"] == "Etudes"


def test_conflict_reporting_does_not_expand_a_payload_bearing_exception_context(database):
    from traceback import format_exception

    append_fact(database, COMPLETED, occurred_at=utc_now_naive())
    database.commit()
    marker = "private-conflicting-payload"
    try:
        raise ValueError({"requested_title": marker})
    except ValueError:
        with pytest.raises(DomainEventDedupeConflict) as conflict:
            append_fact(
                database,
                COMPLETED.model_copy(update={"requested_title": "Sonatas"}),
                occurred_at=utc_now_naive(),
            )
    assert marker not in "".join(format_exception(conflict.value))
