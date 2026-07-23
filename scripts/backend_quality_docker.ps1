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
        Invoke-Quality "pytest" "python -m pytest tests -q"
    }
    "all" {
        Invoke-Quality "compile" "python -m compileall -q app scripts tests"
        Invoke-Quality "ruff" "python -m ruff check app tests scripts"
        Invoke-Quality "mypy" "python -m mypy --config-file pyproject.toml"
        Invoke-Quality "mypy-model-layer" "python -m mypy --config-file mypy-model-layer.ini"
        Invoke-Quality "pytest" "python -m pytest tests -q"
    }
}
