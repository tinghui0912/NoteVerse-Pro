param(
    [string] $EnvFile = "backend/.env.docker",
    [string] $Namespace = "observability",
    [string] $SecretName = "observability-s3",
    [string] $LokiBucket = "noteverse-loki-staging",
    [string] $TempoBucket = "noteverse-tempo-staging"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
    param([string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "env file not found: $Path"
    }

    $values = @{}
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }
        $parts = $line.Split("=", 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        $values[$key] = $value
    }
    return $values
}

function Require-Value {
    param(
        [hashtable] $Values,
        [string] $Key
    )

    if (-not $Values.ContainsKey($Key) -or -not $Values[$Key]) {
        throw "missing required S3 key in env file: $Key"
    }
    return $Values[$Key]
}

$envValues = Read-DotEnv -Path $EnvFile
$endpoint = Require-Value -Values $envValues -Key "S3_ENDPOINT_URL"
$tempoEndpoint = $endpoint -replace "^https?://", ""
$region = Require-Value -Values $envValues -Key "S3_REGION"
$accessKey = Require-Value -Values $envValues -Key "S3_ACCESS_KEY_ID"
$secretKey = Require-Value -Values $envValues -Key "S3_SECRET_ACCESS_KEY"

$tmp = New-TemporaryFile
try {
    $secretLines = @(
        "LOKI_S3_ENDPOINT=$endpoint",
        "LOKI_S3_REGION=$region",
        "LOKI_S3_BUCKET=$LokiBucket",
        "LOKI_S3_ACCESS_KEY_ID=$accessKey",
        "LOKI_S3_SECRET_ACCESS_KEY=$secretKey",
        "TEMPO_S3_ENDPOINT=$tempoEndpoint",
        "TEMPO_S3_REGION=$region",
        "TEMPO_S3_BUCKET=$TempoBucket",
        "TEMPO_S3_ACCESS_KEY_ID=$accessKey",
        "TEMPO_S3_SECRET_ACCESS_KEY=$secretKey"
    )
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllLines($tmp, $secretLines, $utf8NoBom)

    kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n $Namespace create secret generic $SecretName --from-env-file=$tmp --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n $Namespace get secret $SecretName
}
finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
