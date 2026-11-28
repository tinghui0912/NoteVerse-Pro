"""Typed lifecycle instants in Customer ImportJob representations."""

from app.modules.import_jobs.requested_options import encode_requested_options

from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.db.models import ImportJob
from app.modules.import_jobs.domain import ImportJobState
from app.runtime.customer_api.main import app
from app.modules.import_jobs.read_model import ImportJobReadModel
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.import_jobs.schemas import ImportJobRead


TIME_FIELDS = (
    "created_at",
    "updated_at",
    "processing_started_at",
    "processing_finished_at",
    "confirmed_at",
)


def test_read_model_preserves_lifecycle_instants_and_emits_utc():
    source = datetime(2026, 11, 15, 18, tzinfo=timezone(timedelta(hours=8)))
    job = ImportJob(
        requested_options=encode_requested_options(None),
        id=1,
        job_uuid="job",
        user_id=1,
        state=ImportJobState.CONFIRMED,
        **dict.fromkeys(TIME_FIELDS, source),
    )
    repository = Mock(spec=ImportJobRepository)
    repository.live_scores_for_import_jobs.return_value = {1: Mock(score_uuid="score")}
    repository.execution_manifest_digests.return_value = {}
    repository.uploads_for_jobs.return_value = []

    representation = ImportJobReadModel(repository).detail(Mock(), job)
    body = representation.model_dump(mode="json")
    for field in TIME_FIELDS:
        internal = getattr(representation, field)
        assert isinstance(internal, datetime)
        assert internal == source and internal.utcoffset() == timedelta(0)
        wire = datetime.fromisoformat(body[field])
        assert wire == source and wire.utcoffset() == timedelta(0)


@pytest.mark.parametrize("field", TIME_FIELDS)
def test_lifecycle_representation_requires_aware_instants(field):
    values = dict.fromkeys(TIME_FIELDS, datetime(2026, 11, 15, 10, tzinfo=UTC))
    values[field] = datetime(2026, 11, 15, 10)
    with pytest.raises(ValidationError):
        ImportJobRead(job_id="job", state=ImportJobState.PROCESSING, progress=0, **values)


def test_creation_instants_are_required_and_execution_instants_are_nullable():
    values = dict(job_id="job", state=ImportJobState.QUEUED, progress=0)
    with pytest.raises(ValidationError):
        ImportJobRead(**values)
    representation = ImportJobRead(
        **values,
        created_at=datetime(2026, 11, 15, tzinfo=UTC),
        updated_at=datetime(2026, 11, 15, tzinfo=UTC),
    )
    assert (
        representation.processing_started_at is None
        and representation.processing_finished_at is None
    )


def test_import_lifecycle_openapi_fields_are_date_time_instants():
    schema = app.openapi()["components"]["schemas"]["ImportJobRead"]
    for field in TIME_FIELDS:
        value = schema["properties"][field]
        if field in ("created_at", "updated_at"):
            assert field in schema["required"]
            assert value["type"] == "string" and value["format"] == "date-time"
        else:
            assert field not in schema["required"]
            assert {"type": "string", "format": "date-time"} in value["anyOf"]
            assert {"type": "null"} in value["anyOf"]


def test_live_navigation_projects_only_confirmed_job_identities_in_one_bulk_query():
    from app.db.models import Score

    jobs = [
        ImportJob(
            id=i,
            job_uuid=f"job-{i}",
            user_id=1,
            state=state,
            requested_options=encode_requested_options(None),
        )
        for i, state in enumerate(
            [ImportJobState.QUEUED, ImportJobState.CONFIRMED, ImportJobState.FAILED], 1
        )
    ]
    repository = Mock(spec=ImportJobRepository)
    repository.live_scores_for_import_jobs.return_value = {
        2: Score(
            score_uuid="live-score",
            owner_user_id=1,
            display_title="Score",
            created_from_import_job_id=2,
        )
    }
    db = Mock()
    assert ImportJobReadModel(repository).live_score_ids(db, jobs) == {2: "live-score"}
    repository.live_scores_for_import_jobs.assert_called_once_with(db, {2})


def test_import_history_and_score_creation_have_one_direction_of_relational_ownership():
    from app.db.models import Score, ScoreRevision
    from sqlalchemy import UniqueConstraint

    assert {fk.target_fullname for fk in ImportJob.__table__.foreign_keys} == {
        "users.id",
        "execution_manifests.id",
    }
    provenance = Score.__table__.c.created_from_import_job_id
    assert provenance.nullable
    (fk,) = provenance.foreign_keys
    assert fk.target_fullname == "import_jobs.id" and fk.ondelete == "RESTRICT"
    assert any(
        isinstance(constraint, UniqueConstraint) and list(constraint.columns) == [provenance]
        for constraint in Score.__table__.constraints
    )
    assert {fk.target_fullname for fk in ScoreRevision.__table__.foreign_keys} == {
        "scores.id",
        "users.id",
    }
