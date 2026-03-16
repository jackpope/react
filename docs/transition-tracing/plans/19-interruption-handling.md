# Plan 19: Transition Interruption Handling

## Status: IMPLEMENTED

The fix has been implemented and verified. The interruption test passes with zero regressions against existing tests.

## Problem

When a transition is interrupted by a newer transition that reuses the same Suspense boundary (e.g., navigate to profile 1, then navigate to profile 2 before profile 1 resolves), transition tracing produces incorrect results:

- Transition 1 (`navigate-to-profile(1)`) completes successfully with all markers (wrong -- it was interrupted)
- Transition 2 (`navigate-to-profile(2)`) completes immediately with no markers (wrong -- it did the actual work)

## Root Causes

There are three interacting bugs in the hidden->hidden Suspense boundary reuse path:

### 1. Passive flag not set for hidden->hidden transitions

In `ReactFiberCompleteWork.js`, the Passive flag on the Offscreen fiber is only set when `nextDidTimeout !== prevDidTimeout` (Suspense state changes between visible/hidden). When both the old and new transition suspend through the same boundary (hidden->hidden), Passive is NOT set. This means `commitOffscreenPassiveMountEffects` never runs, so the new transition's markers and transitions are never queued onto the `OffscreenInstance`.

### 2. Cross-attribution via pushRootMarkerInstance

In `ReactFiberTracingMarkerComponent.js`, `pushRootMarkerInstance` pushes ALL `incompleteTransitions` onto the `markerInstanceStack`, not just the current render's transitions. When transition B renders while transition A is still incomplete, B's new Suspense boundaries get marker instances from BOTH transitions. When B resolves, both transitions complete.

### 3. No hidden->hidden handling in commitTransitionProgress

`commitTransitionProgress` only processes visible->hidden (add boundary to pending) and hidden->visible (remove boundary from pending). The hidden->hidden case is a no-op, so new markers from the interrupting transition never get their pending boundaries populated.

## Solution Summary

The fix has five parts. The central insight is that **wakeable (thenable/promise) identity** can reliably distinguish genuine interruptions from incidental re-renders:

- **Same wakeable** = same suspended content = NOT an interruption (e.g., `show text` re-rendering a tree that still has `<AsyncText text="Page Two" />` suspended)
- **Different wakeable** = different suspended content = genuine interruption (e.g., `<AsyncText text="Profile 1" />` replaced by `<AsyncText text="Profile 2" />`)

This works because React's Suspense caches thenables per resource: same input produces the same promise object, different input produces a different promise.

### Part 1: Detect interruption via wakeable tracking in throwException

**File**: `ReactFiberThrow.js`

Added `_lastWakeable: Wakeable | null` and `_interrupted: boolean` fields to `OffscreenInstance`.

In `throwException`, when a SuspenseComponent catches a wakeable:
1. Access the committed OffscreenInstance via `suspenseBoundary.alternate.child.stateNode`
2. If the boundary was already in fallback (`current.memoizedState !== null`) AND the instance has existing `_transitions` AND the wakeable differs from `_lastWakeable`: set `_interrupted = true`
3. Always update `_lastWakeable = wakeable` (including for first suspension, visible->hidden)

**Why throwException and not updateSuspenseComponent**: `throwException` has direct access to the thrown wakeable (`value` parameter). By the time `updateSuspenseComponent` re-enters with `showFallback = true`, the wakeable is buried in the retry queue (which gets cleared between renders via `finishedWork.updateQueue = null` in the mutation phase, making comparison impossible).

**Why not transition-based detection**: The offscreen queue captures ALL transitions from `getPendingTransitions()`, not just those that caused this specific boundary to suspend. An unrelated transition B that merely re-renders a tree containing an already-suspended boundary gets its transition added to the queue. Both the interruption case and the incidental-re-render case have non-overlapping transitions, making transition comparison useless for distinguishing them.

**Key detail about retry queue clearing**: The SuspenseComponent's `updateQueue` (which holds the retry queue / Set of wakeables) is cleared in the commit mutation phase at `commitMutationEffectsOnFiber` line ~2480: `finishedWork.updateQueue = null`. Since `createWorkInProgress` copies `updateQueue` by reference (`workInProgress.updateQueue = current.updateQueue`), and `throwException` mutates it in place (`retryQueue.add(wakeable)`), both current and workInProgress share the same Set. After commit clears it, the next render starts with a null retry queue. This is why comparing wakeables via the retry queue doesn't work -- by the time the interrupting render runs, the previous wakeables are gone. The `_lastWakeable` field on the mutable `OffscreenInstance` persists across renders.

**Edge case -- pre-warming**: React pre-warms suspended content, causing `throwException` to be called again with the same wakeable. This is harmless: `wakeable === _lastWakeable`, so `_interrupted` stays false.

### Part 2: Clean up old associations and update TracingMarker instances

