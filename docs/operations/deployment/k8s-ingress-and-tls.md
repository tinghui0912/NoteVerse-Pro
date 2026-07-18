# Kubernetes Ingress And TLS

This document defines the production-shaped ingress and certificate model for
NoteVerse. It applies to both production Kubernetes and local minikube
production-flow rehearsal.

## Target Model

Use the same Kubernetes resource model in every environment:

```text
DNS
  -> Ingress Controller Service
  -> Ingress
  -> Kubernetes Services
  -> Pods
```

The application owns `Ingress` resources only. The cluster platform owns the
Ingress Controller, public entry point, certificates, and DNS automation.

## Ingress Controller Service Type

Production and production-shaped rehearsal should expose the Ingress Controller
as a stable entry point:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ingress-nginx-controller
  namespace: ingress-nginx
spec:
  type: LoadBalancer
```

Cloud managed Kubernetes usually provisions a cloud load balancer for
`type: LoadBalancer`.

Bare-metal or self-managed Kubernetes usually pairs `type: LoadBalancer` with a
provider such as MetalLB, BGP, or an external load balancer.

Avoid making the application depend on NodePort numbers. NodePort can exist
under the hood, but it is not the product-facing contract.

## TLS Automation

Use `cert-manager` for automated certificate lifecycle.

Recommended issuer strategy:

| Environment | Issuer | ACME Server | Solver |
| --- | --- | --- | --- |
| local production-flow rehearsal | Let's Encrypt staging | `https://acme-staging-v02.api.letsencrypt.org/directory` | DNS-01 |
| staging | Let's Encrypt staging or production | environment-specific | DNS-01 |
| production | Let's Encrypt production or cloud managed cert | `https://acme-v02.api.letsencrypt.org/directory` | DNS-01 |

DNS-01 is preferred because it does not require the local or staging cluster to
be reachable from the public internet. It only requires control over DNS for
the domain.

## Cloudflare DNS-01

For a Cloudflare-hosted test domain such as `johnabc.ccwu.cc`, create a
Cloudflare API token with the minimum permissions required by cert-manager:

```text
Zone.Zone: Read
Zone.DNS: Edit
```

Scope the token to the zone that contains `johnabc.ccwu.cc`. If
`johnabc.ccwu.cc` is a delegated zone in Cloudflare, scope the token to that
zone. If it is only a subdomain under a parent zone, scope the token to the
parent zone that Cloudflare actually hosts.

Create the token Secret in the namespace where cert-manager is installed:

```powershell
kubectl create namespace cert-manager --dry-run=client -o yaml | kubectl apply -f -
kubectl -n cert-manager create secret generic cloudflare-api-token-secret `
  --from-literal=api-token='<cloudflare-api-token>'
```

Before applying the issuer, validate that the token can access the DNS Records
API for the actual zone. Reading zone metadata is not enough:

```powershell
$token = '<cloudflare-api-token>'
$zoneId = '<cloudflare-zone-id>'
curl.exe -s -H "Authorization: Bearer $token" `
  "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?per_page=5"
```

The response must have:

```json
{"success": true}
```

If this endpoint returns `Authentication error`, cert-manager DNS-01 will also
fail when presenting the ACME TXT challenge. Recreate the token with
`Zone.Zone: Read` and `Zone.DNS: Edit` for the exact Cloudflare zone.

The repository includes example issuer manifests under:

```text
deploy/platform/cert-manager/
```

Create a Let's Encrypt staging `ClusterIssuer`:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging-cloudflare
spec:
  acme:
    email: ops@example.com
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-staging-cloudflare-account-key
    solvers:
      - dns01:
          cloudflare:
            apiTokenSecretRef:
              name: cloudflare-api-token-secret
              key: api-token
```

For production, create a separate `ClusterIssuer` that uses the production ACME
server and a separate account key Secret.

## Application Ingress Annotation

When cert-manager owns the TLS Secret, add the issuer annotation to the
application Ingress:

```yaml
metadata:
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-staging-cloudflare
spec:
  tls:
    - hosts:
        - staging.johnabc.ccwu.cc
        - api.staging.johnabc.ccwu.cc
      secretName: noteverse-staging-tls
```

The application still references only the TLS Secret name. Cert-manager creates
and renews the Secret.

## DNS Records

For DNS-01 certificate issuance, do not create the ACME TXT records manually.
Cert-manager creates temporary records such as:

```text
_acme-challenge.staging.johnabc.ccwu.cc
_acme-challenge.api.staging.johnabc.ccwu.cc
```

You need DNS records for browser traffic only.

### Local minikube With Port-Forward

For local minikube production-flow rehearsal using:

```powershell
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8443:443 8080:80
```

do not point public Cloudflare A records to `127.0.0.1`. Instead, override the
hosts locally:

```text
127.0.0.1 staging.johnabc.ccwu.cc
127.0.0.1 api.staging.johnabc.ccwu.cc
```

Then render the application overlay for:

```text
https://staging.johnabc.ccwu.cc:8443
```

### Production Or Public Staging

Point browser DNS to the real Ingress Controller load balancer:

```text
staging.johnabc.ccwu.cc      CNAME or A/AAAA -> ingress load balancer
api.staging.johnabc.ccwu.cc  CNAME or A/AAAA -> ingress load balancer
```

For cloud Kubernetes, this is often a CNAME to the cloud load balancer hostname.
For bare metal, this is usually an A/AAAA record to the MetalLB or external load
balancer address.

## Validation Commands

Check cert-manager status:

```powershell
kubectl get clusterissuer
kubectl -n noteverse-staging get certificate,certificaterequest,order,challenge
kubectl -n noteverse-staging describe certificate noteverse-staging-tls
```

If Cloudflare TXT records are visible from public resolvers but Challenges stay
pending with `not yet propagated`, install cert-manager with:

```text
deploy/platform/cert-manager/values.yaml
```

That values file configures DNS-01 self-checks to use stable public recursive
nameservers.

Some local networks intercept or rewrite DNS from minikube pods. If public
resolvers work from the host but not from a pod, verify from inside the cluster:

```powershell
kubectl -n cert-manager run dns-debug `
  --image=busybox:1.36 `
  --restart=Never `
  --rm -i `
  --command -- nslookup -type=TXT _acme-challenge.api.staging.johnabc.ccwu.cc 1.1.1.1
```

If this returns `NXDOMAIN` while the Cloudflare DNS Records API shows the TXT
record, query the Cloudflare authoritative nameserver from a pod:

```powershell
kubectl -n cert-manager run dns-debug `
  --image=busybox:1.36 `
  --restart=Never `
  --rm -i `
  --command -- nslookup -type=TXT _acme-challenge.api.staging.johnabc.ccwu.cc gigi.ns.cloudflare.com
```

For a local-only rehearsal, cert-manager can be temporarily upgraded with
recursive nameservers that are known to work from the minikube pod network. Do
not commit machine-specific DNS proxy addresses to repository values files.

Check the application ingress:

```powershell
kubectl -n noteverse-staging get ingress noteverse -o wide
kubectl -n noteverse-staging get secret noteverse-staging-tls
```

Smoke through the ingress entry point:

```powershell
curl.exe -k -I https://staging.johnabc.ccwu.cc:8443/zh/upload
curl.exe -k -i https://staging.johnabc.ccwu.cc:8443/api/v1/me/profile
```

Remove `-k` only after the local machine trusts the issuing CA. Let's Encrypt
staging certificates are intentionally not browser-trusted; they validate ACME
automation, not end-user trust.
