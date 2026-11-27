param(
    [ValidateSet("all", "ruff", "mypy", "mypy-model-layer", "pytest", "coverage", "critical-coverage", "critical-import-execution-coverage", "critical-import-job-service-coverage", "critical-import-worker-service-coverage", "compile", "contracts")]
    [string] $Check = "all"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot "docker-compose.backend-quality.yml"

function Invoke-Quality {
    param([string] $Name, [string] $Command)

    Write-Host "==> backend:$Name"
    if ($Command.StartsWith("python -m pytest ", [System.StringComparison]::Ordinal)) {
        $Command = "python -m alembic upgrade head && $Command"
    }
    docker compose -f $composeFile run --rm --build quality bash -c $Command
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

switch ($Check) {
    "contracts" {
        Invoke-Quality "browser-protocol" "python /repo/scripts/generate_customer_browser_protocol.py --target backend --check"
        Invoke-Quality "control-plane-browser-protocol" "python /repo/scripts/generate_control_plane_browser_protocol.py --check"
        Invoke-Quality "realtime-contract" "python /repo/scripts/generate_realtime_contract.py --check"
        Invoke-Quality "runtime-deployment-contract" "python scripts/export_runtime_contract.py --check"
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
        Invoke-Quality "critical-import-execution-coverage" "python -m pytest tests/test_import_pipeline_runner.py tests/test_import_job_reliability_contract.py -q --cov=app.modules.import_jobs.pipeline_runner --cov-report=term-missing --cov-fail-under=80"
    }
    "critical-import-job-service-coverage" {
        Invoke-Quality "critical-import-job-service-coverage" "python -m pytest tests/test_import_job_service_access.py tests/test_import_pipeline_runner.py tests/test_import_job_reliability_contract.py tests/test_import_job_application_postgres.py tests/test_import_lifecycle_postgres.py tests/test_score_revision_services.py tests/test_storage_usage.py -q --cov=app.modules.import_jobs.service --cov-report=term-missing --cov-fail-under=70"
    }
    "critical-import-worker-service-coverage" {
        Invoke-Quality "critical-import-worker-service-coverage" "python -m pytest tests/test_import_execution_recorder.py tests/test_import_dispatch.py tests/test_import_lifecycle_postgres.py tests/test_score_revision_services.py -q --cov=app.modules.import_jobs.execution_recorder --cov-report=term-missing --cov-fail-under=80"
    }
    "all" {
        Invoke-Quality "browser-protocol" "python /repo/scripts/generate_customer_browser_protocol.py --target backend --check"
        Invoke-Quality "control-plane-browser-protocol" "python /repo/scripts/generate_control_plane_browser_protocol.py --check"
        Invoke-Quality "realtime-contract" "python /repo/scripts/generate_realtime_contract.py --check"
        Invoke-Quality "compile" "python -m compileall -q app scripts tests"
        Invoke-Quality "ruff" "python -m ruff check app tests scripts"
        Invoke-Quality "mypy" "python -m mypy --config-file pyproject.toml"
        Invoke-Quality "mypy-model-layer" "python -m mypy --config-file mypy-model-layer.ini"
        Invoke-Quality "runtime-deployment-contract" "python scripts/export_runtime_contract.py --check"
        Invoke-Quality "openapi-customer" "python scripts/export_openapi.py customer-api --check"
        Invoke-Quality "openapi-control-plane" "python scripts/export_openapi.py control-plane-api --check"
        Invoke-Quality "pytest" "python -m pytest tests -q"
    }
}
