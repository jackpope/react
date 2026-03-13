# Plan 12: Batched Transition Disambiguation

## Problem Statement

When multiple `startTransition` calls happen within the same browser event (synchronous tick), React batches them onto the same transition lane. Each call creates a distinct `Transition` object, but they share a lane and render together. Markers from one transition can be affected (deleted, superseded) by state changes from another transition in the same batch, with no way for callback consumers to distinguish which transition caused which effect.

The RFC recommends users manually disambiguate by comparing transition names to marker names. This is error-prone.

---

## Current Batching Behavior

### Lane Assignment: Same-Event Transitions Share a Lane

**File**: `packages/react-reconciler/src/ReactFiberRootScheduler.js:697-723`

```js
export function requestTransitionLane(transition: Transition | null): Lane {
  if (currentEventTransitionLane === NoLane) {
    currentEventTransitionLane =
      actionScopeLane !== NoLane ? actionScopeLane : claimNextTransitionUpdateLane();
  }
  return currentEventTransitionLane;
}
```

`currentEventTransitionLane` is cached for the event duration. Reset at end of microtask (line 343-347). Two `startTransition` calls in the same synchronous tick always get the same lane.

### Multiple Transitions Per Lane

**File**: `packages/react-reconciler/src/ReactFiberLane.js:1209-1225`

`addTransitionToLanesMap` stores multiple `Transition` objects in a `Set` indexed by lane. Batched transitions share the same Set.

### Collection at Render Time

**File**: `packages/react-reconciler/src/ReactFiberLane.js:1227-1254`

`getTransitionsForLanes` flattens ALL transitions from committed lanes into a single `workInProgressTransitions` array. Without `enableParallelTransitions` (currently `false`), all transition update lanes are batched into a single render (`ReactFiberLane.js:212-215`).

### Commit Phase: All Batched Transitions Fire

**File**: `packages/react-reconciler/src/ReactFiberCommitWork.js:3739-3764`

`committedTransitions.forEach` fires `onTransitionStart` for EVERY batched transition. `pushRootMarkerInstance` (`ReactFiberTracingMarkerComponent.js:203-239`) pushes ALL `incompleteTransitions` entries onto the marker instance stack, associating every marker with every active transition.

---

## The Problem: Concrete Example

### Rapid Navigation (Home -> Marketplace)

User clicks Home, then Marketplace before React renders:

1. `startTransition(() => setPage('home'), { name: 'nav-home' })` -- Transition A, lane X
2. `startTransition(() => setPage('marketplace'), { name: 'nav-marketplace' })` -- Transition B, same lane X

**Result**: `page` ends up as `'marketplace'`. The home content is never shown, but `committedTransitions` contains both A and B. Callbacks fire:
- `onTransitionStart('nav-home', ...)` -- fires despite home never showing
- `onMarkerComplete('nav-home', 'marketplace-content', ...)` -- INCORRECT: "nav-home" didn't cause "marketplace-content"
- `onMarkerComplete('nav-marketplace', 'marketplace-content', ...)` -- correct

---

## Proposed Enhancement: Batch Metadata on Callbacks

### Option A: `batchedWith` on `onTransitionStart` (Recommended for V1)

When `committedTransitions.length > 1`, pass batch information to callbacks:

```js
onTransitionStart: (name, startTime, info) => {
  // info.batchedWith: string[] -- other transition names in this batch
}
```

### Option B: Dedicated `onTransitionSuperseded` callback

```js
onTransitionSuperseded: (supersededName, supersedingName, startTime) => void
```

### Option C: `batchId` on all callbacks

Add a `batchId` to every callback for correlation.

**Recommendation**: Option A is simplest and most useful. Option C provides the most information but adds overhead to every callback.

---

## Detection Logic

A transition T1 is "superseded" when:
1. T1 and T2 are both in `committedTransitions` (batched)
2. T1's markers are NOT present in the committed tree (its UI was replaced)
3. T2's markers ARE present

Detection point: in the HostRoot passive mount handler (`ReactFiberCommitWork.js:3739-3764`), after iterating `committedTransitions`, cross-reference with `incompleteTransitions`:

```js
if (committedTransitions !== null && committedTransitions.length > 1) {
  const completedImmediately = [];
  const stillActive = [];
  committedTransitions.forEach(transition => {
    if (!incompleteTransitions.has(transition)) {
      completedImmediately.push(transition);
    } else {
      stillActive.push(transition);
    }
  });
  // A transition that completed immediately in a batch with active ones
  // may have been superseded
}
```

**Limitation**: False positives. A transition that completes immediately (no Suspense) is not necessarily superseded.

---

## Interaction with `enableParallelTransitions`

When `enableParallelTransitions` is enabled (`ReactFeatureFlags.js:216`, currently `false`):
- Transitions from DIFFERENT events get separate lanes and render independently
- Transitions from the SAME event still share a lane (inherent to React's batching)

So `enableParallelTransitions` partially solves cross-event disambiguation but does NOT solve same-event batching.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Add batch info to `PendingTransitionCallbacks`; handle in `processTransitionCallbacks` |
| `packages/react-reconciler/src/ReactFiberWorkLoop.js` | Add `addTransitionSupersededCallbackToPendingTransition` (optional) |
| `packages/react-reconciler/src/ReactFiberCommitWork.js:3739-3764` | Add batch detection after `committedTransitions.forEach` |
| `packages/react-reconciler/src/ReactInternalTypes.js` | Add `onTransitionSuperseded` (optional) |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | Add batching tests |

---

## Test Cases

1. **Two transitions in same tick**: Both `onTransitionStart` fire, verify markers are ambiguous (documents current behavior)
2. **Batch metadata**: With enhancement, verify `batchedWith` info is passed
3. **Cross-event transitions**: Transitions from different events -- verify independent tracking
4. **Same-root vs different-root**: Confirm different roots disambiguate naturally

---

## V1 Recommendation

**The userland workaround is sufficient for V1.** The batched transition scenario is uncommon (requires two transitions in the same synchronous tick targeting the same root and affecting overlapping UI).

**Post-V1**: Add batch metadata to `onTransitionStart` (Step 2 above). Small, backward-compatible change.

**Not recommended for V1**: The `onTransitionSuperseded` callback. The detection heuristic has false positives and adds complexity.

| Aspect | V1 | Post-V1 |
|--------|---------|---------|
| Same-event batching | Document behavior, rely on naming conventions | Add batch metadata to callbacks |
| Cross-event batching | Same as above | Improves with `enableParallelTransitions` |
| Supersession detection | Userland workaround | Consider if demand exists |
