param(
    [string] $ApplicationNamespace = "noteverse-staging",
    [string] $ObservabilityNamespace = "observability",
    [int] $ApiPort = 18000,
    [int] $LokiPort = 13100,
    [int] $TempoPort = 13200,
    [int] $TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

function Start-PortForward {
    param(
        [string] $Namespace,
        [string] $Name,
        [string] $Service,
        [int] $LocalPort,
        [int] $RemotePort
    )

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
    param([string] $Name, [int] $Port)

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

function Invoke-JsonWithRetry {
    param([string] $Name, [string] $Uri)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        try {
            return Invoke-RestMethod -Uri $Uri -TimeoutSec 30
        } catch {
            $lastError = $_
            Start-Sleep -Seconds 3
        }
    }
    throw "Timed out waiting for ${Name}: $lastError"
}

function Wait-ObservabilityWorkload {
    param(
        [string] $Namespace,
        [string] $Kind,
        [string] $Name,
        [string] $DisplayName
    )

    & kubectl -n $Namespace rollout status "${Kind}/${Name}" --timeout="${TimeoutSeconds}s"
    if ($LASTEXITCODE -ne 0) {
        throw "$DisplayName did not become ready before the correlation smoke test."
    }
}

function Get-LokiRecordsForRequest {
    param([object] $LokiResult, [string] $RequestId)

    $records = @()
    foreach ($stream in @($LokiResult.data.result)) {
        foreach ($value in @($stream.values)) {
            try {
                $envelope = $value[1] | ConvertFrom-Json
                $record = $envelope
                if ($envelope.log -is [string]) {
                    $record = $envelope.log | ConvertFrom-Json
                }
                if ($record.request_id -eq $RequestId) {
                    $records += $record
                }
            } catch {
                continue
            }
        }
    }
    return $records
}

$portForwards = @()
try {
    # A listening Service port does not mean that the log pipeline can accept
    # and query records yet. Wait for the complete dependency chain so a cold
    # start is reported as a platform-readiness failure, not an app failure.
    Wait-ObservabilityWorkload `
        -Namespace $ApplicationNamespace `
        -Kind "deployment" `
        -Name "noteverse-backend-api" `
        -DisplayName "NoteVerse API"
    Wait-ObservabilityWorkload `
        -Namespace $ObservabilityNamespace `
        -Kind "statefulset" `
        -Name "loki" `
        -DisplayName "Loki"
    Wait-ObservabilityWorkload `
        -Namespace $ObservabilityNamespace `
        -Kind "daemonset" `
        -Name "fluent-bit" `
        -DisplayName "Fluent Bit"
    Wait-ObservabilityWorkload `
        -Namespace $ObservabilityNamespace `
        -Kind "statefulset" `
        -Name "tempo" `
        -DisplayName "Tempo"

    $portForwards += Start-PortForward `
        -Namespace $ApplicationNamespace `
        -Name "api-correlation" `
        -Service "noteverse-backend-api" `
        -LocalPort $ApiPort `
        -RemotePort 8000
    $portForwards += Start-PortForward `
        -Namespace $ObservabilityNamespace `
        -Name "loki-correlation" `
        -Service "loki" `
        -LocalPort $LokiPort `
        -RemotePort 3100
    $portForwards += Start-PortForward `
        -Namespace $ObservabilityNamespace `
        -Name "tempo-correlation" `
        -Service "tempo" `
        -LocalPort $TempoPort `
        -RemotePort 3200

    Wait-Port -Name "API" -Port $ApiPort
    Wait-Port -Name "Loki" -Port $LokiPort
    Wait-Port -Name "Tempo" -Port $TempoPort

    $requestId = "observability-smoke-$([guid]::NewGuid().ToString('N'))"
    $response = Invoke-WebRequest `
        -Uri "http://127.0.0.1:$ApiPort/" `
        -Headers @{ "X-Request-ID" = $requestId } `
        -UseBasicParsing `
        -TimeoutSec 30
    if ($response.StatusCode -ne 200 -or $response.Headers["X-Request-ID"] -ne $requestId) {
        throw "API did not preserve the valid request correlation identifier."
    }

    $query = "{namespace=`"$ApplicationNamespace`"} |= `"$requestId`""
    $encodedQuery = [System.Uri]::EscapeDataString($query)
    $record = $null
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline -and -not $record) {
        $lokiResult = Invoke-JsonWithRetry `
            -Name "Loki request correlation" `
            -Uri "http://127.0.0.1:$LokiPort/loki/api/v1/query_range?query=$encodedQuery&limit=100"
        $record = Get-LokiRecordsForRequest -LokiResult $lokiResult -RequestId $requestId |
            Where-Object {
                $_.event -eq "api.request_completed" -and
                $_.trace_id -match "^[0-9a-f]{32}$" -and
                $_.span_id -match "^[0-9a-f]{16}$"
            } |
            Select-Object -First 1
        if (-not $record) {
            Start-Sleep -Seconds 3
        }
    }
    if (-not $record) {
        throw "Loki did not return a completed request log with W3C trace fields."
    }

    $traceId = $record.trace_id
    $trace = Invoke-JsonWithRetry `
        -Name "Tempo trace" `
        -Uri "http://127.0.0.1:$TempoPort/api/traces/$traceId"
    if (-not $trace) {
        throw "Tempo did not return the trace referenced by the Loki log."
    }

    $healthRequestId = "observability-health-$([guid]::NewGuid().ToString('N'))"
    $healthResponse = Invoke-WebRequest `
        -Uri "http://127.0.0.1:$ApiPort/health/live" `
        -Headers @{ "X-Request-ID" = $healthRequestId } `
        -UseBasicParsing `
        -TimeoutSec 30
    if ($healthResponse.StatusCode -ne 200) {
        throw "API health endpoint did not respond successfully."
    }
    Start-Sleep -Seconds 6
    $healthQuery = "{namespace=`"$ApplicationNamespace`"} |= `"$healthRequestId`""
    $encodedHealthQuery = [System.Uri]::EscapeDataString($healthQuery)
    $healthLogs = Invoke-JsonWithRetry `
        -Name "Loki health request check" `
        -Uri "http://127.0.0.1:$LokiPort/loki/api/v1/query_range?query=$encodedHealthQuery&limit=20"
    if (@(Get-LokiRecordsForRequest -LokiResult $healthLogs -RequestId $healthRequestId).Count -ne 0) {
        throw "Successful health checks must not emit regular application request logs."
    }

    Write-Host "[OK] request_id=$requestId"
    Write-Host "[OK] trace_id=$traceId"
    Write-Host "[OK] Loki request log links to a Tempo trace"
    Write-Host "[OK] successful health checks do not emit regular application request logs"
} finally {
    foreach ($process in $portForwards) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
