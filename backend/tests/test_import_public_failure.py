"""Import product errors project canonical domain causes, never diagnostics."""

from types import SimpleNamespace

import pytest

from app.modules.import_jobs.public_errors import public_import_job_error_code


@pytest.mark.parametrize(
    "code,stage,public",
    [
        ("import_pipeline_timeout", "pipeline", "task_timeout"),
        ("import_inputs_unavailable", "pipeline", "input_file_missing"),
        ("import_pipeline_rejected", "pipeline", "score_recognition_failed"),
        ("import_pipeline_failed", "pipeline", "task_error"),
        ("import_dispatch_attempts_exhausted", "dispatch", "feature_temporarily_unavailable"),
        ("import_inputs_unavailable", "dispatch", "feature_temporarily_unavailable"),
        ("unclassified_failure", "pipeline", None),
        ("import_dispatch_lease_expired", "dispatch", None),
        ("import_pipeline_timeout", "unclassified_stage", None),
        (None, None, None),
    ],
)
def test_import_product_failure_projection_uses_code_and_stage(code, stage, public):
    job = SimpleNamespace(
        failure_code=code,
        failure_stage=stage,
        failure_detail="timeout task_error private provider body /internal/path",
    )
    assert public_import_job_error_code(job) == public
