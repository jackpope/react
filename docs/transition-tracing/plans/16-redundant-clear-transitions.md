# Plan 16: Redundant clearTransitionsForLanes Cleanup

## Problem Statement

There are two calls to `clearTransitionsForLanes(finishedRoot, committedLanes)` in the HostRoot passive mount handler, 13 lines apart. The first call (inside `if (committedTransitions !== null)`) makes the second call redundant when `committedTransitions` is not null. The code structure is confusing.

---

## Current State

**File**: `packages/react-reconciler/src/ReactFiberCommitWork.js:3739-3764`

```js
if (enableTransitionTracing) {
  const root: FiberRoot = finishedWork.stateNode;
  const incompleteTransitions = root.incompleteTransitions;

  if (committedTransitions !== null) {
    committedTransitions.forEach(transition => {
      addTransitionStartCallbackToPendingTransition(transition);
    });

    clearTransitionsForLanes(finishedRoot, committedLanes);   // CALL 1 (line ~3750)
  }

  incompleteTransitions.forEach((markerInstance, transition) => {
    const pendingBoundaries = markerInstance.pendingBoundaries;
    if (pendingBoundaries === null || pendingBoundaries.size === 0) {
      if (markerInstance.aborts === null) {
        addTransitionCompleteCallbackToPendingTransition(transition);
      }
      incompleteTransitions.delete(transition);
    }
  });

  clearTransitionsForLanes(finishedRoot, committedLanes);     // CALL 2 (line ~3763)
}
```

### What `clearTransitionsForLanes` Does

**File**: `packages/react-reconciler/src/ReactFiberLane.js:1256-1272`

```js
export function clearTransitionsForLanes(root: FiberRoot, lanes: Lane | Lanes) {
  if (!enableTransitionTracing) return;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;
    const transitions = root.transitionLanes[index];
    if (transitions !== null) {
      root.transitionLanes[index] = null;
    }
    lanes &= ~lane;
  }
}
```

The function is idempotent -- calling it twice with the same arguments is a no-op on the second call because entries were already set to `null`.

---

## Analysis

| Scenario | Call 1 | Call 2 | Redundancy |
|----------|--------|--------|------------|
| `committedTransitions !== null` | Executes, clears lanes | Executes, all lanes already null | **Call 2 is redundant** |
| `committedTransitions === null` | Skipped (inside `if` block) | Executes, clears lanes | **Call 2 is NOT redundant** |

Neither `addTransitionStartCallbackToPendingTransition` nor `addTransitionCompleteCallbackToPendingTransition` write back into `root.transitionLanes`. The code between the two calls does not repopulate the cleared entries.

---

## Fix

Remove Call 1 and keep only Call 2 (which runs unconditionally within the `enableTransitionTracing` block):

```js
if (enableTransitionTracing) {
  const root: FiberRoot = finishedWork.stateNode;
  const incompleteTransitions = root.incompleteTransitions;

  if (committedTransitions !== null) {
    committedTransitions.forEach(transition => {
      addTransitionStartCallbackToPendingTransition(transition);
    });
  }

  incompleteTransitions.forEach((markerInstance, transition) => {
    const pendingBoundaries = markerInstance.pendingBoundaries;
    if (pendingBoundaries === null || pendingBoundaries.size === 0) {
      if (markerInstance.aborts === null) {
        addTransitionCompleteCallbackToPendingTransition(transition);
      }
      incompleteTransitions.delete(transition);
    }
  });

  clearTransitionsForLanes(finishedRoot, committedLanes); // single call, always runs
}
```

This is functionally identical because:
- `clearTransitionsForLanes` does not affect `committedTransitions` or `incompleteTransitions`
- Neither accumulator function reads from `root.transitionLanes`
- The function is idempotent

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Remove first `clearTransitionsForLanes` call, keep second |

**Total**: 1 file, 1 line removed. Trivial fix.

---

## Risk Assessment

- **Regression risk**: None. The behavior is identical.
- **Performance**: Negligible improvement (one fewer iteration over lane bits).
- **Code clarity**: Improved. Single call at the end of the block is clearer than two calls separated by logic.
