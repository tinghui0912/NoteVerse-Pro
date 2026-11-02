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
necessarily discloses exact machine-readable PracticeSource to that trusted browser.
EDITOR can also edit, requiring revision MusicXML and original editing inputs in its
browser. These disclosures are not DRM. Only the owner can use explicit MusicXML,
render-page/archive download and download access-URL actions. Members cannot manage
members or Guest Previews.

Revision content, history, revision mutation and raw input material require EDIT.
Viewer/Practitioner read models contain no source metadata or raw input identifiers.
Authenticated generated playback requires PRACTICE. Presentation image viewing is
inline VIEW access, separate from DOWNLOAD. Score membership confers no visibility
into another user's personal practice data.

ScoreGuestPreviewGrant is a separate bearer presentation authority. Only the owner
creates it. Creation pins the resolved current ScoreRevision; later head changes do
not change its contents. A composite foreign key binds that revision to the Score.
The grant expires within 30 days (default seven), is revocable one-way, and is removed
with its Score/revision. Persistence stores a unique token hash. Only creation
returns the high-entropy raw token; lists and logs never disclose it.

## Presentation boundary

Guest Preview serves only exact-revision rendered page images inline and generated
audio for listening. Missing assets remain unavailable; another revision is never a
fallback. Active previews protect their pinned presentation assets from historical
asset cleanup; expired or revoked previews do not. Score deletion remains authoritative.
The bearer response has no source metadata or generic Score capabilities.

Guest Preview cannot deliver MusicXML, practice, edit, offer image/archive downloads,
bookmark, redeem, create membership, or grant persistent authenticated Score access.
Ambient login does not strengthen the bearer channel. The page has no account
actions and uses noindex, nofollow and noarchive. Token-bearing delivery is private,
no-store. Images can still be copied by browsers; this is not DRM.

Collaboration Invite is the authenticated membership entrance. It is independent of
Guest Preview and of any future personal practice sharing authorization.
