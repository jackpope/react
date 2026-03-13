# Plan 14: CPU Suspense Support for Transition Tracing

## Problem Statement

CPU Suspense boundaries are not tracked by transition tracing. When `<Suspense defer={true}>` proactively defers a tree to unblock surrounding content, the deferred boundary is not registered with `TracingMarker` instances. This means transitions may complete prematurely (before the deferred content renders) and progress callbacks don't include CPU-deferred boundaries.

**TODO**: `// TODO: Transition Tracing is not yet implemented for CPU Suspense.` (`ReactFiberBeginWork.js:2487`)

---

## What CPU Suspense Is

CPU Suspense is distinct from IO (regular) Suspense:

- **IO Suspense**: A component throws a Promise because it's waiting for external data. The render cannot complete until data arrives. Detected via `SuspendedOnData`, `SuspendedOnImmediate`, etc.

- **CPU Suspense**: A component tree is too expensive to render right now. It voluntarily defers via `<Suspense defer={true}>`. The tree is skipped, a fallback shown, and the skipped work is retried at `SomeRetryLane` after initial commit.

**Feature flag**: `enableCPUSuspense = __EXPERIMENTAL__` (`ReactFeatureFlags.js:112`)

CPU Suspense never throws -- it decides at the begin phase level. `throwException` is never called. `renderDidSuspendDelayIfPossible` is never called. It always commits immediately with fallback and retries later.

---

## The Divergence Point

**File**: `packages/react-reconciler/src/ReactFiberBeginWork.js:2427-2498`

In `updateSuspenseComponent` during initial mount, there are two fallback paths:

### IO Suspense Path (lines 2427-2465)

When `showFallback === true` (a child threw a promise):

```js
if (enableTransitionTracing) {
  const currentTransitions = getPendingTransitions();
  if (currentTransitions !== null) {
    const parentMarkerInstances = getMarkerInstances();
    const offscreenQueue: OffscreenQueue | null = primaryChildFragment.updateQueue;
    if (offscreenQueue === null) {
      primaryChildFragment.updateQueue = {
        transitions: currentTransitions,
        markerInstances: parentMarkerInstances,
        retryQueue: null,
      };
    } else {
      offscreenQueue.transitions = currentTransitions;
      offscreenQueue.markerInstances = parentMarkerInstances;
    }
  }
}
```

This populates the `OffscreenQueue` with `transitions` and `markerInstances`, enabling the commit phase to track the boundary.

### CPU Suspense Path (lines 2466-2498)

When `enableCPUSuspense && nextProps.defer === true`:

```js
pushFallbackTreeSuspenseHandler(workInProgress);
mountSuspenseFallbackChildren(workInProgress, ...);
// ...
workInProgress.memoizedState = SUSPENDED_MARKER;

// TODO: Transition Tracing is not yet implemented for CPU Suspense.

workInProgress.lanes = SomeRetryLane;
return bailoutOffscreenComponent(null, primaryChildFragment);
```

**The `OffscreenQueue` is never populated.** No `transitions` or `markerInstances` are stored.

---

## Impact

1. **`onTransitionProgress` won't report CPU Suspense boundaries as pending**
2. **`onTransitionComplete` may fire prematurely** since CPU-deferred boundaries aren't tracked
3. **`TracingMarker` completion is incorrect** -- pending boundary tracking skips CPU Suspense entirely
4. **`onMarkerProgress`/`onMarkerComplete` are inaccurate** for markers containing CPU Suspense

---

## Implementation

### The Fix: Copy IO Suspense Tracing to CPU Suspense Path

The fix is straightforward -- add the same `OffscreenQueue` population block from the IO Suspense path to the CPU Suspense path.

**File**: `packages/react-reconciler/src/ReactFiberBeginWork.js`

Replace the TODO comment (line 2487) with:

```js
if (enableTransitionTracing) {
  const currentTransitions = getPendingTransitions();
  if (currentTransitions !== null) {
    const parentMarkerInstances = getMarkerInstances();
    const offscreenQueue: OffscreenQueue | null =
      (primaryChildFragment.updateQueue: any);
    if (offscreenQueue === null) {
      const newOffscreenQueue: OffscreenQueue = {
        transitions: currentTransitions,
        markerInstances: parentMarkerInstances,
        retryQueue: null,
      };
      primaryChildFragment.updateQueue = newOffscreenQueue;
    } else {
      offscreenQueue.transitions = currentTransitions;
      offscreenQueue.markerInstances = parentMarkerInstances;
    }
  }
}
```

### Commit Phase: Already Handles It

The passive commit phase (`commitOffscreenPassiveMountEffects` at `ReactFiberCommitWork.js:3394-3454`) already processes any `OffscreenQueue` on hidden Offscreen fibers. It doesn't distinguish between IO and CPU Suspense origins. Once the queue is populated during begin work, the commit phase handles tracking automatically.

Similarly, `commitTransitionProgress` (`ReactFiberCommitWork.js:1054-1181`) detects visibility state changes and adds/removes from `pendingBoundaries` regardless of suspension type.

### Retry Lane Resolution

When the CPU-deferred tree is retried (at `SomeRetryLane`), the Offscreen fiber transitions from hidden to visible. `commitTransitionProgress` detects this change and removes the boundary from `pendingBoundaries`, firing the appropriate progress/completion callbacks.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberBeginWork.js:2487` | Replace TODO with `OffscreenQueue` population block |

**Total**: 1 file, ~15 lines added. The commit phase and callback infrastructure already handle the rest.

---

## Design Consideration: Should CPU Suspense Be Tracked?

### Arguments For (Recommended)

- CPU-deferred content is invisible to the user until it renders -- same as IO-suspended content
- From the user's perspective, the transition isn't "complete" until the deferred content is visible
- The tracing system should measure time-to-visible, regardless of why content is deferred

### Arguments Against

- CPU Suspense is a performance optimization, not a data loading concern
- The deferred tree renders almost immediately (next paint cycle), so the "pending" duration is minimal
- Pre-rendering exclusion (Plan 15) may need to distinguish CPU deferrals from data loading

### Resolution

Track CPU Suspense by default. If users need to distinguish, the Suspense `name` prop can be used for filtering in `onMarkerProgress`.

---

## Dependency

- `enableCPUSuspense` is `__EXPERIMENTAL__` -- CPU Suspense itself is experimental
- `enableTransitionTracing` is `false` -- transition tracing is also experimental
- Both features need to be enabled for this fix to take effect

---

## Test Cases

1. **Basic CPU Suspense tracking**: `<Suspense defer={true}>` inside TracingMarker -> boundary appears in `onMarkerProgress` pending array
2. **CPU Suspense completion**: After retry renders the tree, boundary is removed from pending -> `onMarkerComplete` fires
3. **Mixed IO + CPU Suspense**: TracingMarker with both IO-suspended and CPU-deferred children -> marker waits for both
4. **CPU Suspense with no TracingMarker**: Verify no errors when CPU Suspense is used outside tracing context

---

## Complexity Assessment

**Estimated effort**: Low. The fix is a ~15-line copy of existing code from the IO Suspense path to the CPU Suspense path. No new data structures, no new control flow, no architectural changes.

**Risk**: Low. The commit phase already handles `OffscreenQueue` processing regardless of origin. The only change is populating the queue during begin work.
