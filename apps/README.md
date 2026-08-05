# NoteVerse Applications

This directory contains independently deployable web applications.

- `customer-web`: the customer-facing Next.js application, including public,
  authenticated, workspace, and external-viewer routes.
- `platform-admin`: the operator-facing Next.js application. It communicates
  only with the Control Plane API and must not reuse customer sessions.

Each application keeps its own dependency manifest and lockfile. Do not add a
root JavaScript workspace merely to centralize tooling: introduce a shared
package only after a stable, versioned cross-application contract exists.

The backend remains in `../backend` as a modular monolith with separate API,
practice, control-plane, observability, Beat, and worker composition roots.
