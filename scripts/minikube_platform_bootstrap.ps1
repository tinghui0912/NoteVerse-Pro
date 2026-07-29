param(
    [string] $AppNamespace = "noteverse-staging",
    [string] $CertManagerNamespace = "cert-manager",
    [string] $EnvoyGatewayNamespace = "envoy-gateway-system",
    [string] $MetalLBNamespace = "metallb-system",
    [string] $MinikubeProfile = $(if ($env:MINIKUBE_PROFILE) { $env:MINIKUBE_PROFILE } else { "noteverse-lvm" }),
    [string] $GatewayApiVersion = "v1.6.1",
    [string] $EnvoyGatewayChartVersion = "v1.8.3",
    [string] $MetalLBChartVersion = "0.15.2",
    [string] $MetalLBAddressPool = $env:NOTEVERSE_METALLB_ADDRESS_POOL,
    [string] $CloudflareApiToken = $env:CLOUDFLARE_API_TOKEN,
    [switch] $SkipCloudflareSecret,
    [switch] $SkipMetalLB
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

function Invoke-WithRetry {
    param(
        [string] $Name,
        [scriptblock] $Command,
        [int] $Attempts = 3,
        [int] $DelaySeconds = 5
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        Write-Host "==> $Name (attempt $attempt/$Attempts)"
        & $Command
        if ($LASTEXITCODE -eq 0) {
            return
        }

        if ($attempt -eq $Attempts) {
            exit $LASTEXITCODE
        }

        Start-Sleep -Seconds $DelaySeconds
    }
}

function Ensure-CloudflareToken {
    if ($SkipCloudflareSecret) {
        Write-Host "Skipping Cloudflare token Secret creation by request."
        return
    }

    if ([string]::IsNullOrWhiteSpace($CloudflareApiToken)) {
        throw "Cloudflare API token is required. Pass -CloudflareApiToken or set CLOUDFLARE_API_TOKEN. Use -SkipCloudflareSecret only when the Secret already exists."
    }
}

function Get-DefaultMetalLBAddressPool {
    if (-not [string]::IsNullOrWhiteSpace($MetalLBAddressPool)) {
        return $MetalLBAddressPool
    }

    $nodeIp = (
        kubectl get nodes -o jsonpath="{.items[0].status.addresses[?(@.type=='InternalIP')].address}"
    ).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($nodeIp)) {
        throw "Unable to derive MetalLB address pool because the first node InternalIP could not be read. Pass -MetalLBAddressPool or set NOTEVERSE_METALLB_ADDRESS_POOL."
    }

    $parts = $nodeIp.Split(".")
    if ($parts.Length -ne 4) {
        throw "Unexpected minikube ip '$nodeIp'. Pass -MetalLBAddressPool or set NOTEVERSE_METALLB_ADDRESS_POOL."
    }

    return "$($parts[0]).$($parts[1]).$($parts[2]).240-$($parts[0]).$($parts[1]).$($parts[2]).250"
}

Test-CommandAvailable "kubectl"
Test-CommandAvailable "helm"
Test-CommandAvailable "minikube"
Ensure-CloudflareToken

Invoke-Checked "minikube:status" {
    minikube -p $MinikubeProfile status
}

Invoke-Checked "cluster:nodes" {
    kubectl get nodes -o wide
}

Invoke-Checked "namespace:application" {
    kubectl create namespace $AppNamespace --dry-run=client -o yaml | kubectl apply -f -
}

Invoke-Checked "gateway-api:crds" {
    kubectl apply --server-side -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/$GatewayApiVersion/standard-install.yaml"
}

Invoke-WithRetry "envoy-gateway:install" {
    helm upgrade --install envoy-gateway oci://docker.io/envoyproxy/gateway-helm `
        --version $EnvoyGatewayChartVersion `
        --namespace $EnvoyGatewayNamespace `
        --create-namespace `
        --set crds.enabled=false `
        -f deploy/platform/gateway-api/envoy-gateway.values.yaml
}

Invoke-Checked "envoy-gateway:rollout" {
    kubectl -n $EnvoyGatewayNamespace rollout status deployment/envoy-gateway --timeout=300s
}

Invoke-Checked "envoy-gateway:gatewayclass" {
    kubectl apply -f deploy/platform/gateway-api/gatewayclass.yaml
}

