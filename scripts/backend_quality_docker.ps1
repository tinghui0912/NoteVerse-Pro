param(
    [ValidateSet("all", "ruff", "mypy", "mypy-model-layer", "pytest", "coverage", "critical-coverage", "critical-import-execution-coverage", "critical-import-job-service-coverage", "critical-import-worker-service-coverage", "compile", "contracts")]
    [string] $Check = "all"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot "docker-compose.backend-dev.yml"

function Invoke-Quality {
    param([string] $Name, [string] $Command)

    Write-Host "==> backend:$Name"
    docker compose -f $composeFile run --rm --build quality bash -lc $Command
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

switch ($Check) {
    "contracts" {
        Invoke-Quality "openapi-customer" "python scripts/export_openapi.py customer-api --check"
        Invoke-Quality "openapi-control-plane" "python scripts/export_openapi.py control-plane-api --check"
    }
    "compile" {
        Invoke-Quality "compile" "python -m compileall -q app scripts tests"
    }
    "ruff" {
        Invoke-Quality "ruff" "python -m ruff check app tests scripts"
    }
    "mypy" {
        Invoke-Quality "mypy" "python -m mypy --config-file pyproject.toml"
    }
    "mypy-model-layer" {
        Invoke-Quality "mypy-model-layer" "python -m mypy --config-file mypy-model-layer.ini"
    }
    "pytest" {
        Invoke-Quality "pytest" "python -m pytest tests -q"
    }
    "coverage" {
        Invoke-Quality "coverage" "python -m pytest tests -q --cov=app --cov-report=term-missing"
    }
    "critical-coverage" {
        Invoke-Quality "critical-score-access-coverage" "python -m pytest tests/test_score_revision_services.py -q --cov=app.modules.score_access --cov-report=term-missing --cov-fail-under=80"
    }
    "critical-import-execution-coverage" {
        Invoke-Quality "critical-import-execution-coverage" "python -m pytest tests/test_import_job_execution_service.py tests/test_import_job_reliability_contract.py -q --cov=app.modules.import_jobs.execution_service --cov-report=term-missing --cov-fail-under=80"
    }
    "critical-import-job-service-coverage" {
        Invoke-Quality "critical-import-job-service-coverage" "python -m pytest tests/test_import_job_service_access.py tests/test_import_job_execution_service.py tests/test_import_job_reliability_contract.py tests/test_score_revision_services.py tests/test_storage_usage.py -q --cov=app.modules.import_jobs.service --cov-report=term-missing --cov-fail-under=70"
    }
    "critical-import-worker-service-coverage" {
        Invoke-Quality "critical-import-worker-service-coverage" "python -m pytest tests/test_import_job_worker_service_state.py tests/test_score_revision_services.py -q --cov=app.modules.import_jobs.worker_service --cov-report=term-missing --cov-fail-under=80"
    }
    "all" {
        Invoke-Quality "compile" "python -m compileall -q app scripts tests"
        Invoke-Quality "ruff" "python -m ruff check app tests scripts"
        Invoke-Quality "mypy" "python -m mypy --config-file pyproject.toml"
        Invoke-Quality "mypy-model-layer" "python -m mypy --config-file mypy-model-layer.ini"
        Invoke-Quality "openapi-customer" "python scripts/export_openapi.py customer-api --check"
        Invoke-Quality "openapi-control-plane" "python scripts/export_openapi.py control-plane-api --check"
        Invoke-Quality "pytest" "python -m pytest tests -q"
    }
}
