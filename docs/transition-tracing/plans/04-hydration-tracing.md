# Plan 04: Hydration Tracing

## Problem Statement

`hydrateRoot` accepts `unstable_transitionCallbacks` but there is no mechanism to trace hydration itself -- from server HTML display through selective hydration completion. SSR apps can't measure time-to-interactive through hydration. The RFC lists this as a "Future Goal."

---

## Current State

### Root Creation

Both `createRoot` and `hydrateRoot` pass `transitionCallbacks` identically to `createFiberRoot`:
- `createRoot`: `packages/react-dom/src/client/ReactDOMRoot.js:171-260`
- `hydrateRoot`: `packages/react-dom/src/client/ReactDOMRoot.js:274-358`
- Both reach `createFiberRoot` (`packages/react-reconciler/src/ReactFiberRoot.js:157-236`) which sets `root.transitionCallbacks`

The key difference: `createHydrationContainer` (`packages/react-reconciler/src/ReactFiberReconciler.js:282-351`) schedules initial hydration using a bumped hydration lane.

### Hydration Lane System

React uses dedicated hydration lanes that shadow each priority level (`packages/react-reconciler/src/ReactFiberLane.js:46-122`). `getBumpedLaneForHydrationByLane` maps regular lanes to hydration variants.

### TracingMarker Is Broken on the Server

**Critical finding**: `REACT_TRACING_MARKER_TYPE` is NOT handled in `renderElement` in the Fizz server renderer (`packages/react-server/src/ReactFizzServer.js:2917-2999`). The switch statement handles Fragment, Profiler, StrictMode, Activity, Suspense, etc. -- but NOT TracingMarker. It would throw "Element type is invalid."

### TracingMarker Is Inert During Hydration

Because hydration has no `Transition` objects, `getPendingTransitions()` returns null, so `updateTracingMarkerComponent` (`packages/react-reconciler/src/ReactFiberBeginWork.js:1295-1296`) never creates a `TracingMarkerInstance`. TracingMarker is completely inert during hydration.

### Hydration Completion Detection

The commit phase detects hydration completion:
- **HostRoot** (`ReactFiberCommitWork.js:3689-3771`): Checks `alternate.memoizedState.isDehydrated`
- **SuspenseComponent** (`ReactFiberCommitWork.js:3869-3925`): Detects `dehydrated !== null` -> `dehydrated === null`

---

## Implementation Plan

### Phase 1: Server-Side TracingMarker Support (Prerequisite)

Add `REACT_TRACING_MARKER_TYPE` case to `renderElement` in `ReactFizzServer.js`. Render as transparent wrapper (just render children, like Fragment).

### Phase 2: Hydration Timing Infrastructure

- Add `hydrationStartTime` field to `FiberRootNode` (set in `createHydrationContainer`)
- Add `hydrationStartTime` to `SuspenseState` (set when entering hydration state)

### Phase 3: TracingMarker Hydration Awareness

In `updateTracingMarkerComponent`, check for hydration context and create marker instances even without active transitions. Populate `markerInstanceStack` during hydration.

### Phase 4: Commit Phase Hydration Tracking

- Add dehydrated-to-hydrated branch in `commitTransitionProgress`
- Fire hydration callbacks in HostRoot and SuspenseComponent passive mounts

### Phase 5: Callback Accumulation and Processing

Add hydration callback accumulators and extend `processTransitionCallbacks`.

### Phase 6: Selective Hydration Integration

Track user-interaction-triggered hydration as traced operations.

---

## Proposed Callbacks

```flow
onHydrationStart?: (boundaryName: string | null, startTime: number) => void,
onHydrationProgress?: (boundaryName: string | null, startTime: number, currentTime: number, pending: Array<{name: null | string}>) => void,
onHydrationComplete?: (boundaryName: string | null, startTime: number, endTime: number) => void,
onHydrationIncomplete?: (boundaryName: string | null, startTime: number, endTime: number, reason: 'error' | 'client-render' | 'timeout') => void,
```

---

## Key Risks

1. **No Transition object for hydration (HIGH)**: The entire system is built around `Transition` objects from `startTransition`. Recommend a parallel tracking path rather than synthetic transitions.
2. **Server renderer crash (HIGH)**: Must fix Fizz TracingMarker handling as prerequisite.
3. **Selective hydration interruptions (MEDIUM)**: `SelectiveHydrationException` can interrupt renders; track start time on persistent `SuspenseState`.
4. **Streaming SSR complications (MEDIUM)**: Boundaries may arrive after initial hydration.
5. **ActivityComponent hydration (MEDIUM)**: Must handle both Suspense and Activity dehydrated states.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-server/src/ReactFizzServer.js` | Add TracingMarker case to `renderElement` |
| `packages/react-reconciler/src/ReactInternalTypes.js` | Add hydration callback types |
| `packages/react-reconciler/src/ReactFiberRoot.js` | Add `hydrationStartTime` field |
| `packages/react-reconciler/src/ReactFiberSuspenseComponent.js` | Add `hydrationStartTime` to `SuspenseState` |
| `packages/react-reconciler/src/ReactFiberReconciler.js` | Record hydration start time |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Make TracingMarker work during hydration |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Track dehydrated-to-hydrated transitions |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Add hydration callback dispatch |
| `packages/react-reconciler/src/ReactFiberWorkLoop.js` | Add hydration callback accumulators |

**Estimated effort**: Large. This is the most complex plan in the set, touching server renderer, reconciler render phase, commit phase, lane system, and callback infrastructure.