if (-not $SkipMetalLB) {
    $resolvedMetalLBAddressPool = Get-DefaultMetalLBAddressPool

    if (-not (kubectl -n $MetalLBNamespace get secret metallb-memberlist 2>$null)) {
        $memberlistBytes = New-Object byte[] 128
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($memberlistBytes)
        $memberlistSecret = [Convert]::ToBase64String($memberlistBytes)
        Invoke-Checked "metallb:memberlist-secret" {
            kubectl create namespace $MetalLBNamespace --dry-run=client -o yaml | kubectl apply -f -
            kubectl -n $MetalLBNamespace create secret generic metallb-memberlist `
                --from-literal=secretkey=$memberlistSecret `
                --dry-run=client -o yaml | kubectl apply -f -
        }
    }

    Invoke-WithRetry "metallb:install" {
        helm repo add metallb https://metallb.github.io/metallb 2>$null
        helm repo update metallb
        helm upgrade --install metallb metallb/metallb `
            --namespace $MetalLBNamespace `
            --create-namespace `
            --version $MetalLBChartVersion `
            --set speaker.frr.enabled=false `
            -f deploy/platform/metallb/minikube.values.yaml
    }

    Invoke-Checked "metallb:rollout" {
        kubectl -n $MetalLBNamespace rollout status deployment/metallb-controller --timeout=300s
        kubectl -n $MetalLBNamespace rollout status daemonset/metallb-speaker --timeout=300s
    }

    $metalLBPoolManifest = @"
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: noteverse-minikube
  namespace: $MetalLBNamespace
spec:
  addresses:
    - $resolvedMetalLBAddressPool
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: noteverse-minikube
  namespace: $MetalLBNamespace
spec:
  ipAddressPools:
    - noteverse-minikube
"@

    Invoke-Checked "metallb:address-pool" {
        $metalLBPoolManifest | kubectl apply -f -
    }

    Write-Host "MetalLB address pool: $resolvedMetalLBAddressPool"
}

Invoke-WithRetry "cert-manager:install" {
    helm repo add jetstack https://charts.jetstack.io 2>$null
    helm repo update jetstack
    helm upgrade --install cert-manager jetstack/cert-manager `
        --namespace $CertManagerNamespace `
        --create-namespace `
        --set crds.enabled=true `
        -f deploy/platform/cert-manager/values.yaml `
        -f deploy/platform/cert-manager/minikube.values.yaml
}

Invoke-Checked "cert-manager:rollout" {
    kubectl -n $CertManagerNamespace rollout status deployment/cert-manager --timeout=300s
    kubectl -n $CertManagerNamespace rollout status deployment/cert-manager-webhook --timeout=300s
    kubectl -n $CertManagerNamespace rollout status deployment/cert-manager-cainjector --timeout=300s
}

if (-not $SkipCloudflareSecret) {
    Invoke-Checked "cert-manager:cloudflare-token-secret" {
        kubectl -n $CertManagerNamespace create secret generic cloudflare-api-token-secret `
            --from-literal=api-token=$CloudflareApiToken `
            --dry-run=client -o yaml | kubectl apply -f -
    }
}

Invoke-Checked "cert-manager:staging-clusterissuer" {
    kubectl apply -f deploy/platform/cert-manager/clusterissuer-letsencrypt-staging-dns01-cloudflare.yaml
}

Invoke-Checked "cert-manager:production-clusterissuer" {
    kubectl apply -f deploy/platform/cert-manager/clusterissuer-letsencrypt-production-dns01-cloudflare.yaml
}

Invoke-Checked "cert-manager:clusterissuer-status" {
    kubectl get clusterissuer letsencrypt-staging-dns01 letsencrypt-production-dns01 -o wide
}

Invoke-Checked "gateway-api:classes" {
    kubectl get gatewayclass
}

Write-Host ""
Write-Host "Platform bootstrap completed."
Write-Host "Next:"
Write-Host "1. Create app registry/backend Secrets in namespace $AppNamespace."
Write-Host "2. Render and apply the staging release overlay."
Write-Host "3. Inspect the Envoy data-plane Service after the NoteVerse Gateway is applied:"
Write-Host "   kubectl get svc -A | Select-String envoy"
