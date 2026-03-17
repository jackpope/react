# Transition Tracing - Debugging Notes

## Feature Flag

`enableTransitionTracing` is `false` in source/experimental, `__VARIANT__` in
`ReactFeatureFlags.www-dynamic.js`. Only active on the **www channel with
variant=true**. Tests must use `yarn test-www` (and optionally
`--variant=false`). The `@gate enableTransitionTracing` pragma gates tests.

## Architecture Overview

### Key Data Structures

- **`root.incompleteTransitions`** (`Map<Transition, TracingMarkerInstance>`) —
  lives on the FiberRoot. Tracks transitions that have started but not yet
  completed. Added during render in `pushRootMarkerInstance`
  (`ReactFiberTracingMarkerComponent.js:383-391`). Deleted during passive
  effects when `pendingBoundaries` is empty.

- **`TracingMarkerInstance`** — `{ tag, transitions, pendingBoundaries, aborts, name }`.
  `tag` is `TransitionRoot` (for the root entry) or `TransitionTracingMarker`
  (for `<TracingMarker>`). `pendingBoundaries` starts as `null` (meaning "not
  yet determined") and is initialized to a `Map` when boundaries register.

- **`OffscreenInstance._transitions`** — `Set<Transition> | null` on the
  Offscreen stateNode. Populated during passive effects from
  `offscreenQueue.transitions`. Cleared to `null` when the Offscreen becomes
  visible (`commitOffscreenPassiveMountEffects`, line ~3571). **Critical for
  deletion handlers** — if non-null when a Suspense is deleted, the deletion
  handler fires abort callbacks.

- **`OffscreenInstance._pendingMarkers`** — `Set<TracingMarkerInstance> | null`.
  Populated during passive effects from `offscreenQueue.markerInstances`.
  Cleared to `null` when the Offscreen becomes visible.

- **`currentPendingTransitionCallbacks`** — module-level variable in
  `ReactFiberWorkLoop.js`. **Accumulates** callback data across commits until
  consumed by `processTransitionCallbacks`. This accumulation is a source of
  bugs when multiple commits happen before the callbacks are processed.

- **`currentEndTime`** — module-level variable. Stashes the paint timestamp
  from a post-paint callback (double rAF in DOM) for later use by
  `flushPassiveEffectsImpl`.

### Three Code Paths for `processTransitionCallbacks`

1. **Suspended-render path** (`ReactFiberWorkLoop.js:~1598`) — when a render
   suspends at the root level (`RootSuspendedWithDelay`), processes callbacks
   immediately.

2. **Post-paint callback** (`ReactFiberWorkLoop.js:~4557-4582`) — at the end
   of `commitRootImpl`, a post-paint callback is scheduled. In the DOM
   renderer this fires via **double rAF** (2 frames later). If
   `currentPendingTransitionCallbacks` is non-null at that point, it processes
   them with the paint time. Otherwise, it stashes the paint time in
   `currentEndTime`.

3. **`flushPassiveEffectsImpl`** (`ReactFiberWorkLoop.js:~4968-4987`) — after
   all passive effects, if `currentEndTime` is non-null (post-paint callback
   already fired), processes accumulated callbacks.

### Callback Processing Order (in `processTransitionCallbacks`)

`ReactFiberTracingMarkerComponent.js:processTransitionCallbacks` processes
callbacks in this fixed order:
1. `transitionStart`
2. `markerProgress`
3. `markerComplete`
4. `markerIncomplete`
5. `transitionProgress`
6. `transitionComplete`

This ordering explains why the www channel shows `onMarkerProgress` before
`onTransitionProgress` in test expectations (different from the source channel
default which may interleave them differently).

### Passive Effects Traversal Order

`commitPassiveMountOnFiber` for HostRoot (line ~3823):
1. **First**: `recursivelyTraversePassiveMountEffects` — traverses children
   (depth-first, children before parent)
2. **Then**: HostRoot's own effects — `incompleteTransitions.forEach` check

This means Offscreen passive effects (`commitOffscreenPassiveMountEffects` ->
`commitTransitionProgress`) run BEFORE the HostRoot's completion check,
**provided** the Offscreen's `Passive` flag is visible in the ancestor's
`subtreeFlags`.

### Hidden Offscreen and `bubbleProperties`

In `completeWork` for OffscreenComponent (line ~2006-2032):

```javascript
if (!nextIsHidden || legacy) {
  bubbleProperties(workInProgress);  // normal: bubbles flags
} else {
  // Hidden: only bubble if rendering at OffscreenLane
  if (includesSomeLane(renderLanes, OffscreenLane) && ...) {
    bubbleProperties(workInProgress);
  }
  // Otherwise: subtreeFlags NOT populated from children
}
```

When a hidden Offscreen **skips** `bubbleProperties`:
- The Offscreen's **own `flags`** (e.g., `Passive`, `Visibility`) are still set
- But the Offscreen's **`subtreeFlags`** are not populated from its children
- The Offscreen's **parent** still picks up the Offscreen's `flags` via the
  parent's own `bubbleProperties` call (which ORs `child.flags | child.subtreeFlags`)
- So the Offscreen's own `Passive` flag **does bubble up** to ancestors
- But the Offscreen's children's flags **do not bubble up**

This is important: setting `Passive` on the Offscreen fiber itself (Fix 3)
works because the parent's `bubbleProperties` includes it, causing the passive
effects traversal to reach the Offscreen.

### Deletion Handler for Suspense

`commitPassiveUnmountInsideDeletedTreeOnFiber` (line ~5280) handles passive
unmount for deleted fibers. For `SuspenseComponent` (line ~5325):

```javascript
const offscreenFiber = current.child;
const instance = offscreenFiber.stateNode;
const transitions = instance._transitions;  // <-- KEY
if (transitions !== null) {
  // Fire abort callbacks for each transition
  abortParentMarkerTransitionsForDeletedFiber(...)
}
```

This checks `instance._transitions` on the Offscreen being deleted. If
`_transitions` is non-null, it fires `abortRootTransitions` which:
1. Iterates `deletedTransitions` (from `_transitions`)
2. Checks if each transition is in `root.incompleteTransitions`
3. If found, adds abort info → fires `onTransitionIncomplete`

**The cleanup rule**: `_transitions` is set to `null` when an Offscreen
becomes visible (line ~3571). If the Offscreen was properly shown and then
hidden again with a different transition, `_transitions` should reflect the
new transition. If the original transition completed, `_transitions` should
be `null`.

## Bugs Found

### Bug 1: `endTime < startTime` (stale `currentEndTime`)

**Root cause**: In the DOM renderer, the post-paint callback fires via double
rAF (2 frames after commit). If Commit A has no transition data, its
post-paint callback stashes the paint time in `currentEndTime`. When Commit B
(with transition data) runs, `flushPassiveEffectsImpl` finds the stale
`currentEndTime` from Commit A and uses it as the end time for Commit B's
callbacks, producing `endTime < startTime`.

**Fix 1** (`ReactFiberWorkLoop.js`): Clear `currentEndTime = null` at the
start of `commitRoot`, before passive effects are scheduled.

### Bug 2: Bogus early `transition-complete` and duplicate `transition-start`

**Symptom**: When navigating to a page with Suspense boundaries (especially
CPU Suspense `defer`), the transition fires `onTransitionComplete` immediately
after `onTransitionStart`, then fires a duplicate `onTransitionStart` followed
by the correct progress/complete sequence.

**Root cause (partially addressed)**: The `incompleteTransitions.forEach`
check in HostRoot passive effects sees `pendingBoundaries === null` (boundaries
not yet registered) and fires a bogus completion. The transition is then
deleted from `incompleteTransitions`. On the next commit, the transition may
be re-discovered and re-added, causing a duplicate start.

**Fix 3** (`ReactFiberCompleteWork.js`): Set the `Passive` flag on hidden
Offscreen fibers that have transition tracing data in their `offscreenQueue`.
This ensures `commitOffscreenPassiveMountEffects` (and thus
`commitTransitionProgress`) runs during passive effects. Because
`recursivelyTraversePassiveMountEffects` processes children before the
HostRoot's own effects, the boundaries are registered BEFORE the
`incompleteTransitions` completion check.

**Fix 2** (`ReactFiberCommitWork.js`): Initialize
`markerInstance.pendingBoundaries` to `new Map()` when null (in
`commitTransitionProgress`'s `!wasHidden && isHidden` branch). Without this,
the code would crash when trying to call `.has()` on a null
`pendingBoundaries`.

**Status**: Fixes 1-3 pass all ReactNoop unit tests. However, the fixture app
(DOM renderer) still shows duplicate transition-start and bogus early
completion. This suggests a **DOM-specific timing issue** that ReactNoop
doesn't reproduce because ReactNoop fires `requestPostPaintCallback`
synchronously.

### Bug 3: Bogus `transition-incomplete` when navigating away

**Symptom**: After navigating to a CPU Suspense page and waiting for
everything to resolve, navigating back to home fires
`onTransitionIncomplete` for the **new** transition (`navigate-to-home`)
with deletions referencing the old page's Suspense boundary
(`cpu:async-data`).

**Root cause hypothesis**: When the Suspense boundaries from the CPU page are
deleted during the `navigate-to-home` commit, the deletion handler checks
`instance._transitions` on each Offscreen. If `_transitions` is non-null, it
fires abort callbacks. The abort callbacks check
`root.incompleteTransitions` — if the `navigate-to-home` transition is in
there, the abort is attributed to it.

For this to happen, `_transitions` on the CPU page's Offscreen must still
contain a transition object, AND that transition must somehow be the
`navigate-to-home` transition (or `navigate-to-home` must be in
`incompleteTransitions` with matching transition objects). This requires
further investigation.

**Status**: Could not reproduce in ReactNoop unit tests. The test passes
because ReactNoop's synchronous callbacks avoid the timing conditions. Needs
investigation in the DOM renderer or a test that simulates async timing.

## ReactNoop vs DOM Renderer Differences

| Aspect | ReactNoop | DOM |
|--------|-----------|-----|
| `requestPostPaintCallback` | Synchronous (`callback(now())`) | Double rAF (2 frames later) |
| Passive effects timing | Synchronous within `act()` | Scheduled, may interleave with rAFs |
| `currentEndTime` | Set synchronously before `flushPassiveEffectsImpl` | Set asynchronously by rAF, may be stale |
| Multiple commits | All flush within single `act()` | May span multiple frames |

This means **timing-dependent bugs may not reproduce in ReactNoop tests**.
The DOM fixture app (`fixtures/transition-tracing/`) is essential for
validating fixes.

## Key Code Locations

| File | Lines | What |
|------|-------|------|
| `ReactFiberWorkLoop.js` | 579-580 | `currentPendingTransitionCallbacks`, `currentEndTime` globals |
| `ReactFiberWorkLoop.js` | 582-770 | `addTransition*CallbackToPendingTransition` helpers |
| `ReactFiberWorkLoop.js` | 1588-1610 | Suspended-render path for `processTransitionCallbacks` |
| `ReactFiberWorkLoop.js` | 3925-3936 | `commitRoot` — Fix 1 (clear `currentEndTime`) |
| `ReactFiberWorkLoop.js` | 4555-4584 | Post-paint callback scheduling |
| `ReactFiberWorkLoop.js` | 4876-4987 | `flushPassiveEffectsImpl` — Path 3 for `processTransitionCallbacks` |
| `ReactFiberCommitWork.js` | 922-955 | `abortRootTransitions` — fires transition abort on deletion |
| `ReactFiberCommitWork.js` | 1058-1210 | `commitTransitionProgress` — adds/removes boundaries |
| `ReactFiberCommitWork.js` | 3860-3890 | HostRoot passive effects — `incompleteTransitions` check |
| `ReactFiberCommitWork.js` | 4087-4218 | Offscreen passive mount — calls `commitOffscreenPassiveMountEffects` |
| `ReactFiberCommitWork.js` | 5280-5400 | `commitPassiveUnmountInsideDeletedTreeOnFiber` — deletion handler |
| `ReactFiberCompleteWork.js` | 1980-2080 | Offscreen `completeWork` — Fix 3 (Passive flag) |
| `ReactFiberTracingMarkerComponent.js` | 76-260 | `processTransitionCallbacks` — processes all callback types |
| `ReactFiberTracingMarkerComponent.js` | 375-394 | `pushRootMarkerInstance` — adds transitions to `incompleteTransitions` |
| `ReactFiberLane.js` | 1256-1272 | `clearTransitionsForLanes` — clears lane-to-transition association |
| `ReactPostPaintCallback.js` | * | Simple callback accumulator |
| `ReactFiberConfigDOM.js` | ~4600 | DOM double rAF implementation |
| `createReactNoop.js` | ~612 | ReactNoop synchronous implementation |

## Current Fixes Applied (on `transition-tracing-research` branch)

### Fix 1: Clear stale `currentEndTime` in `commitRoot`
**File**: `ReactFiberWorkLoop.js` (after line 3925)
```javascript
if (enableTransitionTracing) {
  currentEndTime = null;
}
```

### Fix 2: Initialize `pendingBoundaries` when null
**File**: `ReactFiberCommitWork.js` (in `commitTransitionProgress`, lines ~1101 and ~1141)
```javascript
if (markerInstance.pendingBoundaries === null) {
  markerInstance.pendingBoundaries = new Map();
}
```
Also removed the `pendingBoundaries !== null &&` guard from the
`.has(offscreenInstance)` condition since it's now guaranteed to be a Map.

### Fix 3: Set `Passive` flag on hidden Offscreen with transition data
**File**: `ReactFiberCompleteWork.js` (after `scheduleRetryEffect`, line ~2040)
```javascript
if (
  enableTransitionTracing &&
  (offscreenQueue.transitions !== null ||
    offscreenQueue.markerInstances !== null)
) {
  workInProgress.flags |= Passive;
}
```

### Fix 4 (reverted): Skip `incompleteTransitions` completion for committed transitions
Was too aggressive — prevented simple transitions (no Suspense) from ever
completing. Reverted in favor of Fix 3 which addresses the ordering issue
architecturally.

## Open Questions

1. **Why does the DOM fixture still show duplicate transition-start with Fixes
   1-3?** Fix 3 ensures the Passive flag is set, which should cause
   `commitTransitionProgress` to run before the HostRoot's
   `incompleteTransitions` check. The flag does bubble through
   `bubbleProperties` (verified in the built output: `flags |= 2048`). Need
   to add debug logging to the SOURCE code (not built output) and rebuild to
   confirm the passive effects traversal actually reaches the hidden Offscreen.

2. **Is `currentPendingTransitionCallbacks` accumulation across commits the
   root cause?** When Commit A and Commit B happen in the same frame (before
   any post-paint callback fires), callbacks from both commits accumulate in
   the same `currentPendingTransitionCallbacks` object. If Commit A adds
   `transition-start` and Commit B adds another `transition-start` for the
   same transition, both fire when `processTransitionCallbacks` finally runs.
   This is a fundamental design issue with the module-level accumulator.

3. **Should `incompleteTransitions` completion check move to
   `flushPassiveEffectsImpl`?** Moving it from the HostRoot passive mount
   effects to after `commitPassiveMountEffects` completes (line ~4943) would
   guarantee ALL passive effects (including hidden Offscreens) have run. This
   is a more architectural fix but changes semantics for all transitions.

4. **`_transitions` lifecycle during CPU Suspense `defer`**: With
   `<Suspense defer>`, the content is NOT rendered in the first pass — it's
   deferred to a retry lane. Does the Offscreen's `offscreenQueue` still get
   populated with transitions in this case? If not, Fix 3 wouldn't set the
   Passive flag, and `commitTransitionProgress` wouldn't run, leaving
   `pendingBoundaries` as null.

5. **Bogus `transition-incomplete` for `navigate-to-home`**: The deletion
   handler fires for the old page's Suspense boundaries. Why is
   `_transitions` non-null on those Offscreens when they should have been
   cleared when the Offscreens became visible? Possibly related to the
   duplicate transition-start creating stale state.

## Build & Test Commands

```bash
# Run tests (www channel, variant=true — the only channel with transition tracing)
yarn test-www --silent --no-watchman packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js

# Run tests (www channel, variant=false — transition tracing disabled, tests skipped)
yarn test-www --variant=false --silent --no-watchman packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js

# Build fixture app with transition tracing enabled
yarn build-for-tt-dev

# Run fixture app
cd fixtures/transition-tracing && yarn start
```

## Fixture App Structure

```
fixtures/transition-tracing/
  src/
    App.jsx              — Router, no outer <Suspense>
    components/
      CpuSuspensePage.jsx — <TracingMarker> wrapping sibling <Suspense defer> and <Suspense>
      HomePage.jsx        — Simple page, no Suspense
    dashboard/
      TracingDashboard.jsx — Shows transition events in real-time
  scripts/
    transition-tracing-build-patch.js — Patches enableTransitionTracing=true for builds
```

The CPU Suspense page has:
```jsx
<TracingMarker name="cpu-suspense">
  <TracingMarker name="cpu:deferred-section">
    <Suspense defer name="cpu:deferred" fallback={...}>
      <HeavyContent />          {/* CPU-heavy sync work */}
    </Suspense>
  </TracingMarker>
  <TracingMarker name="cpu:async-section">
    <Suspense name="cpu:async-data" fallback={...}>
      <AsyncContent />          {/* Data fetching */}
    </Suspense>
  </TracingMarker>
</TracingMarker>
```

The two Suspense boundaries are **siblings** (not nested). CPU Suspense
defers only `HeavyContent`. Async Suspense handles only `AsyncContent`.
