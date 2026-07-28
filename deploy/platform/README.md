# Platform Manifests

This directory contains cluster platform examples that support the application
overlays. They are intentionally not included by `deploy/application`.

Platform resources are owned by operators, not application releases.

Included examples:

- `gateway-api/*`: Gateway API and Envoy Gateway installation guidance;
- `cert-manager/*`: cert-manager `ClusterIssuer` examples for Let's Encrypt
  DNS-01 through Cloudflare;
- `storage/*`: StorageClass and PVC ownership guidance for minikube/staging
  and production.

Apply these before deploying the application overlay when running production or
production-flow rehearsal.
