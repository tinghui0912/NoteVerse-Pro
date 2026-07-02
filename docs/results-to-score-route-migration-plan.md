# /results to /score Migration Plan

Status: Historical / Completed

This document records the route migration from `/results/:id` to `/score/:id`.
It predates the later Review Pipeline migration. Do not use any review-route
examples in this file as current architecture; current OCR review lives under
`/review/:jobId` and only confirmed Scores live under `/score/:scoreId`.

## Goal

Rename the product-facing score detail experience from `/results/:id` to `/score/:id`.

The product meaning has changed: this page is no longer just an OMR processing result. It is the long-lived score detail surface for playback, metadata, sharing, downloading, style tags, practice entry, and editor entry.

Because the project is still in active development, this migration should prefer a clean cut over long-term compatibility layers.

## Current State

### Route

- Current page: `frontend/src/app/[locale]/results/[id]/page.tsx`
- Current protected path: `/results` in `frontend/src/proxy.ts`
- Current navigation targets:
  - Upload completion: `frontend/src/components/upload/upload-types.ts`
  - Review approval: `frontend/src/hooks/review/use-review-page-data.ts`
  - Editor save fallback: `frontend/src/hooks/editor/use-editor-document.ts`
  - Library open score: `frontend/src/app/[locale]/library/page.tsx`
  - My Scores open score: `frontend/src/app/[locale]/my-scores/page.tsx`

### Components

Current score detail components live under:

- `frontend/src/components/results/`

Important files:

- `results-actions.tsx`
- `results-breadcrumbs.tsx`
- `results-metadata-editor.tsx`
- `results-playback-dock.tsx`
- `results-score-player.tsx`
- `results-share-dialog.tsx`
- `results-style-tags-editor.tsx`

These components are also reused by public/share pages:

- `frontend/src/components/public/public-score-page.tsx`
- `frontend/src/components/share/share-score-player.tsx`

### Hooks and Libs

- `frontend/src/hooks/results/use-results-resources.ts`
- `frontend/src/lib/results/navigation.ts`
- `frontend/src/lib/results/share.ts`

### I18n

Current namespaces:

- `results`
- `resultsShare`

Registered in:

- `frontend/src/i18n/request.ts`

Current Chinese copy already says `乐谱详情`, so the user-facing wording is mostly aligned with the new `/score` concept. The code namespace is the part that is still semantically stale.

## Target State

### Route

- New page: `frontend/src/app/[locale]/score/[id]/page.tsx`
- Remove: `frontend/src/app/[locale]/results/[id]/page.tsx`
- Protected path changes from `/results` to `/score`.

No long-lived `/results` redirect is required for MVP because the project is still under development. If a short development-only redirect is needed during manual testing, keep it out of the final migration.

### Components

Move and rename:

```text
frontend/src/components/results/
frontend/src/components/score-detail/
```

Recommended file/class mapping:

```text
ResultsActions              -> ScoreActions
ResultsBreadcrumbs          -> ScoreBreadcrumbs
ResultsMetadataEditor       -> ScoreMetadataEditor
ResultsPlaybackDock         -> ScorePlaybackDock
ResultsScorePlayer          -> ScorePlayer
ResultsShareDialog          -> ScoreShareDialog
ResultsStyleTagsEditor      -> ScoreStyleTagsEditor
```

Reason: avoid overloading `components/score/`, which already contains lower-level score/player primitives. `score-detail` clearly means the product page.

### Hooks and Libs

Move and rename:

```text
frontend/src/hooks/results/use-results-resources.ts
frontend/src/hooks/score-detail/use-score-detail-resources.ts

frontend/src/lib/results/navigation.ts
frontend/src/lib/score-detail/navigation.ts

frontend/src/lib/results/share.ts
frontend/src/lib/score-detail/share.ts
```

Recommended exported names:

```text
useResultsResources         -> useScoreDetailResources
ResultsLibrarySource        -> ScoreDetailSource
parseResultsLibrarySource   -> parseScoreDetailSource
ResultsShareStatus          -> ScoreShareStatus
getResultsShareStatus       -> getScoreShareStatus
```

### I18n

Rename namespaces:

```text
results      -> score
resultsShare -> scoreShare
```

Move files:

```text
frontend/messages/zh/results.json      -> frontend/messages/zh/score.json
frontend/messages/en/results.json      -> frontend/messages/en/score.json
frontend/messages/zh/resultsShare.json -> frontend/messages/zh/scoreShare.json
frontend/messages/en/resultsShare.json -> frontend/messages/en/scoreShare.json
```

