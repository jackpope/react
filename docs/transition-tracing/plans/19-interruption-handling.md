# Plan 19: Transition Interruption Handling

## Problem

When a transition is interrupted by a newer transition that reuses the same Suspense boundary (e.g., navigate to profile 1, then navigate to profile 2 before profile 1 resolves), transition tracing produces incorrect results:

- Transition 1 (`navigate-to-profile(1)`) completes successfully with all markers (wrong -- it was interrupted)
- Transition 2 (`navigate-to-profile(2)`) completes immediately with no markers (wrong -- it did the actual work)

## Root Causes

There are three interacting bugs in the hidden->hidden Suspense boundary reuse path:

### 1. Passive flag not set for hidden->hidden transitions

In `ReactFiberCompleteWork.js`, the Passive flag on the Offscreen fiber is only set when `nextDidTimeout !== prevDidTimeout` (Suspense state changes between visible/hidden). When both the old and new transition suspend through the same boundary (hidden->hidden), Passive is NOT set. This means `commitOffscreenPassiveMountEffects` never runs, so the new transition's markers and transitions are never queued onto the `OffscreenInstance`.

```js
// Current code (ReactFiberCompleteWork.js:1612-1616)
if (nextDidTimeout !== prevDidTimeout) {
  if (enableTransitionTracing) {
    const offscreenFiber = workInProgress.child;
    offscreenFiber.flags |= Passive;
  }
```

### 2. Cross-attribution via pushRootMarkerInstance

In `ReactFiberTracingMarkerComponent.js`, `pushRootMarkerInstance` pushes ALL `incompleteTransitions` onto the `markerInstanceStack`, not just the current render's transitions. When transition B renders while transition A is still incomplete, B's new Suspense boundaries get marker instances from BOTH transitions. When B resolves, both transitions complete.

```js
// Current code (ReactFiberTracingMarkerComponent.js:396-403)
const markerInstances = [];
root.incompleteTransitions.forEach(markerInstance => {
  markerInstances.push(markerInstance);
});
push(markerInstanceStack, markerInstances, workInProgress);
```

### 3. No hidden->hidden handling in commitTransitionProgress

`commitTransitionProgress` only processes visible->hidden (add boundary to pending) and hidden->visible (remove boundary from pending). The hidden->hidden case is a no-op, so new markers from the interrupting transition never get their pending boundaries populated.

## Failing Test

A failing test has been added to `ReactTransitionTracing-test.js`:

```
'interrupted transition should be incomplete when Suspense boundary is reused by a newer transition'
```

Run with: `yarn test-www --silent --no-watchman ReactTransitionTracing-test`

The test navigates to profile 1, then immediately navigates to profile 2 (reusing the same `<TracingMarker>` + `<Suspense>` tree position). Expected: transition 1 fires `onTransitionIncomplete`, transition 2 eventually fires `onTransitionComplete` with correct markers. Actual: transition 2 completes immediately, transition 1 completes when profile 2 resolves.

## Implementation Research

Significant implementation work was done to validate the plan and uncover additional complexities not in the original design. Here is what was learned:

### Part 1: Setting Passive flag for hidden->hidden -- THE CENTRAL CHALLENGE

**Original plan**: Set Passive on the Offscreen fiber whenever `nextDidTimeout === prevDidTimeout === true` and the offscreen queue has new transitions.

**What was discovered**: This is too broad. The offscreen queue contains transitions from `getPendingTransitions()`, which includes ALL transitions in the current render -- not just those that caused this specific boundary to suspend. When an unrelated transition B re-renders a tree containing a boundary already suspended by transition A, the boundary's queue gets transition B even though B didn't cause the suspension.

**Concrete regression found**: Test `'should correctly trace multiple intertwined root interactions'` -- the `show text` transition re-renders a tree containing `suspense page` (already suspended by `page transition`). Setting Passive for the hidden->hidden case on `suspense page` causes `commitOffscreenPassiveMountEffects` to run, which adds `show text` to the boundary's `_transitions` and `_pendingMarkers`, causing cross-attribution. The `show text` root marker incorrectly reports `suspense page` as a pending boundary.

