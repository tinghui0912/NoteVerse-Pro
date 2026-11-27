# Browser Protocols

`customer-browser-protocol.json` owns the Customer API prefix and host-only session
cookie names. `control-plane-browser-protocol.json` owns the Control Plane API
prefix, session cookies and MFA challenge cookies. Deployment configures explicit
browser origins, transport security and lifetimes; protocol identities are fixed.

The generators under `scripts/` produce Python and TypeScript projections. Customer
route metadata comes from its OpenAPI snapshot; generated SDKs own methods, paths,
request serialization and response types. Browser transports own credentials,
session invalidation, cancellation and bounded error classification.

Both HTTP runtimes enforce [Browser Request Security](../../docs/architecture/browser-request-security.md).
Commands use JSON, except the explicit Customer avatar Multipart endpoint. Empty
commands need no content type. Browser-supplied Origin and Fetch Metadata protect
requests without readable security cookies or caller-generated token headers.

```shell
python scripts/generate_customer_browser_protocol.py --check
python scripts/generate_control_plane_browser_protocol.py --check
```
