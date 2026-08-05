# Kubernetes Gateway API And TLS

This document defines the production-shaped external traffic and certificate
model for NoteVerse. It applies to production Kubernetes and local minikube
production-flow rehearsal.

## Target Model

Use the same Kubernetes resource model in every environment:

```text
DNS
  -> LoadBalancer / local routed endpoint
  -> Gateway API implementation
  -> Gateway
  -> HTTPRoute
  -> Kubernetes Services
  -> Pods
```

NoteVerse uses Gateway API and Envoy Gateway as the target platform path.

## Ownership

Platform operators own:

- Gateway API CRDs;
- Envoy Gateway installation;
- GatewayClass controller;
- public load balancer or local minikube equivalent;
- cert-manager installation;
- DNS-01 ClusterIssuers;
- DNS records.

Application release overlays own:

- environment-specific `Certificate`;
- environment-specific `Gateway`;
- environment-specific `HTTPRoute`;
- references to cert-manager-owned TLS Secret names;
- routing to `noteverse-customer-web`, `noteverse-backend-api`, and
  `noteverse-backend-practice`.

## Platform Installation

Install Gateway API CRDs:

```bash
kubectl apply --server-side \
  -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.1/standard-install.yaml
```

Install Envoy Gateway:

```bash
helm upgrade --install envoy-gateway oci://docker.io/envoyproxy/gateway-helm \
  --version v1.8.3 \
  --namespace envoy-gateway-system \
  --create-namespace \
  --set crds.enabled=false \
  -f deploy/platform/gateway-api/envoy-gateway.values.yaml
```

This installs the Envoy Gateway control plane. The public entrypoint is the
Envoy data-plane Service reconciled for the NoteVerse `Gateway`, not the control
plane Service.

Gateway API CRDs are installed explicitly before the Helm release. Keep
`crds.enabled=false` on the Envoy Gateway chart to avoid CRD field ownership
conflicts between Helm and `kubectl`.

Create the platform GatewayClass:

```bash
kubectl apply -f deploy/platform/gateway-api/gatewayclass.yaml
kubectl get gatewayclass envoy-gateway
```

Install cert-manager and the environment-specific ClusterIssuer from:

```text
deploy/platform/cert-manager/
```

## TLS Automation

Use cert-manager for automated certificate lifecycle.

Recommended issuer strategy:

| Environment | Issuer | ACME server | Solver |
| --- | --- | --- | --- |
| minikube/staging production-flow rehearsal | Let's Encrypt production after staging validation | `https://acme-v02.api.letsencrypt.org/directory` | DNS-01 |
| staging | Let's Encrypt staging or production | environment-specific | DNS-01 |
| production | Let's Encrypt production or cloud managed cert | `https://acme-v02.api.letsencrypt.org/directory` | DNS-01 |

DNS-01 is preferred because local and staging clusters do not need to be
reachable from the public internet. They only need permission to create
temporary ACME TXT records in DNS.

## Cloudflare DNS-01

For a Cloudflare-hosted test domain such as `johnabc.ccwu.cc`, create a
Cloudflare API token with the minimum permissions required by cert-manager:

```text
Zone.Zone: Read
Zone.DNS: Edit
```

Scope the token to the actual Cloudflare zone.

Create the token Secret in the namespace where cert-manager is installed:

```powershell
kubectl create namespace cert-manager --dry-run=client -o yaml | kubectl apply -f -
kubectl -n cert-manager create secret generic cloudflare-api-token-secret `
  --from-literal=api-token='<cloudflare-api-token>'
```

Before applying the issuer, validate that the token can access DNS records for
the zone:

```powershell
$token = '<cloudflare-api-token>'
$zoneId = '<cloudflare-zone-id>'
curl.exe -s -H "Authorization: Bearer $token" `
  "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?per_page=5"
```

The response must include:

```json
{"success": true}
```

## Certificate And Gateway TLS Secret

The application overlay creates an environment-specific cert-manager
`Certificate`. Cert-manager owns Secret creation and renewal:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
spec:
  secretName: noteverse-staging-tls
  dnsNames:
    - staging.johnabc.ccwu.cc
    - admin.staging.johnabc.ccwu.cc
  issuerRef:
    name: letsencrypt-production-dns01
    kind: ClusterIssuer
```

The `Gateway` references the same TLS Secret:

```yaml
spec:
  listeners:
    - name: web-https
      protocol: HTTPS
      hostname: staging.johnabc.ccwu.cc
      tls:
        mode: Terminate
        certificateRefs:
          - name: noteverse-staging-tls
```

The release package renders the hostnames and Secret name into both the
`Certificate` and `Gateway`.

## DNS Records

For DNS-01 certificate issuance, do not create ACME TXT records manually.
Cert-manager creates temporary records such as:

```text
_acme-challenge.staging.johnabc.ccwu.cc
_acme-challenge.admin.staging.johnabc.ccwu.cc
```

Create browser-facing DNS records for the Gateway entrypoint:

```text
staging.johnabc.ccwu.cc      CNAME or A/AAAA -> Gateway load balancer
admin.staging.johnabc.ccwu.cc CNAME or A/AAAA -> Gateway load balancer
```

For minikube production-flow rehearsal, install MetalLB so the Envoy data-plane
`LoadBalancer` Service receives a stable local external IP and the `Gateway`
reaches `PROGRAMMED=True`. The repository bootstrap installs MetalLB in L2 mode
with FRR disabled and derives the address pool from the current node
`InternalIP`.

On Windows minikube drivers, the assigned LoadBalancer IP can still be
inconvenient or unreachable from the host browser. In that case, port-forward
the Envoy data-plane Service to local port 443 and map the staging hosts to
`127.0.0.1`. The request host must match the host rendered into the `Gateway`
and `HTTPRoute` resources.

Use the repository helper for the current staging rehearsal:

```powershell
.\scripts\start_minikube_gateway_port_forward.ps1
```

## Validation

Check Gateway API resources:

```powershell
kubectl -n noteverse-staging get gateway,httproute
kubectl -n noteverse-staging describe gateway noteverse
kubectl -n noteverse-staging describe httproute noteverse-web
kubectl -n noteverse-staging describe httproute noteverse-platform-admin
```

Check cert-manager status:

```powershell
kubectl get clusterissuer
kubectl -n noteverse-staging get certificate,certificaterequest,order,challenge
kubectl -n noteverse-staging describe certificate noteverse-tls
```

Smoke through the Gateway entrypoint:

```powershell
curl.exe -I https://staging.johnabc.ccwu.cc/zh/upload
curl.exe -i https://staging.johnabc.ccwu.cc/api/v1/me/profile
```

Validate the production-flow minikube entrypoint:

```powershell
kubectl -n envoy-gateway-system get svc
kubectl -n noteverse-staging get gateway,httproute,certificate
kubectl -n noteverse-staging describe gateway noteverse
```

Use Let's Encrypt production certificates for the production-flow minikube
rehearsal when browser-trusted TLS is required. Avoid unnecessary certificate
recreation to stay clear of ACME production rate limits.
