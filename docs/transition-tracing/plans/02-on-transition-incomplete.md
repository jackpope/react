# Plan 02: Implement `onTransitionIncomplete` Callback

## Problem Statement

The `onTransitionIncomplete` callback is declared in `TransitionTracingCallbacks` but is never dispatched. When a transition's markers are aborted, `onMarkerIncomplete` fires correctly at the marker level, but the transition-level `onTransitionIncomplete` never fires. The transition is silently removed from `incompleteTransitions`.

---

## Current State: The 6 Existing Accumulator Functions

All in `packages/react-reconciler/src/ReactFiberWorkLoop.js`:

| # | Function | Line | Accumulates Into |
|---|----------|------|------------------|
| 1 | `addTransitionStartCallbackToPendingTransition` | 545 | `transitionStart` |
| 2 | `addMarkerProgressCallbackToPendingTransition` | 569 | `markerProgress` |
| 3 | `addMarkerIncompleteCallbackToPendingTransition` | 597 | `markerIncomplete` |
| 4 | `addMarkerCompleteCallbackToPendingTransition` | 625 | `markerComplete` |
| 5 | `addTransitionProgressCallbackToPendingTransition` | 652 | `transitionProgress` |
| 6 | `addTransitionCompleteCallbackToPendingTransition` | 679 | `transitionComplete` |

**Missing**: `addTransitionIncompleteCallbackToPendingTransition`

## The Gap

**Location**: `packages/react-reconciler/src/ReactFiberCommitWork.js:3753-3759`

In the HostRoot passive mount, `incompleteTransitions` is iterated. When `pendingBoundaries.size === 0`:
- If `aborts === null`: calls `addTransitionCompleteCallbackToPendingTransition` (correct)
- If `aborts !== null`: **silently deletes the transition** (the gap)

The `onTransitionIncomplete` callback type already exists at `ReactInternalTypes.js:327` with the correct signature.

---

## Implementation Steps

### Step 1: Add `transitionIncomplete` to `PendingTransitionCallbacks` type

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:25-38`

Add field: `transitionIncomplete: Map<Transition, {aborts: Array<TransitionAbort>, transitions: Set<Transition>}> | null`

### Step 2: Add the 7th accumulator function

**File**: `packages/react-reconciler/src/ReactFiberWorkLoop.js` (after line 700)

```js
export function addTransitionIncompleteCallbackToPendingTransition(
  transition: Transition,
  aborts: Array<TransitionAbort>,
) {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = {
        transitionStart: null,
        transitionProgress: null,
        transitionComplete: null,
        transitionIncomplete: new Map(),
        markerProgress: null,
        markerIncomplete: null,
        markerComplete: null,
      };
    }
    if (currentPendingTransitionCallbacks.transitionIncomplete === null) {
      currentPendingTransitionCallbacks.transitionIncomplete = new Map();
    }
    currentPendingTransitionCallbacks.transitionIncomplete.set(transition, {
      aborts,
      transitions: new Set([transition]),
    });
  }
}
```

### Step 3: Update all 6 existing lazy-init objects

Every accumulator's lazy `currentPendingTransitionCallbacks` initialization must include `transitionIncomplete: null`. Update lines: 550, 576, 604, 631, 658, 684.

### Step 4: Add `else` branch in HostRoot passive mount

**File**: `packages/react-reconciler/src/ReactFiberCommitWork.js:3753-3759`

Change:
```js
if (markerInstance.aborts === null) {
  addTransitionCompleteCallbackToPendingTransition(transition);
}
incompleteTransitions.delete(transition);
```

To:
```js
if (markerInstance.aborts === null) {
  addTransitionCompleteCallbackToPendingTransition(transition);
} else {
  addTransitionIncompleteCallbackToPendingTransition(
    transition,
    markerInstance.aborts,
  );
}
incompleteTransitions.delete(transition);
```

### Step 5: Add dispatch logic to `processTransitionCallbacks`

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` (after line 161)

Follow the `onMarkerIncomplete` dispatch pattern, adapted for transition-level:

```js
const transitionIncomplete = pendingTransitions.transitionIncomplete;
const onTransitionIncomplete = callbacks.onTransitionIncomplete;
if (onTransitionIncomplete != null && transitionIncomplete !== null) {
  transitionIncomplete.forEach(({aborts}, transition) => {
    if (transition.name != null) {
      const filteredAborts = [];
      aborts.forEach(abort => {
        switch (abort.reason) {
          case 'marker':
            filteredAborts.push({type: 'marker', name: abort.name, endTime});
            break;
          case 'suspense':
            filteredAborts.push({type: 'suspense', name: abort.name, endTime});
            break;
        }
      });
      if (filteredAborts.length > 0) {
        onTransitionIncomplete(transition.name, transition.startTime, filteredAborts);
      }
    }
  });
}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Add `transitionIncomplete` to type; add dispatch block |
| `packages/react-reconciler/src/ReactFiberWorkLoop.js` | Add accumulator function; update 6 lazy-init objects |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Add `else` branch; add import |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | New + updated tests |

## Symmetry Check

After this change:

| Level | Start | Progress | Complete | Incomplete |
|-------|-------|----------|----------|------------|
| Transition | `onTransitionStart` | `onTransitionProgress` | `onTransitionComplete` | **`onTransitionIncomplete` (NEW)** |
| Marker | N/A | `onMarkerProgress` | `onMarkerComplete` | `onMarkerIncomplete` |

---

## Test Cases

1. Transition with all markers deleted before completion -> `onTransitionIncomplete` fires
2. Suspense boundary deleted during transition -> `onTransitionIncomplete` fires with `type: 'suspense'`
3. Normal transition completion -> `onTransitionIncomplete` does NOT fire
4. Multiple aborts aggregated into single `onTransitionIncomplete` call
5. Two transitions: one aborted, one completes -> correct callbacks for each
6. Update existing tests (lines 1737-1741) where transitions with aborts are silently dropped
