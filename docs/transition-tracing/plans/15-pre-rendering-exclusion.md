# Plan 15: Pre-rendering Exclusion from Transition Metrics

## Problem Statement

Pre-rendered trees (rendered via `OffscreenLane` for hidden or deferred content) currently participate in transition tracing as if they were visible renders. This inflates boundary counts, delays `onTransitionComplete` signals, and generates spurious `onTransitionProgress` callbacks for content the user cannot yet see.

**TODO**: `// TODO: Pre-rendering should not be counted as part of a transition. We may add separate logs for pre-rendering, but it's not part of the primary metrics.` (`ReactFiberCommitWork.js:3395-3397`)

---

## What Pre-rendering Is

"Pre-rendering" refers to rendering work at lower priority for not-yet-visible content:

1. **Suspended/Deferred Boundaries**: When a Suspense boundary shows a fallback, React may continue rendering primary children in the background at `OffscreenLane` priority. `checkIfRootIsPrerendering` (`ReactFiberLane.js:412-425`) detects this.

2. **Hidden Activity/Offscreen Trees**: `<Activity mode="hidden">` renders at `OffscreenLane` priority. Children are rendered but not displayed.

3. **Sibling Pre-warming**: After suspension, React may continue rendering siblings. Tracked by `workInProgressRootIsPrerendering` (`ReactFiberWorkLoop.js:468`).

4. **OffscreenLane**: Bit 29 in the lane bitmask (`ReactFiberLane.js:109`), used for hydrating dehydrated boundaries, hidden `<Activity>` content, and pre-rendering suspended primary children.

---

## How Pre-rendering Affects Transition Tracking Today

### Problem 1: Inflated Pending Boundary Counts

When a Suspense boundary inside a pre-rendered tree suspends, `commitTransitionProgress` (`ReactFiberCommitWork.js:1054-1181`) adds it to `pendingBoundaries` of every associated marker instance. The transition waits for pre-rendered hidden content to resolve before being marked complete.

### Problem 2: Spurious Progress Callbacks

Pre-rendered boundaries suspend and unsuspend, firing `addTransitionProgressCallbackToPendingTransition` for boundaries invisible to the user.

### Problem 3: Delayed Completion Signals

A "visually complete" transition may not receive `onTransitionComplete` until pre-rendered content finishes loading (e.g., a lazy-loaded tab the user hasn't clicked).

### Problem 4: Transition-to-Lane Contamination

`getTransitionsForLanes` (`ReactFiberLane.js:1227-1254`) collects transitions for ALL lanes including `OffscreenLane`. When a pre-render pass includes `OffscreenLane`, these transitions flow into `committedTransitions` and are treated identically to visible-lane transitions.

---

## The TODO Location and Context

The TODO is inside `commitOffscreenPassiveMountEffects` (`ReactFiberCommitWork.js:3361-3455`). This function runs during the passive commit phase for every `OffscreenComponent` fiber. The transition tracing block (lines 3394-3454):

1. When an Offscreen becomes hidden: stores transitions and marker instances from the render's `OffscreenQueue` onto `OffscreenInstance._transitions` and `._pendingMarkers`
2. Calls `commitTransitionProgress` which adds the boundary to `pendingBoundaries` maps
3. When visible again: clears `_transitions` and `_pendingMarkers`

**None of these operations check whether the current render was a pre-render.**

---

## Proposed Filtering Mechanism

### Recommended: Combine Root-Level and Per-Offscreen Filtering

**1. Root-level suppression** (common case): Null out `pendingPassiveTransitions` for pure pre-render commits:

```js
// In commitRoot (ReactFiberWorkLoop.js:3615):
pendingPassiveTransitions = workInProgressRootIsPrerendering ? null : transitions;
```

This prevents `committedTransitions` from being non-null during pure pre-render commits.

**2. Per-Offscreen guard** (mixed-lane commits): Add `committedLanes` parameter to `commitOffscreenPassiveMountEffects` and skip transition tracking when the commit is prerender-only:

```js
const isPrerenderCommit = (committedLanes & ~(OffscreenLane | DeferredLane)) === NoLanes;
if (isPrerenderCommit) {
  // Skip transition tracking for pre-rendered trees
  if (queue !== null) {
    finishedWork.updateQueue = null;
  }
} else {
  // ... existing transition tracking code
}
```

### Why Not Filter at `getTransitionsForLanes`

Stripping `OffscreenLane` from `getTransitionsForLanes` is too broad -- transitions legitimately include `OffscreenLane` when they defer work to that lane (e.g., `startTransition` triggering both visible updates and deferred hydration).

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberWorkLoop.js:3615` | Null out `pendingPassiveTransitions` when `workInProgressRootIsPrerendering` |
| `packages/react-reconciler/src/ReactFiberCommitWork.js:3361-3455` | Add `committedLanes` param; skip transition tracking for prerender-only lanes |
| `packages/react-reconciler/src/ReactFiberCommitWork.js:1054-1181` | Add prerender guard to `commitTransitionProgress` |
| `packages/react-reconciler/src/ReactFiberCommitWork.js:3945-4072` | Update call sites to pass `committedLanes` |
| `packages/react-reconciler/src/ReactFiberCommitWork.js:4318-4388` | Update call sites in `reconnectPassiveEffects` |

---

## Test Cases

1. **Pre-render boundaries excluded from completion**: Transition completes when visible content resolves, not when pre-rendered hidden boundary resolves
2. **Progress callbacks exclude pre-rendered boundaries**: `onTransitionProgress` does not include boundaries inside hidden `<Activity>` trees
3. **Mixed-lane commits**: Commit with both `TransitionLane` and `OffscreenLane` -- only TransitionLane boundaries participate
4. **Pre-render-only commits produce no callbacks**: Pure `OffscreenLane` render should not fire any transition callbacks
5. **Re-appearance triggers normal tracking**: When pre-rendered tree becomes visible (Activity hidden -> visible), it participates in new transitions

---

## Recommendation: Defer

1. `enableTransitionTracing` is `false` in all production builds -- no production impact
2. `<Activity>` semantics are still evolving
3. The TODO mentions wanting "separate logs for pre-rendering" -- the long-term design may be more nuanced than simple exclusion
4. Testing requires complex scenarios with mixed-lane commits

**Priority**: Low. Address when `enableTransitionTracing` approaches production readiness.
