param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:NOTEVERSE_INTEGRATION_RUN_ID) { $env:NOTEVERSE_INTEGRATION_RUN_ID = [guid]::NewGuid().ToString("N") }
$env:NOTEVERSE_INTEGRATION_RUN_ID = [guid]::Parse($env:NOTEVERSE_INTEGRATION_RUN_ID).ToString("N")
$projectName = "noteverse-integration-$env:NOTEVERSE_INTEGRATION_RUN_ID"
$composeArgs = @("compose", "--project-name", $projectName, "--project-directory", $repoRoot, "-f", (Join-Path $repoRoot "docker-compose.integration.yml"))
if (-not $env:NOTEVERSE_INTEGRATION_PASSWORD) { $env:NOTEVERSE_INTEGRATION_PASSWORD = [guid]::NewGuid().ToString("N") + "Aa1!" }
foreach ($role in @("MIGRATOR", "CUSTOMER_API", "CONTROL_PLANE", "WORKER", "BEAT", "OBSERVABILITY")) {
    [Environment]::SetEnvironmentVariable("NV_$($role)_PASSWORD", [guid]::NewGuid().ToString("N"), "Process")
}
$started = $false
$existingContainers = & docker @composeArgs ps --all --quiet
if ($LASTEXITCODE -ne 0) { throw "Cannot inspect the integration project." }
if ($existingContainers) { throw "Integration containers already exist; preserve them and resolve their cleanup first." }
$existingVolumes = & docker volume ls --filter "label=com.docker.compose.project=$projectName" --quiet
if ($LASTEXITCODE -ne 0) { throw "Cannot inspect integration volumes." }
if ($existingVolumes) { throw "Integration volumes already exist; preserve them and resolve their cleanup first." }
Write-Host "Integration run identity: $env:NOTEVERSE_INTEGRATION_RUN_ID"

function Invoke-Compose([string[]] $Arguments) {
    & docker @composeArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($Arguments -join ' ')"
    }
}

try {
    Invoke-Compose @("build", "migrate", "customer-web")
    Invoke-Compose @("up", "-d", "postgres", "redis")
    $started = $true
    Invoke-Compose @("up", "-d", "migrate", "seed", "api", "customer-web")
    $deadline = (Get-Date).AddMinutes(3)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/en/auth/login" -TimeoutSec 5
            if ($response.StatusCode -eq 200) { break }
        } catch {
            Start-Sleep -Seconds 2
        }
    } while ((Get-Date) -lt $deadline)
    if (-not $response -or $response.StatusCode -ne 200) {
        throw "Customer Web integration environment did not become ready."
    }

    Push-Location (Join-Path $repoRoot "apps/customer-web")
    try {
        $env:INTEGRATION_BASE_URL = "http://localhost:3000"
        npm.cmd run test:e2e:integration
        if ($LASTEXITCODE -ne 0) {
            throw "Customer Web integration tests failed."
        }
    } finally {
        Pop-Location
    }
} finally {
    if ($started) {
        & docker @composeArgs stop api
        & docker @composeArgs run --rm --no-deps api python -m tests.support.cloud_integration_cleanup
        if ($LASTEXITCODE -ne 0) {
            throw "Cloud cleanup is unsettled; integration containers and database are retained for recovery."
        }
    }
    Invoke-Compose @("down", "--volumes", "--remove-orphans")
}
