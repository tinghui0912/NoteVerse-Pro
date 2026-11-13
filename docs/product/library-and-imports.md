# Library And Imports

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

## Score Lifecycle

Created by me is the owner lifecycle scope. It provides single and batch Score
deletion. All, Favorites, and folders provide only personal organization bulk
actions; Shared with me does not grant owner deletion. Score Detail also provides
Delete score when the current access capabilities allow it. Deletion hides the
resource immediately and uses the durable ScoreDeletionOperation cleanup flow.

Every collaborator role can Leave score from Score Detail or a single card in
Shared with me without a folder filter. Owners cannot leave ownership. Other
Library scopes and all bulk toolbars provide no Leave action. Leave revokes only
the user's ScoreMembership and preserves personal organization and practice data.
The Score disappears from all Library views and counts until a new valid Invite
is explicitly accepted. Owner role PATCH cannot reactivate revoked membership.

## Upload And Import Activity

Upload is the global creation action. The Upload page contains the upload form
and paginated Import Activity. Import Jobs are processing records, not Library
Scores. Queued and running jobs show progress without cancellation actions.
Pending review jobs open Review. Failed jobs offer backend Retry.
Delete import is allowed only for PENDING_REVIEW and FAILURE, with state admission
checked under the Dispatch then Job locks. Queued/running imports cannot be deleted
because cancellation is not implemented. Confirmed import history is retained and
links to its formal Score. Internal binary cleanup retains the confirmed Job and
Score provenance. Only active jobs keep the list polling.

## Access Authority

[Score access policy](../adr/0004-score-access-collaboration-and-guest-preview.md)
defines authorization. Collaboration grants do not transfer Score ownership or
storage-quota responsibility. Guest Preview remains explicit link sharing.
