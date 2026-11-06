# Score Access and Secret Boundaries

ScoreAccessPolicy evaluates authenticated actions against owner and active membership
facts. Library organization grants no access. Owner/member endpoints enforce their
actions server-side; UI capability flags do not replace authorization.

Membership roles are VIEWER, PRACTITIONER and EDITOR. VIEWER receives presentation
only; PRACTITIONER can practice; EDITOR can practice and edit. Only the owner can use
explicit source/render download, archive and access-URL operations. Raw input delivery,
revision content and revision history require EDIT. Viewer/Practitioner receive empty
revision_sources and input_assets projections. Inline rendered-image viewing remains
VIEW access. Authenticated playback and exact PracticeBundle admission require PRACTICE.

Practice and editing necessarily disclose machine-readable source to trusted
Practitioner/Editor browsers. They do not imply a product download action. Invites
default to VIEWER. Acceptance preserves the stronger role, owner changes may upgrade
or downgrade, and membership revocation denies subsequent operations immediately.
Score membership never grants access to another user's personal practice data.

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
