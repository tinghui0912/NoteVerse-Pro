# Customer Browser Protocol

`customer-browser-protocol.json` owns the fixed Customer API prefix and
Customer auth, refresh and CSRF cookie/header names. These versioned protocol
identities are shared by Backend, Customer Web and the Next proxy. They are
not environment configuration.

`scripts/generate_customer_browser_protocol.py` projects this source into Python
and TypeScript. It independently projects operationId, HTTP method and path
from committed Customer OpenAPI into browser-native route metadata. Native
image/audio/EventSource transports use that metadata with the generated client
serializer. Avatar URLs come directly from Backend DTOs.

Origins, service topology, secure-cookie/SameSite policy and session lifetimes
are deployment/runtime policy. Control Plane has its own protocol settings.
Signed storage capabilities are opaque storage targets outside Customer routes.

Run `npm run generate:browser-protocol` or `npm run check:browser-protocol` in
Customer Web. Backend and frontend quality workflows check the same projections.
