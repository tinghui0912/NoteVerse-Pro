# Library And My Scores

This document is the current product-facing summary for the two score
management surfaces.

## Product Split

`/library` is the learner's personal library:

- saved and accessible scores;
- folders and learning views;
- favorite, practice, and remove-from-library actions;
- does not imply score ownership.

`/my-scores` is the creator workspace:

- scores owned by the current user;
- import/review state;
- publish, share, collaboration, edit, delete, and restore-oriented actions;
- owner-level lifecycle management.

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

## Current Source Of Truth

- Architecture decisions: `../adr/`
- Historical implementation details:
  `../archive/completed-migrations/library-domain-implementation-plan.md`

