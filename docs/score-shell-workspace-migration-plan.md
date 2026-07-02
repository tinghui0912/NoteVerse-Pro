# Score Shell Workspace Migration Plan

> Superseded note (2026-07-02): Review is no longer a Score workspace. The active model is
> `Upload -> ProcessingJob -> /review/:jobId -> confirm -> /score/:scoreId`.
> Keep this document as historical context for the Score shell/view/edit/practice workspaces
> only. Do not use its `/score/:id/review` references as current architecture.

## Goal

Converge score-related product surfaces into a single Score resource model with workspace routes:

```text
/score/:id
/score/:id/review
/score/:id/edit
/score/:id/practice
/score/:id/practice/performance
```

The goal is not to put every feature into one giant React component. The goal is to make Score the only product resource identity, with editor and practice treated as workspaces under the Score route.

## Current State

Current frontend route shape:

```text
/score/:id
/score/:id/review
/score/:id/edit
/score/:id/practice
/score/:id/practice/performance
/share/:token
/public/:slug
```

Current status:

- `Score` is the product route family.
- `Review`, `Editor`, and `Practice` are Score workspaces under `/score/:id/...`.
- `/share/:token` and `/public/:slug` are access-entry routes that reuse Score viewing/player UI.
- `ScoreShell` owns shared visual framing and now provides score capabilities through context.
- Feature folders such as `components/editor`, `components/review`, and `components/practice` remain as workspace implementation boundaries. They are not route-level product resources.
- `/invite/:token` is an implemented access-entry route.

## Target Architecture

### Resource

```text
Score
```

### Workspace Routes

```text
/score/:id                  view workspace
/score/:id/review           review workspace
/score/:id/edit             edit workspace
/score/:id/practice         practice workspace
/score/:id/practice/performance
```

### Access Entry Routes

```text
/share/:token               share-token access context, reuses score viewing/player UI
/public/:slug               public publication access context, reuses score viewing/player UI
/invite/:token              invite acceptance entry, redirects to /score/:id after membership is created
```

Share, public publication, and invite are access entries. They are not independent Score product surfaces.

## Design Principles

1. `Score` is the single product resource identity.
2. `Review`, `Editor`, and `Practice` are workspaces, not separate product resources.
3. Workspace routes may have independent URLs and local providers.
4. Do not lift heavy editor state into the global Score shell.
5. Capabilities remain the permission truth. UI mode is derived from capabilities.
6. Since the project is in development, do not keep long-term compatibility redirects for old `/editor/:id` or `/practice/:id` routes.

## Target File Structure

```text
frontend/src/app/[locale]/score/[id]/
  page.tsx
  review/
    page.tsx
  edit/
    page.tsx
    loading.tsx
    error.tsx
  practice/
    page.tsx
    performance/
      page.tsx

frontend/src/components/score-shell/
  score-shell.tsx

frontend/src/components/score-detail/
  current score detail components

frontend/src/components/editor/
  editor workspace components

frontend/src/components/practice/
  practice workspace components
```

## Migration Steps

### Step 1: Introduce Score Shell

Create a lightweight `ScoreShell` component that owns shared visual framing and score access context:

- page background
- optional hero/title area
- optional footer
- workspace container
- `ScoreCapabilities` context

It should not own:

- editor history
- editor draft state
- editor selected entity
- practice websocket state
- practice recording state

Workspace-local providers stay local. Shared score capabilities are passed once to `ScoreShell` and read by child components through `useScoreShell()`.

### Step 2: Keep `/score/:id` as View Workspace

Keep the existing score detail page behavior under `/score/:id`.

The page can gradually be rewritten to:

```tsx
<ScoreShell workspace="view">
  <ScoreViewWorkspace />
</ScoreShell>
```

This can be incremental because `/score/:id` is already the correct route.

### Step 2.5: Migrate Review Route

Move:

```text
frontend/src/app/[locale]/review/[id]/page.tsx
```

to:

```text
frontend/src/app/[locale]/score/[id]/review/page.tsx
```

Reason: the current review page receives a `scoreId`, loads `ScoreDetail`, loads the score head revision, uses `score.originating_job_id` only to display source artifacts, and approves the score through `POST /scores/:id/approve`. It is therefore a Score lifecycle workspace, not a pre-score import/job staging route.

