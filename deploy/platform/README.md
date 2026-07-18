# Platform Manifests

This directory contains cluster platform examples that support the application
overlays. They are intentionally not included by `deploy/application`.

Platform resources are owned by operators, not application releases.

Included examples:

- `ingress-nginx/values.yaml`: ingress-nginx Helm values with
  `controller.service.type=LoadBalancer`;
- `cert-manager/*`: cert-manager `ClusterIssuer` examples for Let's Encrypt
  DNS-01 through Cloudflare.

Apply these before deploying the application overlay when running production or
production-flow rehearsal.

