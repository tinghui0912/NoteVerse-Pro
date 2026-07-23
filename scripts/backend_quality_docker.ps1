param(
    [ValidateSet("all", "ruff", "mypy", "mypy-model-layer", "pytest", "compile")]
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

function Invoke-PracticeQuality {
    param([string] $Name, [string] $Command)

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
    "all" {
        Invoke-Quality "compile" "python -m compileall -q app scripts tests"
        Invoke-Quality "ruff" "python -m ruff check app tests scripts"
        Invoke-Quality "mypy" "python -m mypy --config-file pyproject.toml"
        Invoke-Quality "mypy-model-layer" "python -m mypy --config-file mypy-model-layer.ini"
        Invoke-Quality "pytest-core" "python -m pytest tests -q $practiceTestIgnoreArgs"
        Invoke-PracticeQuality "pytest-practice" "python -m pytest $practiceTestArgs -q"
    }
}