**Why transition filtering doesn't work**: The `show text` transitions don't overlap with `page transition` (they're completely different transitions), so a "no overlap = interruption" heuristic falsely identifies this as an interruption. The actual difference between interruption and unrelated-re-render is whether the **boundary content changed** (Profile 1 -> Profile 2 vs Page Two -> Page Two), NOT whether the transitions differ.

**Approaches attempted**:
1. `offscreenQueue.transitions.length > 0` -- too broad, catches all hidden->hidden renders with any transition
2. `existingTransitions === null` -- misses the interruption case (existing transitions ARE present)
3. `offscreenQueue.transitions.every(t => !existingTransitions.has(t))` -- fails because unrelated transitions also don't overlap
4. `offscreenQueue.transitions.some(t => !existingTransitions.has(t))` -- same problem

**What would work**: Detecting that the Suspense boundary's **content actually changed** (the children reconciled to different elements). This is hard to check cheaply. Possible signals:
- Compare offscreen `pendingProps.children` deeply (expensive, fragile)
- Check if the Suspense threw a different thenable/promise (not easily accessible in completeWork)
- Add an explicit "interrupted" flag on the OffscreenInstance, set during the Suspense beginWork render phase when the boundary re-suspends with genuinely different content
- Track the wakeable/thenable identity on the OffscreenInstance and compare

**Recommended approach**: Add a `_interrupted` flag (or similar) to the `OffscreenInstance`. Set it in `updateSuspenseComponent` during the render phase when:
1. `prevState !== null` (boundary was already suspended)
2. New transitions are present (`getPendingTransitions() !== null`)
3. The boundary's existing `_transitions` don't overlap with the new transitions
4. AND the boundary content actually changed (e.g., by comparing the thenable/wakeable that caused the suspension, or by checking if the primary children fiber was reconciled with different element types/keys)

Then in completeWork, only set `Passive` if `offscreenInstance._interrupted` is true. Clear the flag after processing.

**Key insight**: The offscreen queue's `transitions` field captures ALL transitions from the current render, not just those that caused this specific boundary to suspend. This is a design limitation that makes the commit phase unable to distinguish interruption from incidental re-render. The render phase has more context (it knows which boundary actually re-threw).

**Additional note on `OffscreenQueue.transitions`**: This is an `Array<Transition>`, not a `Set`. Use `.length`, not `.size`.

### Part 2: Clean up old transition associations -- VALIDATED WITH CAVEATS

**Implementation code** (in `commitOffscreenPassiveMountEffects`):

```js
const wasHidden = current !== null && current.memoizedState !== null;
// ...
if (wasHidden && queue.transitions !== null) {
  const oldTransitions = instance._transitions;
  if (oldTransitions !== null) {
    let suspenseName = null;
    const parent = finishedWork.return;
    if (parent !== null && parent.tag === SuspenseComponent && parent.memoizedProps.name) {
      suspenseName = parent.memoizedProps.name;
    }
    const oldPendingMarkers = instance._pendingMarkers;
    if (oldPendingMarkers !== null) {
      oldPendingMarkers.forEach(markerInstance => {
        const pendingBoundaries = markerInstance.pendingBoundaries;
        if (pendingBoundaries !== null && pendingBoundaries.has(instance)) {
          pendingBoundaries.delete(instance);
        }
        if (markerInstance.aborts === null) {
          markerInstance.aborts = [];
        }
        const abort = { reason: 'suspense', name: suspenseName, endTime: now() };
        markerInstance.aborts.push(abort);
      });
    }
    instance._transitions = null;
    instance._pendingMarkers = null;
  }
}
```

**Caveat discovered**: This cleanup adds a `{reason: 'suspense'}` abort to the old marker instances. When a TracingMarker is later DELETED (e.g., `setShow(false)`), the TracingMarker deletion handler ALSO adds a `{reason: 'marker'}` abort. This causes duplicate aborts on the root marker -- the marker abort AND the suspense abort. Before these changes, `instance._transitions` was null for hidden->hidden so the Suspense deletion handler was a no-op.

**Impact**: Tests like `'abort endTime reflects when the abort was detected'` expect only the marker abort, but now get both marker and suspense aborts.

**Possible fix**: In `abortRootTransitions`, only add the first abort (once a transition is aborted, ignore subsequent aborts). Or in `abortParentMarkerTransitionsForDeletedFiber`, skip TracingMarker instances that already have aborts when walking within a deleted tree (`isInDeletedTree === true`). Both approaches caused regressions in other tests -- the fix needs more careful scoping. See "Abort deduplication" section below.

### Part 3: Handle hidden->hidden in commitTransitionProgress -- VALIDATED

This change adds a `wasHidden && isHidden` case mirroring the `!wasHidden && isHidden` (visible->hidden) logic. It adds the boundary to each new marker's `pendingBoundaries` and fires progress callbacks.

**Works correctly in isolation**. The issue is that Part 1 needs to be solved first to control WHEN this code runs.

### Part 4: Filter pushRootMarkerInstance -- VALIDATED WITH CAVEAT

**Original plan**: Only push markers for `getWorkInProgressTransitions()`.

**Caveat**: When rendering WITHOUT transitions (e.g., a `setState` that deletes a Suspense boundary), `getWorkInProgressTransitions()` returns null. If we push no markers, deletion handlers can't find them on the stack. The fix: push all incomplete markers when `transitions === null`, filter when `transitions !== null`.

```js
if (transitions !== null) {
  transitions.forEach(transition => {
    const markerInstance = root.incompleteTransitions.get(transition);
    if (markerInstance != null) {
      markerInstances.push(markerInstance);
    }
  });
} else {
  root.incompleteTransitions.forEach(markerInstance => {
    markerInstances.push(markerInstance);
  });
}
```

**This change alone does not cause regressions** (verified by testing with only Part 4 applied).

### Additional fix: HostRoot Passive flag for incomplete transitions

**Problem found**: The `onTransitionIncomplete` callback never fires when a Suspense boundary is deleted during a non-transition render (e.g., `setShow(false)`). This is because the HostRoot's passive mount phase (which checks `incompleteTransitions` and fires completion/incomplete callbacks) only runs when the HostRoot has the `Passive` flag. For non-transition renders, the HostRoot doesn't get `Passive`.

**Fix**: In `completeWork` for `HostRoot`, set `Passive` when `fiberRoot.incompleteTransitions.size > 0`:

```js
if (enableTransitionTracing) {
  // ...existing transition check...
  if (fiberRoot.incompleteTransitions.size > 0) {
    workInProgress.flags |= Passive;
  }
}
```

This is safe because `incompleteTransitions` is only populated inside `enableTransitionTracing` guards. In production builds, the map is always empty, so the Passive flag is never set. This fix is required for ALL the `onTransitionIncomplete` tests to pass (6+ tests depend on it).

### TracingMarker update path

**Attempted**: Updating `instance.transitions` in `updateTracingMarkerComponent` on re-render so the marker tracks the new (interrupting) transition.

**Result**: Causes regressions. The `'warns when marker name changes'` test failed. More importantly, it's the wrong approach -- the TracingMarker's `transitions` set is used by deletion handlers to determine which transitions to abort. Overwriting it loses the connection to the original transition.

**The correct approach** for getting the TracingMarker to track the new transition: handle this through the offscreen queue processing in `commitOffscreenPassiveMountEffects`, not by mutating the marker instance during render. The marker instance on the queue (`queue.markerInstances`) already contains the markers from the render-phase stack. When Part 1 is correctly solved (only setting Passive for actual interruptions), the marker instances in the queue will be the right ones.

**Note**: The TracingMarker's marker instance has `transitions` set at mount time. On update, the marker instance keeps its original transitions. The queue's `markerInstances` comes from the marker instance stack, which is populated during the render phase by `pushMarkerInstance`. For the interruption case, the marker instance still has transition 1's transitions, so `commitOffscreenPassiveMountEffects` won't match it with transition 2. This is a separate issue that may need solving after Part 1.

### Abort deduplication

When a Suspense boundary inside a TracingMarker is deleted, both the TracingMarker deletion handler and the Suspense deletion handler walk up to the HostRoot and set aborts. The deletion walk in `commitPassiveUnmountInsideDeletedTreeOnFiber` goes parent->child, so the TracingMarker fires first, then the Suspense.

Before these changes, the Suspense handler was a no-op for hidden->hidden because `instance._transitions` was null. With Part 2's cleanup adding transitions, the Suspense handler now fires too, creating duplicate aborts.

**Approaches tried**:
1. In `abortRootTransitions`, only add first abort (skip if `aborts !== null`) -- broke tests where multiple independent aborts are legitimate
2. In `abortTracingMarkerTransitions`, only add first abort (skip if `aborts !== null`) -- broke 6+ tests that rely on multiple abort entries from different sources
3. In `abortParentMarkerTransitionsForDeletedFiber`, skip TracingMarker nodes with existing aborts when `isInDeletedTree === true` -- broke 3 tests

**Root cause**: The issue only manifests when Part 1/2 populate `instance._transitions` for hidden->hidden boundaries. If Part 1 is correctly scoped to only fire for actual interruptions, this problem may not occur for the deletion case (since the boundary being deleted wouldn't have had its `_transitions` modified by a hidden->hidden re-render).

## Revised Architecture

The original plan assumed the four parts were relatively independent. In practice, **Part 1 is the linchpin** and its original design is flawed. The other parts work correctly but depend on Part 1 being selective about when to trigger.

### The core challenge

React's transition tracing architecture associates transitions with Suspense boundaries through the offscreen queue, which captures ALL transitions from the current render (`getPendingTransitions()`). This works for visible->hidden because every transition in the render contributed to the suspension. But for hidden->hidden, transitions that merely re-rendered the tree (without changing the suspended content) should NOT be associated with the boundary.

The commit phase cannot distinguish "transition B interrupted transition A on this boundary" from "transition B incidentally re-rendered this still-suspended boundary." Both cases have:
- `prevState !== null && nextState !== null` (hidden->hidden)
- Non-overlapping transitions in the queue vs `_transitions`
- The Passive flag set on the offscreen (with the original Part 1 approach)

### Recommended next steps

1. **Add an interruption signal during the render phase**. In `updateSuspenseComponent`, when `showFallback && prevState !== null` and there are new transitions, detect whether the boundary content actually changed. Set a flag on the `OffscreenInstance` (e.g., `_interrupted: boolean`) that the commit phase can read. Possible detection methods:
   - Track the wakeable/thenable on the `OffscreenInstance` and compare with the new one
   - Compare the primary children element type/key/props
   - Use the fact that `bailoutOffscreenComponent` was called -- if the offscreen's children would reconcile differently, this might be detectable through the pending props

2. **Use the interruption flag in completeWork** to selectively set `Passive` only for interrupted boundaries.

3. **Parts 2, 3, 4 and the HostRoot fix can proceed as designed** once Part 1 correctly gates them.

4. **The TracingMarker association problem** (marker instance has old transitions, new transition can't match) may need a separate solution -- possibly creating a new marker instance for the interrupting transition, or updating the marker's transitions specifically during the interruption cleanup in Part 2.

## Test Status

### Pre-existing failures (7 tests, failing before any changes)
- `should call onTransitionIncomplete when all markers are deleted before transition completes`
- `should not call onTransitionIncomplete when transition completes normally`
- `should call onTransitionIncomplete for one transition while another completes`
- `should call onTransitionIncomplete when markers are deleted by navigation`
- `abort endTime reflects when the abort was detected`
- `suspense abort includes suspense boundary name`
- `interrupted transition should be incomplete when Suspense boundary is reused by a newer transition`

### Tests that regress with naive Part 1 (hidden->hidden Passive for all transitions)
- `should correctly trace multiple intertwined root interactions` -- cross-attribution of `show text` onto `suspense page`
- `trace interactions with the same child suspense boundaries` -- similar cross-attribution
- `marker incomplete for tree with parent and sibling tracing markers` -- cross-attribution
- `warns when marker name changes` -- caused by TracingMarker update change, not Part 1

### Test ordering fix needed
The interruption test expects `onTransitionIncomplete` before `onTransitionProgress`. The actual order is reversed because progress callbacks fire during tree traversal (`commitTransitionProgress`) while incomplete fires at the root level (`incompleteTransitions.forEach`). The test should be updated to match the actual (correct) callback order.

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberOffscreenComponent.js` | Add `_interrupted` field to `OffscreenInstance` type |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Set `_interrupted` flag in `updateSuspenseComponent` for genuine interruptions |
| `packages/react-reconciler/src/ReactFiberCompleteWork.js` | Set Passive flag for hidden->hidden only when `_interrupted`; set Passive on HostRoot when `incompleteTransitions.size > 0` |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Clean up old associations on hidden->hidden; handle hidden->hidden in commitTransitionProgress |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Filter pushRootMarkerInstance to current render's transitions (with null fallback) |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | Fix callback ordering in interruption test |

## Verification

1. `yarn test-www --silent --no-watchman ReactTransitionTracing-test` -- new test passes, all existing tests pass (zero regressions)
2. Manual test in fixture: navigate to profile 1, interrupt with profile 2, verify performance tracks show profile 1 as incomplete and profile 2 with correct markers

## Scope Limitations

This fix does NOT address same-tick batching where both transitions are new (neither has rendered yet). In that case `workInProgressTransitions = [A, B]` and React can't distinguish which transition caused which fiber. That's handled separately by Plan 12 (Batched Disambiguation).
