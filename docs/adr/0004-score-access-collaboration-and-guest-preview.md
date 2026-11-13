# ADR 0004: Score Access, Collaboration And Guest Preview

- Status: Accepted
- Date: 2026-11-02
- Scope: score-domain authorization

## Decision

Authenticated Score access has two origins: OWNER and MEMBERSHIP. Guest Preview
is a separate presentation-only bearer authority.
There is no public score publication channel. ScoreLibraryEntry organizes a user's
library and does not grant access.

ScoreAccessPolicy authorizes authenticated owner/member operations. The owner can
view, edit, delete, download, practice and manage members and Guest Previews.
Membership roles are VIEWER, PRACTITIONER and EDITOR, ranked 1, 2 and 3.
Invites default to VIEWER. Accepting a stronger invite upgrades membership; a weaker
invite does not downgrade it. Owner member-management commands can explicitly change
roles in either direction. Revocation immediately removes subsequent access.

VIEWER can view rendered presentation only. PRACTITIONER can also practice, which
necessarily discloses exact machine-readable PracticeBundle to that trusted browser.
EDITOR can also edit, requiring revision MusicXML and original editing inputs in its
browser. These disclosures are not DRM. Only the owner can use explicit MusicXML,
render-page/archive download and download access-URL actions. Members cannot manage
members or Guest Previews.

Revision content, history, revision mutation and raw input material require EDIT.
Viewer/Practitioner read models contain no source metadata or raw input identifiers.
Authenticated generated playback requires PRACTICE. Presentation image viewing is
inline VIEW access, separate from DOWNLOAD. Score membership confers no visibility
into another user's personal practice data.

Each Score owns one cryptographically random, stable Guest Preview token and an enabled
flag. Only the owner can read the link or enable/disable access. Disabling and
re-enabling preserve the same token. The token is persisted on Score and is excluded
from generic Score responses and logs. Guest Preview has no expiry, revision pin or
link history.

## Presentation boundary

Guest Preview resolves the current Score head on every read, image and playback
request. It serves only that head's rendered pages inline and generated audio for
listening. Missing current-head assets remain unavailable; another revision is never
a fallback. A page identifier obtained before a head change cannot deliver the old
revision. Shared attribution comes from the Score owner. The response contains no
revision identity, source metadata or generic Score capabilities.

Only the current Score head is normal durable presentation demand and is protected
by derived-asset retention. Guest Preview does not dispatch work or retain historical
Render/Playback assets. Workers check presentation demand under the Score lock after
physical generation and before semantic adoption. Work superseded by a head change
becomes SUPERSEDED; unadopted writes remain under ObjectWriteIntent cleanup. Canonical
revision history and sources remain intact.

Guest Preview cannot deliver MusicXML, practice, edit, offer image/archive downloads,
bookmark, redeem, create membership, or grant persistent authenticated Score access.
Ambient login does not strengthen the bearer channel. The page has no account
actions and uses noindex, nofollow and noarchive. Token-bearing delivery is private,
no-store. Images can still be copied by browsers; this is not DRM.

Collaboration Invite is the authenticated membership entrance. It is independent of
Guest Preview and of any future personal practice sharing authorization.