Update generated links:

```text
/review/:id -> /score/:id/review
```

Do not use `/score/:id/review` for any future flow where the Score entity does not exist yet. Pre-score review should live under an import/job route.

### Step 3: Migrate Editor Route

Move:

```text
frontend/src/app/[locale]/editor/[id]/page.tsx
```

to:

```text
frontend/src/app/[locale]/score/[id]/edit/page.tsx
```

Move editor-specific route files:

```text
editor/[id]/loading.tsx -> score/[id]/edit/loading.tsx
editor/[id]/error.tsx   -> score/[id]/edit/error.tsx
```

The edit page should still wrap the workspace with `EditorProvider` locally:

```tsx
<EditorProvider>
  <EditorPageContent />
</EditorProvider>
```

Do not move `EditorProvider` into the view workspace.

### Step 4: Migrate Practice Route

Move:

```text
frontend/src/app/[locale]/practice/[id]/page.tsx
frontend/src/app/[locale]/practice/[id]/performance/page.tsx
```

to:

```text
frontend/src/app/[locale]/score/[id]/practice/page.tsx
frontend/src/app/[locale]/score/[id]/practice/performance/page.tsx
```

Update internal report navigation:

```text
/practice/:id/performance?sessionId=...
```

to:

```text
/score/:id/practice/performance?sessionId=...
```

### Step 5: Update Product Links

Replace:

```text
/editor/:id   -> /score/:id/edit
/practice/:id -> /score/:id/practice
```

Known locations:

- `frontend/src/components/score-detail/score-actions.tsx`
- `frontend/src/components/share/share-info-sidebar.tsx`
- `frontend/src/app/[locale]/review/[id]/page.tsx`
- tests

### Step 6: Update Auth Protection

In `frontend/src/proxy.ts`:

- remove `/editor`
- remove `/practice`
- keep `/score`

API routes under `/api/v1/practice/*` are backend API routes and should not be renamed.

### Step 7: Delete Old Route Groups

After new routes and links pass validation, delete:

```text
frontend/src/app/[locale]/editor
frontend/src/app/[locale]/practice
```

Do not keep compatibility redirects during the development-stage clean cut.

### Step 8: Update Tests

Update path assertions and source reads:

- `/editor/:id` -> `/score/:id/edit`
- `/practice/:id` -> `/score/:id/practice`
- `src/app/[locale]/editor/[id]/page.tsx` -> `src/app/[locale]/score/[id]/edit/page.tsx`

### Step 9: Validate

Run:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- verovio-surface-migration
```

Manual checks:

```text
/score/:id
/score/:id/review
/score/:id/edit
/score/:id/practice
/score/:id/practice/performance?sessionId=...
/share/:token
/public/:slug
review -> edit
score review -> edit with returnUrl=/score/:id/review
score detail -> edit
score detail -> practice
share -> practice with shareToken
public -> practice with publicSlug
```

## Execution Status

Completed in this migration pass:

- Created `frontend/src/components/score-shell/score-shell.tsx`.
- Kept `/score/:id` as the view workspace and wrapped it with `ScoreShell`.
- Moved the editor workspace to `/score/:id/edit`.
- Moved the practice workspace to `/score/:id/practice`.
- Moved the practice performance report to `/score/:id/practice/performance`.
- Updated score, review, and share links to point at the new workspace routes.
- Updated `frontend/src/proxy.ts` so `/score` is the protected Score route family.
- Removed the old frontend route groups:
  - `frontend/src/app/[locale]/editor`
  - `frontend/src/app/[locale]/practice`
- Updated migration assertions for the new editor route path.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- verovio-surface-migration
```

Completed in the capabilities pass:

- Added `frontend/src/lib/score-shell/capabilities.ts`.
- Reused backend `ScoreCapabilities` as the Score Shell capability model.
- Made Score detail actions capability-driven:
  - `can_download` controls download actions.
  - `can_practice` controls the practice workspace entry.
  - `can_edit` controls the edit workspace entry.
  - `can_manage_sharing` controls share dialog access.
  - `can_publish` controls publish/unpublish access.
