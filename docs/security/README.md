# Security Contracts

Security references define current identity, authorization and secret-handling
boundaries. Operational incident procedures belong in `../operations/`.

- [Control-Plane Identity Contract](control-plane-identity-contract.md)
- [Score Access and Secret Boundaries](score-access-contract.md)
- [Score Access Decision](../adr/0004-score-access-collaboration-and-guest-preview.md)
- [Structured Log Privacy](../operations/observability/log-event-schema.md)
- [Kubernetes Secrets and Storage](../operations/deployment/k8s-secrets-and-storage-template.md)
- [GitHub Merge Policy](../governance/github-merge-policy.md)

## Browser session boundaries

Login establishes session cookies and returns the canonical authenticated principal.
Password reset invalidates existing sessions and clears the current browser's session,
refresh and CSRF cookies. Authentication clears principal-sensitive client server-state when leaving
or switching a principal; explicitly principal-independent bearer resources retain their
own credential and cache lifecycle. Return navigation accepts only parser-validated same-origin
app-relative paths; external and backslash-based redirect targets are rejected. The Next
proxy checks cookie existence as a routing gate, while backend session validation remains
the authentication authority.
