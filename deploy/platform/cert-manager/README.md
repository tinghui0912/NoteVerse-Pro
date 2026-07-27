# cert-manager

These manifests define example `ClusterIssuer` resources for Let's Encrypt
DNS-01 with Cloudflare.

Before applying:

1. Install cert-manager.
2. Create `Secret/cloudflare-api-token-secret` in namespace `cert-manager`.
3. Verify the token can call the Cloudflare DNS Records API for the intended
   zone.
4. Replace the operator email if needed.
5. Apply both staging and production issuers.
6. Use the staging issuer for first-time DNS-01 validation or rate-limit-safe
   troubleshooting.
7. Use the production issuer for browser-trusted minikube production-flow
   rehearsal and production.

The staging overlay currently expects:

```text
ClusterIssuer/letsencrypt-production-dns01
```

The production overlay expects:

```text
ClusterIssuer/letsencrypt-production-dns01
```

Install cert-manager with the repository values file when rehearsing DNS-01:

```powershell
helm upgrade --install cert-manager jetstack/cert-manager `
  --namespace cert-manager `
  --create-namespace `
  --set crds.enabled=true `
  -f deploy\platform\cert-manager\values.yaml
```

The values file makes DNS-01 self-checks use stable public recursive
nameservers. This avoids local cluster DNS caches masking already propagated
Cloudflare TXT records.
