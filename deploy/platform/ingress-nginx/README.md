# ingress-nginx

Use these values when installing ingress-nginx in production or
production-flow rehearsal:

```powershell
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx `
  --namespace ingress-nginx `
  --create-namespace `
  -f deploy\platform\ingress-nginx\values.yaml
```

The important production-shaped contract is:

```yaml
controller:
  service:
    type: LoadBalancer
```

In minikube, this can be paired with `minikube tunnel` or an ingress controller
port-forward for local browser access. In production, the cluster or load
balancer provider should allocate the stable external entry point.

