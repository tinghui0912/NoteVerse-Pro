param(
    [string] $Namespace = "observability",
    [int] $PrometheusPort = 19090,
    [int] $GrafanaPort = 13080,
    [int] $LokiPort = 13100,
    [int] $TempoPort = 13200,
    [int] $TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string] $Name)
    Write-Host "==> $Name"
}

function Start-PortForward {
    param(
        [string] $Name,
        [string] $Service,
        [int] $LocalPort,
        [int] $RemotePort
    )

    Write-Step "port-forward:$Name"
    $arguments = @(
        "-n", $Namespace,
        "port-forward",
        "svc/$Service",
        "${LocalPort}:${RemotePort}"
    )

    return Start-Process `
        -FilePath "kubectl" `
        -ArgumentList $arguments `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $env:TEMP "noteverse-${Name}-pf.out") `
        -RedirectStandardError (Join-Path $env:TEMP "noteverse-${Name}-pf.err")
}

function Wait-Port {
    param(
        [string] $Name,
        [int] $Port
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(500)) {
                $client.EndConnect($async)
                $client.Close()
                return
            }
            $client.Close()
        } catch {
            Start-Sleep -Milliseconds 500
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Timed out waiting for $Name on localhost:$Port"
}

function Invoke-Json {
    param(
        [string] $Uri,
        [hashtable] $Headers = @{}
    )

    return Invoke-RestMethod -Uri $Uri -Headers $Headers -TimeoutSec 30
}

function Invoke-JsonWithRetry {
    param(
        [string] $Name,
        [string] $Uri,
        [hashtable] $Headers = @{}
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        try {
            return Invoke-Json -Uri $Uri -Headers $Headers
        } catch {
            $lastError = $_
            Start-Sleep -Seconds 5
        }
    }

    throw "Timed out waiting for ${Name}: $lastError"
}

function Invoke-Kubectl {
    param([string[]] $Arguments)

    & kubectl @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "kubectl failed: $($Arguments -join ' ')"
    }
}

function Get-SecretText {
    param([string] $JsonPath)

    $encoded = & kubectl -n $Namespace get secret kube-prometheus-stack-grafana -o "jsonpath=$JsonPath"
    if ($LASTEXITCODE -ne 0) {
        throw "kubectl failed: get Grafana Secret"
    }
    if (-not $encoded) {
        throw "Missing Grafana Secret field: $JsonPath"
    }
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encoded))
}

$portForwards = @()

try {
    Write-Step "pods-ready"
    Invoke-Kubectl -Arguments @("wait", "--for=condition=Ready", "pod", "-n", $Namespace, "--all", "--timeout=${TimeoutSeconds}s")

    Write-Step "pvc-bound"
    $pvcJson = & kubectl -n $Namespace get pvc -o json
    if ($LASTEXITCODE -ne 0) {
        throw "kubectl failed: get PVCs"
    }
    $pendingPvcs = $pvcJson |
        ConvertFrom-Json |
        Select-Object -ExpandProperty items |
        Where-Object { $_.status.phase -ne "Bound" }
    if ($pendingPvcs) {
        $names = ($pendingPvcs | ForEach-Object { $_.metadata.name }) -join ", "
        throw "PVCs are not Bound: $names"
    }

    $portForwards += Start-PortForward -Name "prometheus" -Service "kube-prometheus-stack-prometheus" -LocalPort $PrometheusPort -RemotePort 9090
    $portForwards += Start-PortForward -Name "grafana" -Service "kube-prometheus-stack-grafana" -LocalPort $GrafanaPort -RemotePort 80
    $portForwards += Start-PortForward -Name "loki" -Service "loki" -LocalPort $LokiPort -RemotePort 3100
    $portForwards += Start-PortForward -Name "tempo" -Service "tempo" -LocalPort $TempoPort -RemotePort 3200

    Wait-Port -Name "prometheus" -Port $PrometheusPort
    Wait-Port -Name "grafana" -Port $GrafanaPort
    Wait-Port -Name "loki" -Port $LokiPort
    Wait-Port -Name "tempo" -Port $TempoPort

    Write-Step "prometheus:ready"
    Invoke-RestMethod -Uri "http://127.0.0.1:$PrometheusPort/-/ready" -TimeoutSec 30 | Out-Null
    $up = Invoke-JsonWithRetry -Name "Prometheus query" -Uri "http://127.0.0.1:$PrometheusPort/api/v1/query?query=up"
    if ($up.status -ne "success" -or -not $up.data.result -or $up.data.result.Count -lt 1) {
        throw "Prometheus query returned no up-series"
    }

    Write-Step "loki:ready"
    Invoke-RestMethod -Uri "http://127.0.0.1:$LokiPort/ready" -TimeoutSec 15 | Out-Null
    Invoke-JsonWithRetry -Name "Loki labels" -Uri "http://127.0.0.1:$LokiPort/loki/api/v1/labels" | Out-Null

    Write-Step "tempo:ready"
    Invoke-RestMethod -Uri "http://127.0.0.1:$TempoPort/ready" -TimeoutSec 15 | Out-Null

    Write-Step "grafana:datasources"
    $adminUser = Get-SecretText -JsonPath "{.data.admin-user}"
    $adminPassword = Get-SecretText -JsonPath "{.data.admin-password}"
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${adminUser}:${adminPassword}"))
    $headers = @{ Authorization = "Basic $basic" }
    $health = Invoke-JsonWithRetry -Name "Grafana health" -Uri "http://127.0.0.1:$GrafanaPort/api/health" -Headers $headers
    if ($health.database -ne "ok") {
        throw "Grafana database health is not ok"
    }

    $datasources = Invoke-JsonWithRetry -Name "Grafana datasources" -Uri "http://127.0.0.1:$GrafanaPort/api/datasources" -Headers $headers
    $datasourceTypes = @($datasources | ForEach-Object { $_.type })
    foreach ($required in @("prometheus", "loki", "tempo")) {
        if ($datasourceTypes -notcontains $required) {
            throw "Grafana datasource type missing: $required"
        }
    }

    Write-Step "grafana:dashboards"
    $dashboards = Invoke-JsonWithRetry -Name "Grafana dashboards" -Uri "http://127.0.0.1:$GrafanaPort/api/search?type=dash-db&query=NoteVerse" -Headers $headers
    $dashboardTitles = @($dashboards | ForEach-Object { $_.title })
    foreach ($required in @("NoteVerse Application Overview", "NoteVerse Platform Observability")) {
        if ($dashboardTitles -notcontains $required) {
            throw "Grafana dashboard missing: $required"
        }
    }

    Write-Host "[OK] observability smoke passed"
} finally {
    foreach ($process in $portForwards) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
