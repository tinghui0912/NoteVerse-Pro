from tests.support.runtime_resources import resources_for

from app.composition import storage_resources as _resource_wiring
from app.modules.import_jobs.requested_options import encode_requested_options
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.modules.import_jobs.domain import ImportJobState
from app.modules.import_jobs.service import ImportJobService
from app.shared.error_codes import CustomerErrorCode
from pydantic import ValidationError
from tests.support.runtime_resources import storage as _storage_provider


def test_retry_rejects_invalid_persisted_genres_before_submission():
    job = SimpleNamespace(
        id=17,
        job_uuid="job",
        user_id=7,
        state=ImportJobState.FAILED,
        requested_options={"schema_version": 1, "display_title": None, "genres": ["unknown"]},
    )
    service, _ = _service_with_job(job)
    rows = Mock()
    rows.scalars.return_value.all.return_value = ["upload"]
    database = Mock(execute=Mock(return_value=rows))
    service.submission_service = Mock(submit=Mock())
    with pytest.raises(ValidationError):
        service.retry(database, "job", SimpleNamespace(id=7), 7)
    service.submission_service.submit.assert_not_called()


def _service_with_job(job: object | None) -> tuple[ImportJobService, Mock]:
    repository = Mock()
    repository.get_by_uuid = Mock(return_value=job)
    return ImportJobService(
        repository=repository,
        usage=_resource_wiring.storage_usage_service,
        delivery=resources_for(_storage_provider).build_media_delivery_service(),
    ), repository


def test_get_owned_job_allows_only_its_owner() -> None:
    job = SimpleNamespace(job_uuid="job-1", user_id=7)
    service, repository = _service_with_job(job)

    assert service.get_owned_job(Mock(), "job-1", 7) is job
    repository.get_by_uuid.assert_called_once()

    with pytest.raises(UnauthorizedException) as error:
        service.get_owned_job(Mock(), "job-1", 8)

    assert error.value.code == CustomerErrorCode.NO_ACCESS
    assert error.value.details == {"job_id": "job-1"}


def test_get_owned_job_hides_missing_jobs_with_the_stable_not_found_code() -> None:
    service, _repository = _service_with_job(None)

    with pytest.raises(ResourceNotFoundException) as error:
        service.get_owned_job(Mock(), "missing-job", 7)

    assert error.value.code == CustomerErrorCode.JOB_NOT_FOUND
    assert error.value.details == {
        "resource_type": "job",
        "resource_id": "missing-job",
    }


def test_retry_rejects_jobs_that_are_not_failed() -> None:
    job = SimpleNamespace(
        id=17,
        job_uuid="job-1",
        state=ImportJobState.PROCESSING,
        user_id=7,
        requested_options=encode_requested_options(None),
    )
    service, _repository = _service_with_job(job)

    with pytest.raises(ValidationException) as error:
        service.retry(Mock(), "job-1", SimpleNamespace(id=7), 7)

    assert error.value.code == CustomerErrorCode.VALIDATION_ERROR
    assert error.value.details == {"field": "state"}


def test_retry_requires_original_uploads_and_preserves_requested_intent() -> None:
    job = SimpleNamespace(
        id=17,
        job_uuid="job-1",
        state=ImportJobState.FAILED,
        user_id=7,
        requested_options=encode_requested_options(
            {
                "display_title": "Recovered score",
                "genres": ["jazz", "classical", "jazz"],
            }
        ),
    )
    service, _repository = _service_with_job(job)
    database = Mock()
    rows = Mock()
    rows.scalars.return_value.all.return_value = []
    database.execute = Mock(return_value=rows)

    with pytest.raises(ResourceNotFoundException) as error:
        service.retry(database, "job-1", SimpleNamespace(id=7), 7)

    assert error.value.code == CustomerErrorCode.FILE_NOT_FOUND

    rows.scalars.return_value.all.return_value = ["upload-1", "upload-2"]
    submission = Mock()
    submission.submit = Mock(
        return_value={
            "job_id": "retry-job",
            "count": 2,
            "state": ImportJobState.QUEUED,
        }
    )
    service.submission_service = submission
    user = SimpleNamespace(id=7)

    result = service.retry(database, "job-1", user, 7)

    assert result["job_id"] == "retry-job"
    submitted_db, submitted_user, retry_request = submission.submit.call_args.args
    assert submitted_db is database
    assert submitted_user is user
    assert retry_request.upload_ids == ["upload-1", "upload-2"]
    assert retry_request.options == {
        "display_title": "Recovered score",
        "genres": ["classical", "jazz"],
    }
    assert retry_request.idempotency_key is None


@pytest.mark.parametrize("state", list(ImportJobState))
def test_delete_delegates_owned_jobs_to_locked_deletion_admission(state) -> None:
    job = SimpleNamespace(
        id=17,
        job_uuid="job-1",
        state=state,
        user_id=7,
    )
    repository = Mock()
    repository.get_by_uuid = Mock(return_value=job)
    deletion_service = Mock()
    deletion_service.delete_job = Mock()
    service = ImportJobService(
        repository=repository,
        deletion_service=deletion_service,
        usage=_resource_wiring.storage_usage_service,
        delivery=resources_for(_storage_provider).build_media_delivery_service(),
    )
    database = Mock(commit=Mock())

    service.delete(database, "job-1", 7)

    deletion_service.delete_job.assert_called_once_with(database, job, 7)
