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

ScoreInvite stores optional terminal outcome/time and nullable human attribution.
Human outcomes are ACCEPTED, DECLINED and REVOKED; system closure outcomes are
RECIPIENT_ACCOUNT_CLOSED and INVITER_ACCOUNT_CLOSED. Closed invitation contact and
credential hashes are NULL, with no fabricated system actor. Pending status derives
from expiry and requires usable contact/credential facts and a live creator at
admission. New invitations default to the configured seven-day lifetime.
Collaboration responses lock the active Score, then Invite and creator/recipient User
admission; acceptance and membership changes commit atomically. A Score tombstone ends
child authority immediately. Pending collections omit inactive parents/creators.
Account Closure and final erasure preserve foreign-owner history and use the exact
cutoff and lock rules in the canonical
[Collaboration retention contract](../architecture/business-resource-lifecycle.md#account-closure-and-collaboration-retention).
Revoke retries preserve the recorded terminal time and actor until attribution erasure.
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

Customer and operator sessions have separate identities, cookies, origin policies and authorization
policies. Structured logs follow the default-deny
[log schema](../operations/observability/log-event-schema.md).

See [Score Access Decision](../adr/0004-score-access-collaboration-and-guest-preview.md),
[Library and Imports](../product/library-and-imports.md) and
[Control-Plane Identity](control-plane-identity-contract.md).