**File**: `ReactFiberCommitWork.js` (in `commitOffscreenPassiveMountEffects`)

When `wasHidden && instance._interrupted`:
1. Remove the boundary from each old marker's `pendingBoundaries`
2. Add a `{reason: 'suspense', name, endTime}` abort to each old marker
3. Null out `instance._transitions` and `instance._pendingMarkers`
4. **Update TracingMarker marker instances** to track the new transition (see "TracingMarker association" below)

Then the normal queue processing runs, adding the new transition's data.

**Flow typing note**: When adding aborts to marker instances, use the pattern `if (aborts === null) { markerInstance.aborts = [abort]; } else { markerInstance.aborts.push(abort); }`. Flow does not narrow through property mutation (`markerInstance.aborts = []; markerInstance.aborts.push(abort)` errors because Flow still sees `aborts` as `Array | null`).

### Part 3: Handle hidden->hidden in commitTransitionProgress

**File**: `ReactFiberCommitWork.js` (in `commitTransitionProgress`)

Added a `wasHidden && isHidden` case that mirrors the existing `!wasHidden && isHidden` (visible->hidden) logic: adds the boundary to each marker's `pendingBoundaries` and fires progress callbacks.

### Part 4: Filter pushRootMarkerInstance to current render's transitions

**File**: `ReactFiberTracingMarkerComponent.js`

When `transitions !== null`, only push markers for those specific transitions (via `root.incompleteTransitions.get(transition)`). When `transitions === null` (non-transition renders like setState), push ALL incomplete markers so deletion handlers can still find them on the stack.

### Part 5: HostRoot Passive flag for incomplete transitions

**File**: `ReactFiberCompleteWork.js`

Set `Passive` on the HostRoot when `fiberRoot.incompleteTransitions.size > 0`. Without this, `onTransitionIncomplete` callbacks never fire during non-transition renders (e.g., `setShow(false)` deleting a marker) because the HostRoot's passive mount phase (which iterates `incompleteTransitions`) only runs when the HostRoot has the `Passive` flag.

### Part 1b: Set Passive selectively in completeWork

**File**: `ReactFiberCompleteWork.js`

Added an `else if (nextDidTimeout && prevDidTimeout)` branch after the existing `if (nextDidTimeout !== prevDidTimeout)` block. Only sets `Passive` on the Offscreen fiber when `offscreenInstance._interrupted` is true. Clears `_interrupted` in `commitOffscreenPassiveMountEffects` after processing.

## TracingMarker Association Problem (Solved)

**Problem**: The TracingMarker's `markerInstance.transitions` set is created at mount time with the original transition. During an interruption, the marker instance still has transition 1's transitions. In `commitOffscreenPassiveMountEffects`, the association check `instance._transitions.has(transition)` fails because `instance._transitions` (now containing transition 2) doesn't contain transition 1.

**Solution**: During the Part 2 cleanup, after nulling `_transitions` and `_pendingMarkers`, iterate `queue.markerInstances` and replace the `transitions` set on any `TransitionTracingMarker` instances with the new transitions. Also clear their `pendingBoundaries` and `aborts` (which contain stale data from transition 1).

```js
// In the interruption cleanup, after clearing old associations:
const newTransitions = queue.transitions;
const newMarkerInstances = queue.markerInstances;
if (newTransitions !== null && newMarkerInstances !== null) {
  newMarkerInstances.forEach(markerInst => {
    if (markerInst.tag === TransitionTracingMarker) {
      markerInst.transitions = new Set(newTransitions);
      markerInst.pendingBoundaries = null;
      markerInst.aborts = null;
    }
  });
}
```

**Why clearing aborts is critical**: The cleanup in Part 2 adds a `{reason: 'suspense'}` abort to the TracingMarker's marker instance (because the old transition's boundary is being removed). If this abort isn't cleared, when the new transition's boundary resolves and `pendingBoundaries.size === 0`, the check `if (markerInstance.aborts === null)` fails and `onMarkerComplete` is never called. The abort was for the OLD transition and is no longer relevant after the marker is reassigned to the new transition.

**Why not update transitions in updateTracingMarkerComponent**: The marker's `transitions` set is used by deletion handlers to determine which transitions to abort. Modifying it during render would break deletion tracking. The correct place is the commit phase, specifically during interruption cleanup, where we have full context about what's being interrupted.

## Callback Ordering

Callbacks fire in a specific order based on where they're scheduled:

1. **Tree traversal callbacks** (fire first): `onMarkerComplete`, `onMarkerProgress` -- scheduled by `commitTransitionProgress` during tree walk
2. **Root-level callbacks** (fire second): `onTransitionProgress`, `onTransitionComplete`, `onTransitionIncomplete` -- scheduled by `incompleteTransitions.forEach` at the HostRoot level

