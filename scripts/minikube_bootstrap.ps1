param(
    [string] $AppNamespace = "noteverse-staging",
    [string] $ObservabilityNamespace = "observability",
    [string] $ApiDeployment = "noteverse-backend-api",
    [switch] $ApplyDnsFix,
    [switch] $ValidateTracing
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [string] $Name,
        [scriptblock] $Command
    )

    Write-Host "==> $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

function Test-CommandAvailable {
    param([string] $Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required but was not found on PATH."
    }
}

Test-CommandAvailable "kubectl"
Test-CommandAvailable "minikube"

Invoke-Checked "minikube:status" {
    minikube status
}

Invoke-Checked "cluster:nodes" {
    kubectl get nodes -o wide
}

if ($ApplyDnsFix) {
    Invoke-Checked "coredns:scale-to-two-replicas" {
        kubectl -n kube-system scale deployment coredns --replicas=2
    }

    Invoke-Checked "coredns:rollout" {
        kubectl -n kube-system rollout status deployment/coredns --timeout=180s
    }

    Invoke-Checked "kube-dns:prefer-local-endpoints" {
        kubectl -n kube-system patch svc kube-dns --type='merge' -p '{"spec":{"internalTrafficPolicy":"Local"}}'
    }
}

Invoke-Checked "coredns:pods" {
    kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide
}

Invoke-Checked "kube-dns:service-policy" {
    kubectl -n kube-system get svc kube-dns -o jsonpath="{.spec.internalTrafficPolicy}"
    Write-Host ""
}

Invoke-Checked "application:pods" {
    kubectl -n $AppNamespace get pods -o wide
}

Invoke-Checked "observability:pods" {
    kubectl -n $ObservabilityNamespace get pods -o wide
}

if ($ValidateTracing) {
    $collectorHost = "otel-collector-opentelemetry-collector.$ObservabilityNamespace.svc.cluster.local"
    $tempoHost = "tempo.$ObservabilityNamespace.svc.cluster.local"
    $pythonScript = @"
import socket

targets = [
    ("kubernetes", "kubernetes.default.svc.cluster.local", 443),
    ("otel_collector", "$collectorHost", 4317),
    ("tempo", "$tempoHost", 4317),
]

for label, host, port in targets:
    ip = socket.gethostbyname(host)
    with socket.create_connection((host, port), timeout=5):
        print(f"OK {label}: {host} -> {ip}:{port}")
"@
    $encodedPythonScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pythonScript))
    $pythonCommand = "import base64; exec(base64.b64decode('$encodedPythonScript').decode())"

    Invoke-Checked "tracing:service-connectivity-from-api" {
        kubectl -n $AppNamespace exec "deploy/$ApiDeployment" -- python -c $pythonCommand
    }

    Invoke-Checked "tracing:generate-api-spans" {
        for ($i = 0; $i -lt 5; $i++) {
            kubectl -n $AppNamespace exec "deploy/$ApiDeployment" -- python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).status)"
        }
    }

    Write-Host "Tracing smoke generated API spans. To inspect them, port-forward Tempo and query service.name=noteverse-backend-api:"
    Write-Host "kubectl -n $ObservabilityNamespace port-forward svc/tempo 13200:3200"
    Write-Host "Invoke-RestMethod -Uri 'http://127.0.0.1:13200/api/search?tags=service.name%3Dnoteverse-backend-api&limit=20'"
}
