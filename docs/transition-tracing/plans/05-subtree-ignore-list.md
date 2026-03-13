# Plan 05: Subtree Ignore List

## Problem Statement

When tracing a transition, all Suspense boundaries contribute to completion criteria. Some boundaries represent independent loading states that should be excluded. The RFC lists a Suspense ignore list on `startTransition` as a "Future Goal."

---

## Current Workaround

The workaround uses Suspense `name` props + `onMarkerProgress` callback filtering:

1. Name Suspense boundaries consistently with transitions
2. In `onMarkerProgress`, check if remaining `pending` boundaries all belong to a different interaction
3. Treat transition as "virtually complete" when only ignorable boundaries remain

**Limitations**: Verbose, error-prone, unnamed boundaries can't be ignored, actual `onMarkerComplete` may fire at wrong time or not at all.

---

## How Suspense Boundary Names Flow

1. User declares: `<Suspense name="profile-feed" fallback={...}>`
2. Read in commit phase: `commitTransitionProgress` reads `parent.memoizedProps.name` (`ReactFiberCommitWork.js:1082-1090`)
3. Stored in PendingBoundaries: `pendingBoundaries.set(offscreenInstance, { name })` (`ReactFiberCommitWork.js:1104-1106`)
4. Surfaces in callbacks: `Array.from(markerInstance.pendingBoundaries.values())` passed as `pending` array

---

## Proposed API

**Recommended: Ignore list on `startTransition` options** (aligns with RFC)

```js
startTransition(() => navigateToProfile(), {
  name: 'navigate-profile',
  ignoreBoundaries: ['profile-photo-modal', 'chat-widget'],
});
```

### Type Changes

```flow
// packages/shared/ReactTypes.js
type StartTransitionOptions = {
  name?: string,
  ignoreBoundaries?: Array<string>,  // NEW
};

// packages/react/src/ReactStartTransition.js
type Transition = {
  // ...existing fields...
  ignoreBoundaries: Array<string> | null,  // NEW
};
```

---

## How Filtering Works

In `commitTransitionProgress` (`ReactFiberCommitWork.js:1092-1128`), when a boundary goes hidden, before adding to `pendingBoundaries`:

1. Read boundary name from Suspense props
2. Check if any transition in the marker's `transitions` set has an `ignoreBoundaries` array containing that name
3. If ignored, skip adding to `pendingBoundaries` and skip firing progress callbacks
4. Completion happens naturally since ignored boundaries are never added

**Edge cases**:
- Unnamed boundaries cannot be ignored (correct behavior)
- Multiple transitions with different ignore lists: simplest approach treats boundary as ignored if *any* transition ignores it
- Abort handling: since boundary was never added to `pendingBoundaries`, deletion cleanup skips it naturally

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/ReactTypes.js` | Add `ignoreBoundaries` to `StartTransitionOptions` |
| `packages/react/src/ReactStartTransition.js` | Add to `Transition` type; read from options |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Filter in `commitTransitionProgress` |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | Add test cases |

---

## V1 Recommendation

**Ship V1 without the ignore list.** The userland workaround is sufficient:
- RFC explicitly lists this as "Future Goal"
- Workaround is functional, just verbose
- Adding `ignoreBoundaries` later is non-breaking
- Low severity rating in API gaps analysis
- The per-transition vs. per-marker `pendingBoundaries` distinction needs careful design

Document the `onMarkerProgress` workaround pattern with code examples. Add ignore list as a follow-up.
