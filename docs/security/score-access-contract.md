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

ScoreInvite stores an optional actor terminal outcome with a coherent terminal
timestamp and actor, enforced by a database constraint. With no actor outcome,
effective status is PENDING or EXPIRED according to expires_at and the current
time. Expiry requires no database write; admission and effective-status helpers
perform no IO or commits. Actor commands lock and refresh Invite before admission.
Accept locks Invite then Membership and commits its outcome and membership
admission atomically. Revoke retries preserve the recorded terminal time and actor.
Owner member removal and Self Leave change current membership access without
rewriting invitation history. Only explicit acceptance of a new valid Invite can
reactivate revoked membership; owner role PATCH cannot restore it.

Guest Preview is a separate anonymous, presentation-only bearer channel. Each Score
owns one stable high-entropy token and an enabled flag. Only its owner can retrieve
the link or toggle access. The token persists across disable/re-enable. Generic Score
responses, model dumps and logs exclude it. There is no expiry or revision pin.

Every bearer request requires an enabled, active Score and resolves its current head.
Only current-head page images and generated audio are delivered inline/listen-only.
An asset from an earlier head is rejected. Missing current-head assets never fall back
to another revision. Historical derivatives are not protected by Guest Preview.
The JSON contains no revision identity, MusicXML, source metadata, storage keys,
download URLs or generic Score capabilities. No Practice, edit, download, bookmark,
redemption, membership or persistent account access is granted, including to logged-in
visitors.

Guest Preview responses use private, no-store caching. The browser page declares
noindex, nofollow and noarchive. These boundaries do not prevent screenshots or
browser copying of rendered images.

Customer and operator sessions have separate identities, cookies, CSRF and authorization
policies. Structured logs follow the default-deny
[log schema](../operations/observability/log-event-schema.md).

See [Score Access Decision](../adr/0004-score-access-collaboration-and-guest-preview.md),
[Library and Imports](../product/library-and-imports.md) and
[Control-Plane Identity](control-plane-identity-contract.md).