- Made score title and style tag editing read-only when `can_edit` is false.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
```

Completed in the workspace guard pass:

- Added `frontend/src/components/score-shell/workspace-access-denied.tsx`.
- Exposed score capabilities from `useEditorDocument`.
- Added a direct-access guard for `/score/:id/edit` using `can_edit`.
- Added a direct-access guard for `/score/:id/practice` using `can_practice`.
- Prevented practice preconnection/session preparation when direct score access lacks `can_practice`.
- Added localized access-denied messages for edit and practice workspaces.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
```

Completed in the share access entry pass:

- Kept `/share/:token` as an access-entry URL.
- Wrapped the share access page with `ScoreShell`.
- Made share action/sidebar behavior use `ScoreCapabilities` through `resolveScoreShellCapabilities`.
- Kept practice entry from share as `/score/:id/practice?shareToken=:token`.
- Removed the unused legacy `frontend/src/components/share/share-actions.tsx`.
- Updated migration tests to assert the share page uses `ScoreShell`, `ShareScorePlayer`, and shared capability resolution.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- verovio-surface-migration
```

Completed in the public access entry pass:

- Kept `/public/:slug` as a public publication access-entry URL.
- Wrapped the public score page with `ScoreShell`.
- Reused `ScorePlayer` as the public score playback surface.
- Made public page actions use `ScoreCapabilities` through `resolveScoreShellCapabilities`.
- Added public practice entry as `/score/:id/practice?publicSlug=:slug`.
- Kept public artifact downloads on publication APIs because `useDownload` currently supports owner score and grant modes only.
- Updated migration tests to assert public score access uses `ScoreShell` and shared capability resolution.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- verovio-surface-migration
```

Completed in the route semantics cleanup pass:

- Updated `docs/library-domain-implementation-plan.md` current return-origin examples from `/results/:id` to `/score/:id`.
- Added `/public/:slug` to the Score Shell access-entry model.
- Removed the stale `share-actions` entry from planned product-link update locations.
- Rechecked current code, tests, and messages for old `/results`, standalone `/editor`, standalone `/practice`, and deleted `share-actions` references.
- Kept historical migration references in migration-plan documents where they describe the source state or clean-cut rationale.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- verovio-surface-migration
```

Completed in the regression guard pass:

- Added `frontend/tests/unit/score-workspace-routes.test.ts`.
- The test guards that:
  - `/score/:id`, `/score/:id/edit`, `/score/:id/practice`, and practice performance routes exist.
  - old `/results`, standalone `/editor`, and standalone `/practice` route groups do not exist.
  - `proxy.ts` protects `/score` and no longer protects old standalone route families.
  - score detail, review, share, and public access entries route into Score workspaces.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- score-workspace-routes
npm run test:unit -- verovio-surface-migration
npm run test:e2e -- score-layout.spec.ts public-and-auth.spec.ts share-permissions.spec.ts
```

Completed in the review workspace pass:

- Moved `/review/:id` to `/score/:id/review`.
- Wrapped the review workspace with `ScoreShell`.
- Added a direct-access guard for `/score/:id/review` using `can_approve`.
- Removed the standalone review route group.
- Updated pending-review upload and My Scores navigation to `/score/:id/review`.
- Updated editor return URL from review to `/score/:id/review`.
- Removed `/review` from `frontend/src/proxy.ts` because `/score` protects the workspace family.
- Updated route regression tests to guard the review workspace route.

Validation completed:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- score-workspace-routes
npm run test:unit -- upload-workflow
```

Completed in the semantic cleanup and shell context pass:

- Removed unused legacy `frontend/src/contexts/share-context.tsx`.
- Removed obsolete `tasks`, `xml`, and legacy `shares` query key factories from `frontend/src/lib/query-client.ts`.
- Updated query key tests to cover current Score-domain cache identity.
- Added `ScoreShell` context and `useScoreShell()`.
- Moved Score detail action permissions, score metadata editability, score style tag editability, and share sidebar permissions to the shared Score Shell capability context.
- Updated the current-state section of this migration plan so it describes the post-migration route model instead of the pre-migration route model.

Validation completed:

```bash
cd frontend
npm run typecheck
```

## Non-Goals

- Do not redesign the editor UI in this migration.
- Do not rewrite practice internals.
- Do not merge `EditorProvider` into the Score view page.
- Do not rename backend practice API routes.
- Do not add old-route compatibility redirects.
