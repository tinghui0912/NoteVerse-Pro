# GitOps Applications

This directory holds Argo CD `Application` or `ApplicationSet` resources.

Initial policy:

- staging uses a manual-sync `Application`;
- production is not defined until staging GitOps is proven;
- automatic sync is disabled until drift detection, rollback, and smoke tests
  are rehearsed.
