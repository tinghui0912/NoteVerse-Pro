# Score Access and Secret Boundaries

The score access policy evaluates explicit actions against server-derived owner,
membership and grant context. Library organization grants no access
by itself. Share links are view-only; editable collaboration requires an
authenticated membership. Endpoint authorization remains mandatory even when a
response includes UI capability flags.

Share management uses an opaque grant identifier, while bearer access uses a
high-entropy token. Raw
secrets are returned once; persistence stores only their secure digest. Grant
lists and logs do not reveal bearer material. Expiry, revocation and explicit
download/practice flags bound grant access. Saving a bookmark cannot extend it.

Source downloads, rendered pages and audio have different permissions. Storage adapters
must not convert possession of an internal object key into public authorization.

Customer and operator sessions have separate identities, cookies, CSRF and
authorization policies. Public errors are bounded; internal diagnostic access
uses the control plane. Structured logs follow the default-deny
[log schema](../operations/observability/log-event-schema.md).

See [Score Access Decision](../adr/0004-score-access-and-sharing.md),
[Library and My Scores](../product/library-and-my-scores.md) and
[Control-Plane Identity](control-plane-identity-contract.md).
