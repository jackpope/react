# Plan 03: HoldTrigger Component for Non-Suspense Loading States

## Problem Statement

Transition tracing only tracks Suspense boundaries. Many applications have loading states not backed by Suspense -- imperative loading indicators, timer-based delays, non-React async operations, or incremental migration paths. There is no way to signal to a `TracingMarker` that a non-Suspense loading state is active.

**Inspiration**: Hero Tracing's `<HeroHoldTrigger hold={boolean}>`

---

## Proposed API

```jsx
import { unstable_TracingHold as TracingHold } from 'react';

function DataGrid({data, isLoading}) {
  return (
    <TracingMarker name="data-grid">
      <TracingHold hold={isLoading} name="grid-loading" />
      {isLoading ? <Spinner /> : <Grid data={data} />}
    </TracingMarker>
  );
}
```

**Props**:
- `hold: boolean` -- When `true`, signals an active loading state. The nearest ancestor `TracingMarker` (and root transition) remains "in progress" until `hold` becomes `false`.
- `name: string` -- Label for this hold, surfaces in `onMarkerProgress` callbacks via the `pending` array as `SuspenseInfo.name`.

**Behavior**:
- `false -> true`: add this hold instance to all ancestor markers' `pendingBoundaries`
- `true -> false`: remove from `pendingBoundaries`; if `pendingBoundaries.size === 0`, fire `onMarkerComplete`
- Unmounted while `hold === true`: treated as abort, same as deleting a suspended Suspense boundary

---

## Current State: How Suspense Integrates with TracingMarker

### Three-Phase Pipeline

1. **Render phase** (beginWork): Marker instances pushed to `markerInstanceStack` (`ReactFiberTracingMarkerComponent.js:200-276`). Suspense reads the stack via `getMarkerInstances()` and stores marker references on the Offscreen child's `updateQueue` (`ReactFiberBeginWork.js:2445-2463`).

2. **Passive commit phase**: `commitOffscreenPassiveMountEffects` (`ReactFiberCommitWork.js:3394-3454`) processes the Offscreen queue, registering the boundary with marker instances. `commitTransitionProgress` (`ReactFiberCommitWork.js:1054-1181`) detects visibility changes and adds/removes from `pendingBoundaries`.

3. **Post-paint callback**: `processTransitionCallbacks` (`ReactFiberTracingMarkerComponent.js:60-193`) dispatches accumulated callbacks to user-provided handlers.

### Key Data Structures

```flow
// ReactFiberTracingMarkerComponent.js:41-47
type TracingMarkerInstance = {
  tag?: TracingMarkerTag,
  transitions: Set<Transition> | null,
  pendingBoundaries: PendingBoundaries | null,
  aborts: Array<TransitionAbort> | null,
  name: string | null,
};

// ReactFiberTracingMarkerComponent.js:58
type PendingBoundaries = Map<OffscreenInstance, SuspenseInfo>;
```

---

## Recommended Approach: New Fiber Type

### Why Not Effect-Based

An effect-based approach (hook or function component) has fundamental issues:
- `getMarkerInstances()` is a reconciler-internal stack cursor, only available during render -- not in effects
- Passive effects run after the stack is unwound, causing timing mismatches
- `abortParentMarkerTransitionsForDeletedFiber` runs during mutation phase, before passive effect cleanup
- The `addMarkerProgressCallbackToPendingTransition` functions are internal to the reconciler

### Why a New Fiber Type

- Follows the exact pattern of `TracingMarkerComponent` (work tag 25)
- Correct lifecycle timing: render/commit/passive phases are precisely where registration needs to happen
- Fiber's `stateNode` provides a stable identity key for `pendingBoundaries` (like `OffscreenInstance`)
- Every file that needs modification already has a `TracingMarkerComponent` case to clone
- All code is gated on `enableTransitionTracing` (dead-code-eliminated when `false`)

---

## New Data Structures

### HoldInstance

```flow
// New: ReactFiberTracingHoldComponent.js
export type HoldInstance = {
  _pendingMarkers: Set<TracingMarkerInstance> | null,
  _transitions: Set<Transition> | null,
};
```

### Extended PendingBoundaries

```flow
// ReactFiberTracingMarkerComponent.js
export type PendingBoundaries = Map<OffscreenInstance | HoldInstance, SuspenseInfo>;
```

---

## Implementation Steps

### Step 1: Add Symbol and Work Tag

**`packages/shared/ReactSymbols.js`**: Add `REACT_TRACING_HOLD_TYPE` symbol.

**`packages/react-reconciler/src/ReactWorkTags.js`**: Add `TracingHoldComponent = 32`.

### Step 2: Create HoldInstance Type

**New file**: `packages/react-reconciler/src/ReactFiberTracingHoldComponent.js` -- define `HoldInstance` type and creation helper.

