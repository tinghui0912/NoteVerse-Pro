"""Typed lifecycle instants in Customer ImportJob representations."""

from app.modules.import_jobs.requested_options import encode_requested_options

from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.db.models import ImportJob, ImportJobState
from app.main import app
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
        score_id=1,
        **dict.fromkeys(TIME_FIELDS, source),
    )
    repository = Mock(spec=ImportJobRepository)
    repository.score_uuids.return_value = {1: "score"}
    repository.execution_manifest_digests.return_value = {}
    repository.preview_artifacts_for_jobs.return_value = []
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
