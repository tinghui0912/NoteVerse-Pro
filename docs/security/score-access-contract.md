# Score Access and Secret Boundaries

ScoreAccessPolicy evaluates authenticated actions against owner and active membership
facts. Library organization grants no access. Owner/member endpoints enforce their
actions server-side; UI capability flags do not replace authorization.

Active Score authority also requires its owner User to be outside account deletion.
An owner tombstone cuts authenticated, Invite and Guest Preview authority before graph
cleanup; see [Account resource erasure](../architecture/business-resource-lifecycle.md#account-deletion).

`resolve_score` / `authorize_score` return Score access without resolving a Revision.
`resolve_revision` / `authorize_revision` explicitly select the current head or requested
same-Score revision. `score_access.roles` owns role strength and capabilities.
Collaboration's InvitationService owns invitations; MembershipService owns current members.
Collection projections bulk-hydrate user, avatar and Score facts with bounded queries.

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
perform no IO or commits. Collaboration mutations lock the active Score parent first,
then Invite and Membership when both participate. Acceptance commits its outcome and
membership admission atomically. A Score tombstone immediately ends child active
authority; pending collections omit that parent and token commands cannot act on it.
Revoke retries preserve the recorded terminal time and actor.
Owner member removal and Self Leave change current membership access without
rewriting invitation history. Only explicit acceptance of a new valid Invite can
reactivate revoked membership; owner role PATCH cannot restore it.
Member collections contain active memberships only. Remove and leave return bodyless
204 responses and preserve the first revocation instant on retry. Invitations require
a target email; owners cannot invite themselves.

## Guest Preview

Guest Preview is a separate anonymous, presentation-only bearer channel. An independent
`GuestPreviewCredential` row stores the token hash; Score stores no raw secret. Owner
issue/rotate commands reveal plaintext once. Revoke deletes the credential; re-enable
issues a fresh credential. Settings contain enabled
state and issue time, not a recoverable token. See the canonical
[credential lifecycle](../adr/0004-score-access-collaboration-and-guest-preview.md).

Every bearer request requires a valid credential and an active Score, then resolves
its current head.
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