**Modify**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` -- extend `PendingBoundaries` to accept `HoldInstance`.

### Step 3: Create Fiber Factory

**`packages/react-reconciler/src/ReactFiber.js`**: Add `createFiberFromTracingHold` function and `REACT_TRACING_HOLD_TYPE` case in `createFiberFromTypeAndProps` (after `REACT_TRACING_MARKER_TYPE` case, ~line 636).

### Step 4: Implement beginWork

**`packages/react-reconciler/src/ReactFiberBeginWork.js`**: Add `updateTracingHoldComponent`:

- **Mount with `hold=true`**: Read `getPendingTransitions()` and `getMarkerInstances()`. Create `HoldInstance`, register with all ancestor markers that share transitions. Set `Passive` flag.
- **Update with changed `hold`**: Set `Passive` flag to schedule commit-phase processing.
- **Returns `null`** (no children).

### Step 5: Implement completeWork

**`packages/react-reconciler/src/ReactFiberCompleteWork.js`**: Add `TracingHoldComponent` case -- just `bubbleProperties(workInProgress)` and return `null`.

### Step 6: Implement Passive Commit

**`packages/react-reconciler/src/ReactFiberCommitWork.js`**: Add `commitTracingHoldPassiveMountEffect`:

- **Mount with `hold=true`**: Add `holdInstance` to each ancestor marker's `pendingBoundaries` map. Fire progress callbacks.
- **`true -> false`**: Remove from `pendingBoundaries`. If `pendingBoundaries.size === 0`, fire `onMarkerComplete`.
- **`false -> true`**: Walk fiber return path to find TracingMarker ancestors, re-register. Fire progress callbacks.

Add case to `commitPassiveMountOnFiber` after the `TracingMarkerComponent` case.

### Step 7: Handle Deletion/Abort

**`packages/react-reconciler/src/ReactFiberCommitWork.js`**:
- Add `TracingHoldComponent` case to `abortParentMarkerTransitionsForDeletedFiber`
- Add case to `commitDeletionEffectsOnFiber`
- Generalize `abortTracingMarkerTransitions` to accept `HoldInstance` alongside `OffscreenInstance`

### Step 8: Supporting Changes

- **`ReactFiberUnwindWork.js`**: Add `TracingHoldComponent` no-op case
- **`getComponentNameFromFiber.js`**: Return `'TracingHold'`
- **`getComponentNameFromType.js`**: Add `REACT_TRACING_HOLD_TYPE` case
- **`packages/react/src/ReactClient.js`**: Export as `unstable_TracingHold`
- **`packages/react/index.js`**: Add to exports

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/ReactSymbols.js` | Add `REACT_TRACING_HOLD_TYPE` |
| `packages/react-reconciler/src/ReactWorkTags.js` | Add `TracingHoldComponent = 32` |
| `packages/react-reconciler/src/ReactFiberTracingHoldComponent.js` | **New**: `HoldInstance` type |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Extend `PendingBoundaries` type |
| `packages/react-reconciler/src/ReactFiber.js` | Add `createFiberFromTracingHold` |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Add `updateTracingHoldComponent` |
| `packages/react-reconciler/src/ReactFiberCompleteWork.js` | Add case |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Passive mount effect, abort handling |
| `packages/react-reconciler/src/ReactFiberUnwindWork.js` | Add no-op case |
| `packages/react-reconciler/src/getComponentNameFromFiber.js` | Add name |
| `packages/shared/getComponentNameFromType.js` | Add name |
| `packages/react/src/ReactClient.js` | Export |
| `packages/react/index.js` | Export |

---

## Test Cases

1. **Basic hold**: `onMarkerComplete` fires when hold becomes `false`
2. **Hold with Suspense**: marker waits for both hold and Suspense to resolve
3. **Hold unmounted while active**: triggers `onMarkerIncomplete` abort
4. **Hold starts as `false`**: no effect on marker completion
5. **Multiple holds under one marker**: tracked independently, marker completes when all release
6. **Nested markers**: hold registers with all ancestor markers
7. **Hold with no ancestor marker**: registers with root transition
8. **Hold toggle `true -> false -> true`**: re-registers correctly

---

## Open Questions

1. **Should `name` be required?** Making it required improves debuggability in the `pending` array. Suspense `name` is optional.
2. **Should the `false -> true` re-register case be supported?** Restricting to monotonic `true -> false` simplifies implementation significantly. The `false -> true` path requires walking the fiber return path during passive effects.
3. **Naming**: `TracingHold` vs `TransitionHold` vs `TracingHoldTrigger`.

---

## Complexity Assessment

**Estimated effort**: Medium-High

The new fiber type approach requires ~13 files modified but each change is mechanical, following existing `TracingMarkerComponent` patterns. The main complexity is in the passive commit effect and generalizing `PendingBoundaries` key type.

**Recommendation**: Defer to post-V1. The RFC lists this as a "Future Goal." Users can approximate hold behavior using Suspense + thrown Promises. Ship when Suspense migration is insufficient for real use cases.
