param(
    [ValidateSet("ruff", "mypy", "mypy-model-layer", "pytest")]
    [string] $Check = "ruff"
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $RepoRoot "docker-compose.backend-dev.yml"

function Invoke-DockerBackend {
    docker compose -f $ComposeFile run --rm api @args
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

switch ($Check) {
    "ruff" {
        Invoke-DockerBackend python -m ruff check app tests --config pyproject.toml --cache-dir .ruff_cache
    }
    "mypy" {
        Invoke-DockerBackend python -m mypy --config-file pyproject.toml
    }
    "mypy-model-layer" {
        Invoke-DockerBackend python -m mypy --config-file mypy-model-layer.ini
    }
    "pytest" {
        Invoke-DockerBackend python -m pytest tests -q
    }
}
