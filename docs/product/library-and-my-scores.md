# Library And My Scores

This document is the current product-facing summary for the two score
management surfaces.

A Score owns an ordered unique list of known genre codes. It may have zero or
more genres selected from the current vocabulary, with no numeric genre-count
limit. Library and Review display the Score's genres.

## Product Split

`/library` is the learner's personal library:

- saved and accessible scores;
- folders and learning views;
- favorite, practice, and remove-from-library actions;
- does not imply score ownership.

Library folders are a flat, user-owned organization layer. A score entry is
either unfiled at Library root or assigned to one folder. Folders cannot contain
folders. Active folder names are unique within a user's Library. Deleting a
folder either moves its entries to Library root or moves them to Trash.

`/my-scores` is the creator workspace:

- scores owned by the current user;
- import/review state;
- Guest Preview, collaboration, edit, delete, and restore-oriented actions;
- owner-level lifecycle management.

My Scores exposes All works, Processing, Pending review and Failed views. The client
reads these workflow filters from the current URL. The owned-score API accepts
page, page_size, search and sort; workflow views select which import jobs and owned
scores the browser presents. Bulk actions add owned scores to the library or delete
selected scores/jobs.

## Deletion Semantics

Library removal only removes the user's library entry. It does not delete the
underlying score.

My Scores deletion is an owner action. It hides the score from user-facing
surfaces immediately and delegates durable cleanup to the backend lifecycle
model.

## Collaboration Semantics

A collaborator can edit a score but does not become the storage-quota owner.
Score ownership, billing/quota attribution, and destructive lifecycle actions
remain tied to the owning user unless the product later introduces ownership
transfer.

## Authority

[Score access policy](../adr/0004-score-access-collaboration-and-guest-preview.md) defines authorization.
Library entries organize access without granting it.
