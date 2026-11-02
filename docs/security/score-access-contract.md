# Score Access and Secret Boundaries

ScoreAccessPolicy evaluates authenticated actions against owner and active membership
facts. Library organization grants no access. Owner/member endpoints enforce their
actions server-side; UI capability flags do not replace authorization.

Guest Preview is a separate anonymous bearer presentation channel. An owner-created
ScoreGuestPreviewGrant pins exactly one ScoreRevision. Its composite revision foreign
key prevents cross-score linkage. It expires at a future time within 30 days (seven by
default) and revocation is permanent. Deleted Scores are inaccessible immediately.

Only exact pinned rendered page images and generated audio are delivered, inline and
listen-only. Missing audio/images never fall back to a different revision. The JSON
contains no MusicXML, revision sources, storage keys, download URLs or generic Score
capabilities. No source, explicit download, Practice, edit, bookmark, redemption,
membership or persistent account access is granted, including to logged-in visitors.

Raw random tokens are returned only on creation. Persistence uses hashes; management
lists and logs do not reveal tokens. Guest Preview responses use private, no-store
caching. The browser page declares noindex, nofollow and noarchive. These boundaries
do not prevent screenshots or browser copying of rendered images.

Customer and operator sessions have separate identities, cookies, CSRF and authorization
policies. Structured logs follow the default-deny
[log schema](../operations/observability/log-event-schema.md).

See [Score Access Decision](../adr/0004-score-access-collaboration-and-guest-preview.md),
[Library and My Scores](../product/library-and-my-scores.md) and
[Control-Plane Identity](control-plane-identity-contract.md).
