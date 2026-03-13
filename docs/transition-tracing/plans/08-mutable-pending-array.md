# Plan 08: Clone Pending Array in Transition Tracing Callbacks

## Problem Statement

The `pending` array passed to `onMarkerProgress` and `onTransitionProgress` contains the **same object references** stored in React's internal `pendingBoundaries` Map. Users could mutate internal state.

**TODO**: `// TODO: Clone the suspense object so users can't modify it` at `ReactFiberTracingMarkerComponent.js:82`

---

## Data Structure

```flow
// ReactFiberTracingMarkerComponent.js:23
type SuspenseInfo = {name: string | null};

// ReactFiberTracingMarkerComponent.js:58
type PendingBoundaries = Map<OffscreenInstance, SuspenseInfo>;
```

---

## Two Sub-Issues

1. **Mutable objects**: `SuspenseInfo` objects are the same references as internal map values. Writing `pending[0].name = 'foo'` corrupts React's state.
2. **Shared array** (`onMarkerProgress` only): A single `pending` array at line 83-86 is shared across `onMarkerProgress` calls for different transitions in the same marker.

---

## Fix

### Change 1: onMarkerProgress (lines 82-96)

Move array creation inside the `transitions.forEach` loop and clone objects:

```js
markerInstance.transitions.forEach(transition => {
  if (transition.name != null) {
    const pending: Array<{name: null | string}> = [];
    if (markerInstance.pendingBoundaries !== null) {
      markerInstance.pendingBoundaries.forEach(boundary => {
        pending.push({name: boundary.name});
      });
    }
    onMarkerProgress(transition.name, markerName, transition.startTime, endTime, pending);
  }
});
```

### Change 2: onTransitionProgress (lines 166-175)

Clone objects in the array creation:

```js
transitionProgress.forEach((pendingBoundaries, transition) => {
  if (transition.name != null) {
    const pending: Array<{name: null | string}> = [];
    pendingBoundaries.forEach(boundary => {
      pending.push({name: boundary.name});
    });
    onTransitionProgress(transition.name, transition.startTime, endTime, pending);
  }
});
```

---

## Why Shallow Clone Is Sufficient

`SuspenseInfo` only has `name: string | null`. Strings and null are immutable primitives. No deep clone needed.

## Why Not Object.freeze

Creates performance cost, not idiomatic in React. Creating fresh objects is simpler and cheaper.

---

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | 82-86 | Clone for `onMarkerProgress` |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | 170-172 | Clone for `onTransitionProgress` |

**Total**: 1 file, ~6 lines changed. Trivial fix.

---

## Risk Assessment

- **Regression risk**: Minimal. Existing tests only read `.name` from objects.
- **Performance**: Negligible. Not a hot path.
- **API compatibility**: Fully backward compatible.