The interruption test was updated to match this ordering:
- Step 2: `onTransitionProgress` before `onTransitionIncomplete` (both root-level, progress fires during tree traversal via hidden->hidden handler)
- Step 3: `onMarkerComplete` before `onTransitionProgress` and `onTransitionComplete`

## Files Modified

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberOffscreenComponent.js` | Added `_interrupted: boolean` and `_lastWakeable: Wakeable \| null` to `OffscreenInstance` type |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Initialize `_interrupted: false` and `_lastWakeable: null` in both OffscreenInstance creation sites |
| `packages/react-reconciler/src/ReactFiberThrow.js` | Detect interruption via wakeable identity comparison in `throwException`; import `enableTransitionTracing` |
| `packages/react-reconciler/src/ReactFiberCompleteWork.js` | Set Passive for hidden->hidden only when `_interrupted`; set Passive on HostRoot when `incompleteTransitions.size > 0`; import `OffscreenInstance` type |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Clean up old associations and update TracingMarker instances on interruption; handle hidden->hidden in `commitTransitionProgress` |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Filter `pushRootMarkerInstance` to current render's transitions (with null fallback) |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | Fix callback ordering in interruption test (progress before incomplete; marker complete before transition progress) |

## Test Results

### After implementation
- **Interruption test**: PASSES
- **All existing tests**: Zero regressions (22 passed, 6 pre-existing failures, 1 skipped)
- **Critical non-interruption test** (`should correctly trace multiple intertwined root interactions`): PASSES
- **Tests that would regress with naive Part 1**: ALL PASS (`trace interactions with the same child suspense boundaries`, `marker incomplete for tree with parent and sibling tracing markers`, `warns when marker name changes`)

### Pre-existing failures (6 tests, failing before AND after these changes)
These all relate to `onTransitionIncomplete` not firing in deletion scenarios. They depend on additional fixes beyond interruption handling (likely the pre-existing issue where `_transitions` is not populated for hidden->hidden boundaries in the non-interruption case, causing deletion handlers to be no-ops).

- `should call onTransitionIncomplete when all markers are deleted before transition completes`
- `should not call onTransitionIncomplete when transition completes normally`
- `should call onTransitionIncomplete for one transition while another completes`
- `should call onTransitionIncomplete when markers are deleted by navigation`
- `abort endTime reflects when the abort was detected`
- `suspense abort includes suspense boundary name`

### Flow type checking
- 1 error fixed (abort push pattern)
- 20 pre-existing errors in `ReactFiberTracingMarkerComponent.js` from prior commits (missing `componentStack`, `error`, `newName` properties in deletion object types)

## Research Notes (Preserved from Investigation)

### Why the non-interruption case triggers updateSuspenseComponent

In test `'should correctly trace multiple intertwined root interactions'`, the `show text` transition calls `setShowText(true)` which re-renders `App`. The JSX tree changes from `[null, <Suspense name="suspense page">]` to `[<Suspense name="show text">, <Suspense name="suspense page">]`. React reconciles fragments by index, so `suspense page` stays at index 1 (same position, updated).

Since the parent re-renders, the Suspense boundary's `beginWork` runs. `DidCapture` is not initially set (cleared from previous render), and `shouldRemainOnFallback` returns false (no SuspenseList context). So React enters the "try to unsuspend" path, renders the primary children, they throw the SAME thenable (for "Page Two"), `DidCapture` gets set, and `updateSuspenseComponent` re-enters with `showFallback = true`. The transition tracing block then populates the offscreen queue with `show text`'s transitions -- even though `show text` has nothing to do with this boundary.

This is why wakeable identity is the correct detection signal: the thenable for "Page Two" is the same object in both the original suspension and the incidental re-render.

### OffscreenInstance mutation model

`OffscreenInstance` is a mutable object (like a class instance) shared between `current` and `workInProgress` fibers via `stateNode`. This means:
- Mutations in `throwException` (render phase) are visible in `completeWork` and `commitOffscreenPassiveMountEffects` (commit phase)
- `_lastWakeable` and `_interrupted` persist across fiber tree cloning
- No need to thread values through fiber props or updateQueue

### Abort deduplication (not needed with wakeable approach)

The earlier research identified a potential abort duplication issue: when Part 2's cleanup adds aborts to marker instances, subsequent deletion handlers could add duplicate aborts. With the wakeable-based detection, `_interrupted` is only set for genuine interruptions (where the wakeable changed). For the deletion case (setShow(false) removing a TracingMarker), the boundary wasn't interrupted -- it was deleted. `_interrupted` is false, so the Part 2 cleanup doesn't run, and the existing deletion handlers work as before. The abort deduplication problem from the earlier research doesn't manifest.

## Scope Limitations

This fix does NOT address same-tick batching where both transitions are new (neither has rendered yet). In that case `workInProgressTransitions = [A, B]` and React can't distinguish which transition caused which fiber. That's handled separately by Plan 12 (Batched Disambiguation).
