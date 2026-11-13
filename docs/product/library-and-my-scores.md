# Library And My Scores

## Library

Library contains active Scores the current user owns or has an active collaboration
membership on. Ownership and membership grant access through ScoreAccessPolicy.
Pending invitations and Guest Preview links do not add Scores to this workspace.
Revoked memberships and deleted Scores are excluded from every view and count.

Library views are All, Created by me, Shared with me, and Favorites. Folder,
search, sort, and page filters organize this accessible collection. Updated
sorting and displayed timestamps refer to the Score.

Personal organization stores only folders and favorites. Its row is optional:
an accessible Score appears without one. Organization never grants access.
There is no Saved/Bookmark membership, Library practice state, or Library Trash.
Practice activity does not modify Library organization.

Folders are flat and user-owned, with unique names per user. A Score may be
unfiled at Library root or assigned to one folder. Both owned and shared Scores
can be organized. Deleting a folder returns its Scores to Library root; it does
not delete Scores or change ownership, membership, permissions, or storage ownership.
Favorites can be set and cleared independently of access.

A Score owns an ordered unique list of known genre codes. It may have zero or
more genres from the current vocabulary, with no numeric genre-count limit.
Library and Review display the Score's genres.

## My Scores

`/my-scores` displays owned Scores and import/review jobs through All works,
Processing, Pending review, and Failed views. Search, sorting, and pagination
apply to owned Scores. Bulk deletion operates on selected owned Scores and
eligible import jobs.

Score deletion is an owner action. It hides the resource through `Score.deleted_at`
and atomically creates a `ScoreDeletionOperation` for asynchronous cleanup, with
immediate best-effort dispatch and maintenance recovery.

## Access Authority

[Score access policy](../adr/0004-score-access-collaboration-and-guest-preview.md)
defines authorization. Collaboration grants do not transfer Score ownership or
storage-quota responsibility. Guest Preview remains explicit link sharing.
