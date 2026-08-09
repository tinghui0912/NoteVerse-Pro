param(
    [ValidateSet("all", "ruff", "mypy", "mypy-model-layer", "pytest", "coverage", "critical-coverage", "compile", "contracts")]
    [string] $Check = "all"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot "docker-compose.backend-dev.yml"
$practiceDepsBuilt = $false

function Invoke-Quality {
    param([string] $Name, [string] $Command)

    Write-Host "==> backend:$Name"
    docker compose -f $composeFile run --rm --build quality bash -lc $Command
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

function Invoke-PracticeQuality {
    param([string] $Name, [string] $Command)

    if (-not $script:practiceDepsBuilt) {
        Write-Host "==> backend:practice-deps"
        docker compose -f $composeFile build practice-deps
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
        $script:practiceDepsBuilt = $true
    }

    Write-Host "==> backend:$Name"
    docker compose -f $composeFile run --rm --build practice-quality bash -lc $Command
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$practiceTestFiles = @(
    "tests/test_practice_api_smoke.py",
    "tests/test_practice_audio_replay_evaluation.py",
    "tests/test_practice_runtime_regressions.py",
    "tests/test_practice_websocket_flow.py"
)

$practiceTestIgnoreArgs = ($practiceTestFiles | ForEach-Object { "--ignore=$_" }) -join " "
$practiceTestArgs = $practiceTestFiles -join " "

switch ($Check) {
    "contracts" {
        Invoke-Quality "openapi-customer" "python scripts/export_openapi.py customer-api --check"
        Invoke-Quality "openapi-control-plane" "python scripts/export_openapi.py control-plane-api --check"
        Invoke-PracticeQuality "openapi-practice" "python scripts/export_openapi.py practice-api --check"
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
        Invoke-Quality "pytest-core" "python -m pytest tests -q $practiceTestIgnoreArgs"
        Invoke-PracticeQuality "pytest-practice" "python -m pytest $practiceTestArgs -q"
    }
    "coverage" {
        Invoke-Quality "coverage-core" "python -m pytest tests -q $practiceTestIgnoreArgs --cov=app --cov-report=term-missing"
        Invoke-PracticeQuality "coverage-practice" "python -m pytest $practiceTestArgs -q --cov=app --cov-report=term-missing"
    }
    "critical-coverage" {
        Invoke-Quality "critical-score-access-coverage" "python -m pytest tests/test_score_revision_services.py -q --cov=app.modules.score_access --cov-report=term-missing --cov-fail-under=80"
    }
    "all" {
        Invoke-Quality "compile" "python -m compileall -q app scripts tests"
        Invoke-Quality "ruff" "python -m ruff check app tests scripts"
        Invoke-Quality "mypy" "python -m mypy --config-file pyproject.toml"
        Invoke-Quality "mypy-model-layer" "python -m mypy --config-file mypy-model-layer.ini"
        Invoke-Quality "openapi-customer" "python scripts/export_openapi.py customer-api --check"
        Invoke-Quality "openapi-control-plane" "python scripts/export_openapi.py control-plane-api --check"
        Invoke-Quality "pytest-core" "python -m pytest tests -q $practiceTestIgnoreArgs"
        Invoke-PracticeQuality "openapi-practice" "python scripts/export_openapi.py practice-api --check"
        Invoke-PracticeQuality "pytest-practice" "python -m pytest $practiceTestArgs -q"
    }
}