Update `frontend/src/i18n/request.ts` namespaces accordingly.

Update `useTranslations('results')` to `useTranslations('score')`.
Update `useTranslations('resultsShare')` to `useTranslations('scoreShare')`.

## Migration Steps

### Step 1: Rename Route

1. Create `frontend/src/app/[locale]/score/[id]/page.tsx` from the current results page.
2. Rename component functions:
   - `ResultsPageContent` -> `ScorePageContent`
   - `ResultsPageWithProvider` -> `ScorePageWithProvider`
3. Update imports to the new component/hook/lib paths.
4. Delete `frontend/src/app/[locale]/results/[id]/page.tsx`.

### Step 2: Rename Components

1. Create `frontend/src/components/score-detail/`.
2. Move each `components/results/*` file into `components/score-detail/`.
3. Rename component symbols from `Results*` to `Score*`.
4. Update cross-imports:
   - `ScoreActions` imports `ScoreShareDialog`
   - `ScorePlayer` imports `ScorePlaybackDock`
5. Update external consumers:
   - public score page
   - share score player

### Step 3: Rename Hook and Lib Modules

1. Create `frontend/src/hooks/score-detail/use-score-detail-resources.ts`.
2. Move logic from `useResultsResources`.
3. Rename exported hook to `useScoreDetailResources`.
4. Create `frontend/src/lib/score-detail/navigation.ts`.
5. Create `frontend/src/lib/score-detail/share.ts`.
6. Delete the old `hooks/results` and `lib/results` files after imports are updated.

### Step 4: Rename I18n Namespaces

1. Move message files from `results*.json` to `score*.json`.
2. Update `frontend/src/i18n/request.ts`.
3. Update every `useTranslations('results')`.
4. Update every `useTranslations('resultsShare')`.
5. Keep translation keys stable unless the wording itself is wrong. This keeps the migration focused on semantic ownership, not copywriting.

### Step 5: Update Navigation Targets

Update all product navigation from `/results/${scoreId}` to `/score/${scoreId}`:

- `frontend/src/components/upload/upload-types.ts`
- `frontend/src/hooks/review/use-review-page-data.ts`
- `frontend/src/hooks/editor/use-editor-document.ts`
- `frontend/src/app/[locale]/library/page.tsx`
- `frontend/src/app/[locale]/my-scores/page.tsx`

Keep query parameters such as `?from=my-scores` intact.

### Step 6: Update Auth Protection

In `frontend/src/proxy.ts`:

- Remove `/results`
- Add `/score`

### Step 7: Search Cleanup

Run:

```bash
rg "results|Results|resultsShare|/results|useResults|parseResults|ResultsLibrarySource" frontend/src frontend/messages
```

Expected remaining matches should be zero, except unrelated local variable names where `results` means generic array results. Those should be reviewed case by case.

### Step 8: Validation

Run:

```bash
cd frontend
npm run typecheck
npm run lint
```

Manual route checks:

```text
/score/:id
/score/:id?from=my-scores
/library -> open score
/my-scores -> open score
/score/:id/review -> approve -> /score/:id
/editor/:id -> save -> /score/:id
```

Also verify public/share pages still render because they reuse the renamed score player/dock components.

## Non-Goals

- Do not add a permanent `/results` redirect.
- Do not keep duplicate `Results*` component aliases.
- Do not keep both `results` and `score` i18n namespaces.
- Do not change backend API routes. Backend remains REST-style plural:

```text
/api/v1/scores/:id
```

Frontend page route and backend API route do not need identical naming.

## Risk Notes

1. Public/share pages reuse `ResultsScorePlayer` and `ResultsPlaybackDock`. These imports must be updated even though their routes are not changing.
2. `results` can appear as a generic local variable name, especially in upload/file utilities. Do not rename those mechanically unless they refer to the product page.
3. `returnUrl` values passed into editor may still contain old `/results` URLs if generated before the migration. Since this is a clean development-stage migration, do not add compatibility code unless a current UI path still produces old URLs after the migration.
4. Browser bookmarks to `/results/:id` will break after the clean cut. This is acceptable for the current development stage.

## Suggested Execution Order

1. Route and component rename.
2. Hook/lib rename.
3. I18n namespace rename.
4. Navigation target update.
5. Auth path update.
6. Global search cleanup.
7. Typecheck and lint.
