# Frontend Improvement Priorities

## Overview

This document summarizes the current frontend improvement priorities for `NoteVerse Pro`, based on a full review of the code under `frontend/src`.

The priorities are ordered by impact on:

1. Core user flow availability
2. User trust and product correctness
3. Product completeness
4. Engineering consistency and maintainability

## Priority Levels

- `P0`: Must fix first. Directly affects real functionality, correctness, or credibility in the main flow.
- `P1`: Important next. Improves completeness, experience, and production readiness.
- `P2`: Valuable follow-up. Improves consistency, cleanup, and long-term maintainability.

---

## P0

### 1. Fix share creation settings not actually taking effect

**Problem**

The results page defines share-related state such as permission and expiration, but the form controls are not actually bound to those states. As a result, share creation effectively uses defaults, and the permission value is not really applied.

**Why it matters**

This makes the share settings UI misleading. Users may think they are creating customized share links, while the system is ignoring their selections.

**Recommended work**

- Bind the permission and expiration `Select` components to state with `value` and `onValueChange`.
- Ensure the selected permission is included in the request payload if the backend supports it.
- Confirm the selected expiration value is the one sent to `sharesApi.createShare`.
- Add a quick validation pass after creating the link so the UI reflects the actual created share settings.

**Relevant files**

- [frontend/src/app/[locale]/results/[id]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/results/[id]/page.tsx#L90)
- [frontend/src/app/[locale]/results/[id]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/results/[id]/page.tsx#L233)
- [frontend/src/app/[locale]/results/[id]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/results/[id]/page.tsx#L606)

**Acceptance criteria**

- Changing permission affects the created share configuration.
- Changing expiration affects the created share configuration.
- The created share shown in history matches the selected options.

### 2. Enforce download permission in the share page UI

**Problem**

The share page reads `canDownload` from the response, but the download buttons remain available regardless of that value.

**Why it matters**

This creates a mismatch between backend rules and frontend behavior. Even if the backend blocks the download later, the UI still gives the wrong signal.

**Recommended work**

- Disable or hide download actions when `canDownload` is `false`.
- Show a clear explanatory message when downloads are not permitted.
- Keep backend enforcement as the source of truth, but make the frontend behavior consistent.

**Relevant files**

- [frontend/src/app/[locale]/share/[shareId]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/share/[shareId]/page.tsx#L54)
- [frontend/src/app/[locale]/share/[shareId]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/share/[shareId]/page.tsx#L390)

**Acceptance criteria**

- Users cannot trigger download actions when the share forbids downloads.
- The UI clearly communicates the restriction.

### 3. Fix profile page editing mismatch

**Problem**

The profile page allows editing the username in the UI, but the save logic only attempts to update email, while the email field is disabled.

**Why it matters**

This is a visible fake-editing issue. Users can type into the username field but get no real effect after saving.

**Recommended work**

- Align the editable fields with the submitted payload.
- If username/display name is intended to be editable, send it to the backend.
- If it is not intended to be editable yet, make the UI read-only for now.

**Relevant files**

- [frontend/src/app/[locale]/profile/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/profile/page.tsx#L108)
- [frontend/src/app/[locale]/profile/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/profile/page.tsx#L236)

**Acceptance criteria**

- Editing a profile field produces a real persisted change.
- The save button behavior matches what the form visibly allows the user to edit.

### 4. Clean up encoding issues and broken copy

**Problem**

There are visible encoding artifacts, garbled text, placeholder symbols, and non-final copy in several user-facing places.

**Why it matters**

This directly affects product quality perception and makes the interface feel unfinished.

**Recommended work**

- Audit the user-facing text for encoding corruption.
- Replace placeholder prices and broken symbols with proper localized strings.
- Move hardcoded UI strings into the i18n message files where appropriate.

**Relevant files**

- [frontend/src/components/layout/pill-nav.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/layout/pill-nav.tsx#L120)
- [frontend/src/app/[locale]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/page.tsx#L67)
- [frontend/src/app/[locale]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/page.tsx#L189)

**Acceptance criteria**

- No obvious garbled text appears in visible UI.
- Home and pricing copy reads as product-specific, not template-specific.

---

## P1

### 5. Add real route protection for authenticated pages

**Problem**

Protected pages mostly rely on API 401 responses and client-side redirect behavior rather than route-level access control.

**Why it matters**

This can produce a flash of inaccessible UI before redirecting, and it spreads auth behavior across pages and network failures rather than keeping it predictable.

**Recommended work**

- Add page-level or middleware-level route protection for authenticated routes.
- Define a clear protected route list such as `/upload`, `/history`, `/profile`, `/results`, `/editor`.
- Preserve `returnUrl` behavior when redirecting to login.

**Relevant files**

- [frontend/src/middleware.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/middleware.ts#L4)
- [frontend/src/lib/api-client.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/lib/api-client.ts#L116)
- [frontend/src/contexts/auth-context.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/contexts/auth-context.tsx)

**Acceptance criteria**

- Unauthenticated users cannot access protected pages directly.
- Redirects happen before protected content flashes on screen.

### 6. Move the practice page from prototype to usable feature

**Problem**

The practice page still uses mock AI analysis input and a placeholder score viewer area instead of real score rendering and real session analysis inputs.

**Why it matters**

This page appears to promise a complete feature, but key parts are still prototype-only.

**Recommended work**

- Feed the real MusicXML content into the analysis flow.
- Replace the placeholder score viewer with actual score rendering.
- Decide whether audio analysis is local, backend-assisted, or AI-only, then align the implementation.
- Add explicit “beta” labeling if the feature remains partial.

**Relevant files**

- [frontend/src/app/[locale]/practice/[id]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/practice/[id]/page.tsx#L168)
- [frontend/src/components/score-viewer.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/score-viewer.tsx#L40)

**Acceptance criteria**

- The practice page renders the real score.
- AI analysis is based on real session data or is clearly marked as a placeholder/beta.

### 7. Replace template copy and dead CTA behavior on home/pricing surfaces

**Problem**

The home page still contains template-like copy and dead links such as “View details” with `href="#"`.

**Why it matters**

These issues make the landing experience feel unfinished and reduce confidence in the product.

**Recommended work**

- Replace generic marketing copy with NoteVerse-specific messaging.
- Remove or implement dead links.
- Ensure pricing language matches actual subscription capabilities.

**Relevant files**

- [frontend/src/app/[locale]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/page.tsx#L189)
- [frontend/src/app/[locale]/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/page.tsx#L208)

**Acceptance criteria**

- No dead CTA remains on the homepage.
- Product messaging is consistent with actual features.

### 8. Consolidate password reset flow

**Problem**

`/forgot-password` already implements the real reset flow, while `/reset-password` remains a simulated page.

**Why it matters**

Keeping both creates maintenance confusion and makes the auth surface feel inconsistent.

**Recommended work**

- Remove the simulated page if it is no longer needed.
- Or redirect it into the real reset flow.
- Keep one canonical password reset experience.

**Relevant files**

- [frontend/src/app/[locale]/forgot-password/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/forgot-password/page.tsx)
- [frontend/src/app/[locale]/reset-password/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/reset-password/page.tsx#L46)

**Acceptance criteria**

- There is only one real password reset flow in the product.
- No auth page uses fake submission logic.

---

## P2

### 9. Connect subscriptions page to real billing/subscription state

**Problem**

The subscriptions page currently behaves like a local demo and changes plan state only in component state.

**Why it matters**

It is acceptable as a display page for now, but it should not remain disconnected if subscriptions are part of the product promise.

**Recommended work**

- Load the current plan from backend profile or billing state.
- Replace local-only plan switching with real purchase/upgrade flows.
- Reflect entitlements in the rest of the product where relevant.

**Relevant files**

- [frontend/src/app/[locale]/subscriptions/page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/subscriptions/page.tsx#L58)

**Acceptance criteria**

- The page displays real plan status.
- Upgrade actions lead to actual subscription handling.

### 10. Standardize loading, empty, and error states

**Problem**

Many pages implement these states independently. The visual direction is similar, but the implementation is repetitive and uneven.

**Why it matters**

This increases maintenance cost and creates subtle UX inconsistency across the app.

**Recommended work**

- Extract shared patterns for loading sections, empty states, and recoverable error states.
- Standardize copy tone and action affordances.

**Acceptance criteria**

- Similar system states feel consistent across upload, history, review, results, editor, and share pages.

### 11. Review image/blob lifecycle and heavy page resource handling

**Problem**

Several pages load many preview images and create blob URLs. Some cleanup exists, but the overall approach could still be tightened.

**Why it matters**

This becomes more important with large scores, long sessions, and history browsing over time.

**Recommended work**

- Audit blob URL cleanup paths.
- Consider lazy loading for large image sets.
- Avoid unnecessary duplicate fetches for the same task assets.

**Acceptance criteria**

- Large multi-page scores remain responsive.
- Blob URLs are consistently revoked when no longer needed.

### 12. Remove leftover starter/demo artifacts

**Problem**

Some files still look like bootstrap leftovers or temporary dev scaffolding.

**Why it matters**

This is mostly an engineering cleanliness issue, but it affects onboarding and future maintenance.

**Recommended work**

- Replace the generic frontend README with project-specific setup docs.
- Review and remove temporary API/demo files if they are no longer used.
- Keep docs aligned with the actual architecture.

**Relevant files**

- [frontend/README.md](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/README.md)
- [frontend/src/app/api/score/[id]/route.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/api/score/[id]/route.ts)

**Acceptance criteria**

- No obvious starter residue remains in the frontend app.
- Local docs describe the real project, not the scaffold it started from.

---

## Suggested Execution Order

1. Complete all `P0` items first to protect the core user flow and remove misleading UI behavior.
2. Tackle `P1` next to improve production readiness and feature completeness.
3. Reserve `P2` for cleanup, standardization, and longer-term maintainability work.

## Recommended First Implementation Batch

If starting immediately, the most practical first batch is:

1. Fix share creation form binding and request payloads
2. Enforce share-page download permissions in the UI
3. Fix profile update field mismatch
4. Clean visible encoding and copy issues

This batch gives the best payoff for user-facing correctness with a relatively contained frontend change set.
