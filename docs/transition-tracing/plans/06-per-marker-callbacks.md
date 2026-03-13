# Plan 06: Per-Marker Callbacks

## Problem Statement

All callbacks are registered at root creation via `createRoot`. Every transition/marker reports through the same callbacks, requiring users to filter. Proposal: allow callback props on `<TracingMarker>` that fire alongside (not instead of) root callbacks.

---

## Current Callback Flow

1. **Accumulation**: During commit, events are pushed into `currentPendingTransitionCallbacks` via 6 accumulator functions in `ReactFiberWorkLoop.js:545-700`
2. **Two completion paths**:
   - Immediate: `commitTracingMarkerPassiveMountEffect` (`ReactFiberCommitWork.js:3479-3495`) for markers with no suspense children
   - Deferred: `commitTransitionProgress` (`ReactFiberCommitWork.js:1054-1181`) when last boundary resolves
3. **Dispatch**: `processTransitionCallbacks` (`ReactFiberTracingMarkerComponent.js:60-193`) fires root callbacks at idle priority after paint

---

## Profiler as Precedent

The `Profiler` component provides the exact model:
- `onRender` fires during layout effects by reading `finishedWork.memoizedProps` (`ReactFiberCommitEffects.js:971-995`)
- `onPostCommit` fires during passive effects (`ReactFiberCommitEffects.js:1017-1044`)
- Callbacks wrapped in try/catch via `captureCommitPhaseError`
- `Passive` flag set during beginWork to ensure effects run

---

## Proposed API

```jsx
<TracingMarker
  name="profile-feed"
  onComplete={(transitionName, markerName, startTime, endTime) =>
    logMetric('profile-feed-load', endTime - startTime)
  }
  onProgress={(transitionName, markerName, startTime, currentTime, pending) =>
    updateLoadingBar(pending.length)
  }
  onIncomplete={(transitionName, markerName, startTime, deletions) =>
    logAbort('profile-feed', deletions)
  }
>
```

Signatures mirror root-level `onMarkerComplete`/`onMarkerProgress`/`onMarkerIncomplete`.

---

## Firing Order

Per-marker callbacks fire **first** (during passive effect tree walk), root callbacks fire **later** (at idle priority). This is natural and matches how Profiler works.

---

## Implementation

### Step 1: Extend TracingMarkerProps

**File**: `packages/shared/ReactTypes.js:411-414` -- Add `onComplete`, `onProgress`, `onIncomplete` optional callback props.

### Step 2: Set Passive flag for callback props

**File**: `packages/react-reconciler/src/ReactFiberBeginWork.js:1280` -- Set `Passive` flag when callback props are present, not just on initial mount with transitions.

### Step 3: Add fiber reference to TracingMarkerInstance

Add `fiber: Fiber | null` field to `TracingMarkerInstance` type (`ReactFiberTracingMarkerComponent.js:41-47`). Set during beginWork. Needed because `commitTransitionProgress` operates on Offscreen fibers and iterates `TracingMarkerInstance` objects without a reference back to the TracingMarker fiber.

### Step 4: Fire callbacks in commit phase

- `commitTracingMarkerPassiveMountEffect` (`ReactFiberCommitWork.js:3479`): Fire `onComplete` before root accumulation
- `commitTransitionProgress` (`ReactFiberCommitWork.js:1054`): Fire `onComplete`/`onProgress` via `markerInstance.fiber.memoizedProps`
- `abortTracingMarkerTransitions` (`ReactFiberCommitWork.js:953`): Fire `onIncomplete`

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/ReactTypes.js` | Add callback props to `TracingMarkerProps` |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Add `fiber` field |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Set `Passive` flag for callbacks; set `instance.fiber` |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Fire per-marker callbacks at 3 sites |

---

## Trade-offs

- **endTime discrepancy**: Per-marker callbacks use `now()` during passive effects; root callbacks use post-paint timestamp. Slight difference is acceptable and should be documented.
- **Dual invocation**: Both fire independently. Users who use both must be aware.
- **Error isolation**: Per-marker callback errors don't prevent root callbacks from firing (try/catch pattern).
