param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeArgs = @("compose", "-f", "docker-compose.integration.yml")

function Invoke-Compose([string[]] $Arguments) {
    & docker @composeArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($Arguments -join ' ')"
    }
}

try {
    Invoke-Compose @("up", "--build", "-d", "postgres", "redis", "migrate", "seed", "api", "practice", "customer-web")
    $deadline = (Get-Date).AddMinutes(3)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3010/en/auth/login" -TimeoutSec 5
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
        $env:INTEGRATION_BASE_URL = "http://localhost:3010"
        npm.cmd run test:e2e:integration
        if ($LASTEXITCODE -ne 0) {
            throw "Customer Web integration tests failed."
        }
    } finally {
        Pop-Location
    }
} finally {
    Invoke-Compose @("down", "--volumes", "--remove-orphans")
}
