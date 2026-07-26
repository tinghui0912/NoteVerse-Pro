# Gateway API Platform

NoteVerse uses Gateway API and Envoy Gateway as the target Kubernetes
entrypoint model.

Install order:

1. Gateway API CRDs.
2. Envoy Gateway.
3. cert-manager and DNS-01 ClusterIssuers.
4. NoteVerse application release overlay.

Gateway API CRDs:

```bash
kubectl apply --server-side \
  -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.1/standard-install.yaml
```

Envoy Gateway Helm install:

```bash
helm upgrade --install envoy-gateway oci://docker.io/envoyproxy/gateway-helm \
  --version v1.8.3 \
  --namespace envoy-gateway-system \
  --create-namespace \
  --set crds.enabled=false \
  -f deploy/platform/gateway-api/envoy-gateway.values.yaml
```

The application overlays create the environment-specific `Certificate`,
`Gateway`, and `HTTPRoute` resources. Platform operators own the GatewayClass
controller, load balancer exposure, DNS, and certificate issuer setup.

The Helm chart installs the Envoy Gateway control plane. Do not expose the
control-plane Service as the public entrypoint. The browser-facing entrypoint is
the Envoy data-plane Service reconciled for the application `Gateway`.

Gateway API CRDs are installed explicitly before the Helm release. Keep
`crds.enabled=false` on the Envoy Gateway chart so CRD ownership does not bounce
between `kubectl` and Helm.

Create the platform GatewayClass after the controller is installed:

```bash
kubectl apply -f deploy/platform/gateway-api/gatewayclass.yaml
kubectl get gatewayclass envoy-gateway
```
