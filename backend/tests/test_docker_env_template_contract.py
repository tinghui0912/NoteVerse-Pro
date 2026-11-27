"""Each Docker process receives only its own settings and database identity."""

from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from app.runtime.deployment import DEPLOYMENTS

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("runtime", [name for name in DEPLOYMENTS if name != "paddle_ocr"])
def test_docker_environment_matches_its_runtime(runtime):
    contract = DEPLOYMENTS[runtime]
    template = BACKEND_ROOT / (".env.docker." + runtime.replace("_", "-") + ".example")
    assignments = dict(
        line.split("=", 1)
        for line in template.read_text().splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    assert set(assignments) <= set(contract.settings.model_fields)
    assert set(contract.secret_keys) <= set(assignments)
    if contract.database_role:
        assert make_url(assignments["DATABASE_URL"]).username == contract.database_role
        if "SCHEDULER_LOCK_DATABASE_URL" in assignments:
            assert (
                make_url(assignments["SCHEDULER_LOCK_DATABASE_URL"]).username
                == contract.database_role
            )
    if runtime == "migrator":
        assert set(assignments) == {"DATABASE_URL"}
