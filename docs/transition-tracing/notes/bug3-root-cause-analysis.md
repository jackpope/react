# Bug 3: Bogus `transition-incomplete` when navigating away — Root Cause Analysis

## The Symptom

After navigating to a CPU Suspense page and waiting for everything to resolve,
navigating back to home fires `onTransitionIncomplete` for the **new** transition
(`navigate-to-home`) with deletions referencing the old page's Suspense boundary
(`cpu:async-data`).

```
transition-start navigate-to-home start=4830.5
transition-progress navigate-to-home start=4830.5 current=5037.2
transition-start navigate-to-home start=4830.5          ← DUPLICATE
transition-incomplete navigate-to-home start=4830.5 deletions=[cpu:async-data]  ← BUG
```

## Current Unstaged Fixes (from previous session)

1. **Fix 1** (WorkLoop.js ~3925): Clear `currentEndTime = null` in `commitRoot`
2. **Fix 2** (CommitWork.js ~1098, ~1136): Initialize `pendingBoundaries` when null in `commitTransitionProgress`
3. **Fix 3** (CompleteWork.js ~2040): Set `Passive` flag on hidden Offscreen with transition data in `completeWork`
4. **Moved completion check** from HostRoot passive effects to `flushPassiveEffectsImpl` (after all passive effects)
5. **Removed second `clearTransitionsForLanes`** from HostRoot passive effects (only kept the one inside `if (committedTransitions !== null)`)

## How the Deletion Handler Works

### The chain that produces `transition-incomplete`:

1. `commitPassiveUnmountInsideDeletedTreeOnFiber` (CommitWork.js:5304) for `SuspenseComponent`
2. Reads `instance._transitions` from the Offscreen child's stateNode
3. If `_transitions !== null`, calls `abortParentMarkerTransitionsForDeletedFiber` (line 5320)
4. That function walks UP the fiber tree (CommitWork.js:1014-1053):
   - At `TracingMarkerComponent`: calls `abortTracingMarkerTransitions` (adds abort to marker's markerInstance)
   - At `HostRoot`: calls `abortRootTransitions` (adds abort to root's markerInstance in `incompleteTransitions`)
5. `abortRootTransitions` (line 920-953): iterates `deletedTransitions` (from `_transitions`), checks `root.incompleteTransitions.has(transition)` (reference equality). If found, pushes abort to the markerInstance.
6. Later, `flushPassiveEffectsImpl` completion check: if `markerInstance.aborts !== null`, fires `addTransitionIncompleteCallbackToPendingTransition`

### Two calls from the deletion handler:
```javascript
// Call 1: Walk up INSIDE the deleted tree
abortParentMarkerTransitionsForDeletedFiber(offscreenFiber, abort, transitions, instance, true);

// Call 2: Walk up from the NEAREST MOUNTED ANCESTOR (outside deleted tree)
abortParentMarkerTransitionsForDeletedFiber(nearestMountedAncestor, abort, transitions, instance, false);
```

Both calls eventually reach HostRoot and call `abortRootTransitions`.

## The `_transitions` Lifecycle

### Where `_transitions` is SET (only in `commitOffscreenPassiveMountEffects`, CommitWork.js:3517-3527):
```javascript
// Only runs when: (1) isHidden=true, (2) queue !== null, (3) flags & Passive
const transitions = queue.transitions;
if (transitions !== null) {
  transitions.forEach(transition => {
    if (instance._transitions === null) {
      instance._transitions = new Set();
    }
    instance._transitions.add(transition);
  });
}
```

### Where `_transitions` is CLEARED (CommitWork.js:3568-3570):
```javascript
// Also inside commitOffscreenPassiveMountEffects, also requires flags & Passive
if (!isHidden) {
  instance._transitions = null;
  instance._pendingMarkers = null;
}
```

### Where `_transitions` is READ:
- `commitPassiveUnmountInsideDeletedTreeOnFiber` (CommitWork.js:5309) — deletion handler
- `ReactFiberThrow.js:479` — sets `_interrupted = true` when transitions exist and wakeable changes
- `ReactFiberBeginWork.js:773` — reads transitions when Offscreen goes hidden→visible in beginWork, pushes onto transition context

### Critical gate: `commitOffscreenPassiveMountEffects` only runs when `flags & Passive`
```javascript
// CommitWork.js:4179-4186
if (flags & Passive) {
  commitOffscreenPassiveMountEffects(current, finishedWork, instance, committedLanes);
}
```

## The Offscreen Lifecycle During Suspense

### Mount with fallback (content suspends or defers):

1. `beginWork(SuspenseComponent)` → `mountSuspenseFallbackChildren` creates:
   - `primaryChildFragment` (Offscreen, hidden)
   - `fallbackChildFragment`
   - Sets `workInProgress.child = primary; primary.sibling = fallback`
2. Transition data is set on `primaryChildFragment.updateQueue` (offscreenQueue):
   ```javascript
   // BeginWork.js:2450-2466
   const currentTransitions = getPendingTransitions();
   if (currentTransitions !== null) {
     const parentMarkerInstances = getMarkerInstances();
     primaryChildFragment.updateQueue = {
       transitions: currentTransitions,
       markerInstances: parentMarkerInstances,
       retryQueue: null,
     };
   }
   ```
3. **`bailoutOffscreenComponent(null, primaryChildFragment)`** is called (line 2470 or 2521)
4. `bailoutOffscreenComponent` (line 809-829):
   - Creates `OffscreenInstance` with `_transitions: null`
   - Returns `workInProgress.sibling` (the fallback)
   - **The Offscreen's `completeWork` NEVER RUNS** (it's bailed out)
5. Fix 3 is in `completeWork` → **never executes** → Passive flag NOT set
6. Passive effects: `commitPassiveMountOnFiber` visits Offscreen but `flags & Passive` is false → `commitOffscreenPassiveMountEffects` does NOT run
7. **Result: `_transitions` stays null, offscreenQueue data is never processed, boundaries never registered**

### Resolve (content becomes visible):

1. Data resolves → retry render
2. `beginWork(SuspenseComponent)` takes the non-fallback path (line 2624-2646):
   ```javascript
   const primaryChildFragment = updateSuspensePrimaryChildren(current, workInProgress, ...);
   workInProgress.memoizedState = null;
   return primaryChildFragment;
   ```
3. No transition data set on offscreenQueue in this path
4. `completeWork(Offscreen)` DOES run: sets `Visibility` flag, but no transition data → Fix 3 doesn't set Passive
5. Passive effects: `commitOffscreenPassiveMountEffects` doesn't run
6. **Result: `_transitions` is NOT cleared (but was it set? See key question below)**

### Key Question: When IS `_transitions` actually set?

Since `bailoutOffscreenComponent` skips `completeWork`, and `commitOffscreenPassiveMountEffects` requires `flags & Passive`, there's a question of whether `_transitions` is EVER set on the Offscreen. If it's never set, the deletion handler would skip it (`transitions !== null` check fails).

**However**, there's a path in `beginWork` for Offscreen (line 770-774) that READS `_transitions`:
```javascript
// When Offscreen goes hidden → visible:
if (instance !== null && instance._transitions != null) {
  transitions = Array.from(instance._transitions);
}
```
This reads `_transitions` but doesn't set it. It propagates transitions down to child Suspense boundaries.

**Possible scenario where `_transitions` IS set**: If there's a render where the Offscreen IS hidden and `commitOffscreenPassiveMountEffects` DOES run. This could happen if:
- The Offscreen has `Passive` flag from a child effect
- A concurrent render processes the Offscreen while it's hidden
- Pre-warming or prerender sets up the Offscreen

## The `offscreenQueue.markerInstances` Chain

### How marker instances reach the offscreenQueue:

1. `pushRootMarkerInstance` (ReactFiberTracingMarkerComponent.js:368-416):
   - During render, pushes ALL `root.incompleteTransitions` marker instances onto `markerInstanceStack`
   - Also fires `addTransitionStartCallbackToPendingTransition` for new transitions

2. `pushMarkerInstance` (line 424-438):
   - TracingMarker components push their own markerInstance onto the stack (concatenated)

3. `getMarkerInstances()` (line 447-452):
   - Returns `markerInstanceStack.current` — includes BOTH root TransitionRoot markers AND TracingMarker markers

4. In `beginWork(SuspenseComponent)` fallback path:
   ```javascript
   const parentMarkerInstances = getMarkerInstances();
   offscreenQueue.markerInstances = parentMarkerInstances;
   ```

### This means the root's TransitionRoot markerInstance IS in `offscreenQueue.markerInstances`

If `commitOffscreenPassiveMountEffects` DID run, it would:
1. Add the root's markerInstance to `_pendingMarkers`
2. `commitTransitionProgress` would register the boundary on the root's `pendingBoundaries`
3. The completion check would see `pendingBoundaries.size > 0` → no bogus complete

## Why Bug 2 (Bogus Early Complete) Happens

Since `bailoutOffscreenComponent` skips `completeWork`, Fix 3 never sets `Passive`.
Since `Passive` isn't set, `commitOffscreenPassiveMountEffects` doesn't run.
Since boundaries are never registered, root's markerInstance has `pendingBoundaries: null`.
The completion check fires: `pendingBoundaries === null` → fires bogus `transition-complete`.
This deletes the transition from `incompleteTransitions`.

If the transition is re-discovered in a subsequent render (e.g., pre-warming), `pushRootMarkerInstance`
re-adds it (since `!incompleteTransitions.has(transition)`), firing a duplicate `transition-start`.

## Deep Dive: Attribution Puzzle

### How `abortRootTransitions` attributes aborts

`abortRootTransitions` (CommitWork.js:922-953) iterates `deletedTransitions` and for
each transition, checks `incompleteTransitions.has(transition)` using **reference
equality**. If found, the abort is added to **that transition's** markerInstance:

```javascript
deletedTransitions.forEach(transition => {
  if (rootTransitions.has(transition)) {
    const transitionInstance = rootTransitions.get(transition);
    transitionInstance.aborts.push(abort);
    // ...
  }
});
```

The completion check (CommitWork.js:3870-3883) then iterates ALL `incompleteTransitions`
and for any entry with `aborts !== null`, calls `addTransitionIncompleteCallbackToPendingTransition`
with **that specific Transition object** as the key:

```javascript
incompleteTransitions.forEach((markerInstance, transition) => {
  const pendingBoundaries = markerInstance.pendingBoundaries;
  if (pendingBoundaries === null || pendingBoundaries.size === 0) {
    if (markerInstance.aborts === null) {
      addTransitionCompleteCallbackToPendingTransition(transition);
    } else {
      addTransitionIncompleteCallbackToPendingTransition(transition, markerInstance.aborts);
    }
    incompleteTransitions.delete(transition);
  }
});
```

### TracingMarker's `transitions` is set only on mount

`updateTracingMarkerComponent` (BeginWork.js:1285-1335):
- `current === null` (mount): `transitions = new Set(currentTransitions)` — captures
  the transitions from the `startTransition` call that first rendered this marker
- `current !== null` (update): does NOT update `transitions` — the stateNode keeps
  whatever was set on mount

So when the CPU page's TracingMarkers are deleted during `navigate-to-home`:
- `instance.transitions` still contains `Set([navigate-to-cpu])` from mount
- The deletion handler calls `abortRootTransitions` with `deletedTransitions = Set([navigate-to-cpu])`
- `abortRootTransitions` checks `incompleteTransitions.has(navigate-to-cpu)`

### `pushRootMarkerInstance` behavior

`pushRootMarkerInstance` (TracingMarkerComponent.js:368-416) has two modes:
- **When transitions IS non-null** (rendering with specific transitions): only pushes
  markers for those transitions onto the stack
- **When transitions IS null** (non-transition render like retry or setState): pushes
  ALL incomplete transitions' markers onto the stack

This matters because retry renders (for deferred content) might not have the original
transition in `workInProgressTransitions`, so they use the "push all" path.

### The attribution paradox

The trace shows `transition-incomplete navigate-to-home`, but the deletion paths
would attribute it differently:

1. **SuspenseComponent deletion path**: Reads `_transitions` on the Offscreen. As
   established, `_transitions` is **never set** because `bailoutOffscreenComponent`
   skips `completeWork` and `commitOffscreenPassiveMountEffects` never runs. So
   `_transitions` is null → the deletion handler **skips entirely**.

2. **TracingMarkerComponent deletion path**: Reads `instance.transitions` which
   contains `Set([navigate-to-cpu])`. `abortRootTransitions` checks
   `incompleteTransitions.has(navigate-to-cpu)`. If found, the abort is added to
   **`navigate-to-cpu`'s** markerInstance, not `navigate-to-home`'s. The completion
   check would then fire `transition-incomplete` for `navigate-to-cpu`, NOT `navigate-to-home`.

**This means neither deletion path can directly produce `transition-incomplete navigate-to-home`.**

### Possible explanations for the `navigate-to-home` attribution

**Explanation 1: `processTransitionCallbacks` accumulation**. In the DOM, the
post-paint callback fires via double rAF (2 frames after commit). If `navigate-to-cpu`'s
incomplete callback and `navigate-to-home`'s start callback accumulate in the same
`currentPendingTransitionCallbacks` before being processed, the output in the
dashboard could conflate them. But `processTransitionCallbacks` processes each
callback type separately and uses the Transition object (which has the `.name` field).
So accumulation alone shouldn't cause mis-attribution.

**Explanation 2: Bug 2's premature completion removes `navigate-to-cpu` from
`incompleteTransitions`, and then `navigate-to-cpu` is re-added during a render where
the OLD page's TracingMarkers are re-processed**. During such a render:
- `pushRootMarkerInstance` re-adds `navigate-to-cpu` to `incompleteTransitions`
  with a NEW markerInstance
- The TracingMarker's `instance.transitions` still has `Set([navigate-to-cpu])`
  from mount
- But when content resolves, the NEW markerInstance's `pendingBoundaries` stays
  null → bogus completion fires again → `navigate-to-cpu` removed again
- This cycle eventually settles before `navigate-to-home` starts

**Explanation 3 (most likely): DOM-specific multi-commit batching**. In the real
browser, commits A (fallback), B (deferred retry), C (async resolve), and D
(navigate-to-home) may all fire within a short window. Their post-paint callbacks
fire later via double rAF. If:
1. Commit A adds `navigate-to-cpu` to `incompleteTransitions`
2. Commit A's passive effects fire: Bug 2 removes it prematurely (bogus complete)
3. Commit B (retry render) re-adds `navigate-to-cpu` (duplicate start)
4. Commit B's passive effects: removes it again (bogus complete)
5. Commit D (navigate-to-home) starts BEFORE the post-paint callbacks from A/B fire
6. `navigate-to-home` is added to `incompleteTransitions`
7. Commit D's passive effects: the TracingMarker deletion handler fires with
   `deletedTransitions = Set([navigate-to-cpu])`
8. At this point `navigate-to-cpu` is NOT in `incompleteTransitions` (removed at step 4)
9. So `abortRootTransitions` doesn't match → no abort added

But then: the accumulated `currentPendingTransitionCallbacks` from commits A-D includes
a `transitionIncomplete` entry from step 2 or 4 (for `navigate-to-cpu`). When
`processTransitionCallbacks` finally runs (via the post-paint callback), it processes
ALL accumulated callbacks together. The `transition-incomplete` in the trace might
actually be for `navigate-to-cpu`, not `navigate-to-home`, and the fixture dashboard's
display logic conflates them.

**This needs verification**: Add more detailed logging to `processTransitionCallbacks`
to see the actual Transition object's name in each callback, vs what the dashboard shows.

## Remaining Investigation Needed

### 1. Verify the actual transition name in `processTransitionCallbacks`

The fixture dashboard shows `transition-incomplete navigate-to-home`, but the underlying
callback might actually be for `navigate-to-cpu`. The `processTransitionCallbacks`
function in `ReactFiberTracingMarkerComponent.js` (line 76-260) processes the
`transitionIncomplete` Map, where keys are Transition objects with a `.name` property.
Need to add a `console.log(transition.name)` inside the `transitionIncomplete.forEach`
to confirm which transition the incomplete is actually attributed to.

### 2. When exactly is `_transitions` set to non-null?

As established above, `_transitions` is **likely never set** in the CPU Suspense scenario
because `bailoutOffscreenComponent` prevents `completeWork` from running, which prevents
the Passive flag from being set, which prevents `commitOffscreenPassiveMountEffects` from
running. This rules out the SuspenseComponent deletion path.

**Hypothesis A**: `_transitions` IS set during some render path not yet traced
(e.g., a concurrent render, pre-warming, or OffscreenLane render where the Offscreen
IS visited with `Passive` flag from a child effect).

**Hypothesis B (partially ruled out)**: The TracingMarkerComponent deletion path fires,
but as analyzed above, it would attribute the abort to `navigate-to-cpu`, not
`navigate-to-home`. Unless the dashboard conflates the output.

**Hypothesis C**: The issue is with `processTransitionCallbacks` accumulation. Multiple
commits accumulate callbacks in `currentPendingTransitionCallbacks` before the post-paint
callback fires. This accumulation can cause duplicate starts and orphaned incomplete events.
This is the most likely explanation but needs verification per item #1 above.

### 3. The `_interrupted` flag path

`ReactFiberThrow.js:479` sets `_interrupted = true` when `_transitions !== null` and
the wakeable changes. This could interact with the hidden→hidden interruption handling
in `commitOffscreenPassiveMountEffects` (line 3464-3515). Need to check if this path
could cause `_transitions` to be set or marker instances to be contaminated.

### 4. DOM-specific `requestPostPaintCallback` timing

The DOM renderer uses double rAF (ReactFiberConfigDOM.js:4600-4604):
```javascript
export function requestPostPaintCallback(callback) {
  localRequestAnimationFrame(() => {
    localRequestAnimationFrame(time => callback(time));
  });
}
```

ReactNoop calls the callback synchronously (createReactNoop.js:612-615):
```javascript
requestPostPaintCallback(callback) {
  const endTime = Scheduler.unstable_now();
  callback(endTime);
},
```

This means in the DOM:
- After commitRootImpl, the post-paint callback is scheduled ~2 frames out
- Passive effects run BEFORE the post-paint callback fires
- In `flushPassiveEffectsImpl` (WorkLoop.js:4958-4976), path 3 requires
  `currentEndTime !== null` to process callbacks — but `currentEndTime` is null
  (post-paint hasn't fired yet) → callbacks are NOT processed in path 3
- Later, the post-paint callback fires (WorkLoop.js:4557-4572): if
  `currentPendingTransitionCallbacks` is non-null, processes them (path 2);
  otherwise stashes `currentEndTime` for the next `flushPassiveEffectsImpl`

In ReactNoop:
- `requestPostPaintCallback` fires synchronously during commitRootImpl
- `currentEndTime` is set BEFORE passive effects run
- `flushPassiveEffectsImpl` path 3 sees `currentEndTime` non-null → processes
  callbacks immediately after all passive effects

**Key difference**: In DOM, callbacks from MULTIPLE commits accumulate in
`currentPendingTransitionCallbacks` before being processed in a single
`processTransitionCallbacks` call. In ReactNoop, callbacks are processed after
each commit's passive effects.

## DOM Test Attempt

A DOM test was written in `ReactTransitionTracing-dom-test.js` that mirrors the
fixture flow (navigate to CPU page → resolve → navigate home), but it **passes**
because `act()` synchronizes all timing:

1. `act()` flushes all renders, commits, and passive effects synchronously
2. jsdom's `requestAnimationFrame` uses `setTimeout(cb, 0)`, which `act()` also flushes
3. This means the post-paint callback fires within the same `act()` block, preventing
   the multi-commit batching that occurs in the real browser

To reproduce the bug in a unit test, we would need to either:
- Mock `requestAnimationFrame` to control exactly when it fires
- Break `act()` blocks to allow specific interleaving
- OR: instrument the code to detect the stale state directly (e.g., assert that
  `incompleteTransitions` does not contain `navigate-to-cpu` after resolution)

## User's Constraint

The user said: **"avoid adding passive flags because we don't want to trigger effects
just to log transition tracing if we can avoid it"**

This means Fix 3 (setting `Passive` on hidden Offscreen in `completeWork`) should be
reverted or replaced with a different mechanism.

## Potential Fix Approaches

### Approach A: Process offscreenQueue during mutation phase
Instead of relying on `commitOffscreenPassiveMountEffects` (which requires Passive flag),
process the transition tracing data in the mutation phase when the `Visibility` flag
changes. The mutation phase already visits Offscreen fibers with `Visibility`.

**Problem**: `commitTransitionProgress` needs `_pendingMarkers` data which is derived
from the offscreenQueue. Setting up both `_transitions` and `_pendingMarkers` in mutation
effects and then calling `commitTransitionProgress` would work, but it changes the
ordering relative to other effects.

### Approach B: Clear `_transitions` in mutation phase when Offscreen becomes visible
Only handle the CLEARING of `_transitions` in the mutation phase. Leave the SETTING
to passive effects (where it already works for the cases where Passive is set).

**Problem**: Doesn't fix boundary registration (Bug 2). Only fixes the stale
`_transitions` issue (Bug 3). And `_transitions` may never be set in the first place
(see investigation needed #1).

### Approach C: Process offscreenQueue in `commitRoot` / `commitMutationEffects`
Register boundaries and set `_transitions` during the mutation phase for the
`!wasHidden && isHidden` case. Clear them for the `wasHidden && !isHidden` case.

### Approach D: Move the completion check to account for unprocessed queues
Before the completion check in `flushPassiveEffectsImpl`, scan for any Offscreen
fibers with unprocessed offscreenQueues and process them first. This is complex
but would handle the "completeWork never ran" case.

### Approach E: Set Passive flag in beginWork instead of completeWork
Since the offscreenQueue is populated in `beginWork(SuspenseComponent)`, set the
Passive flag there too. This would happen BEFORE `bailoutOffscreenComponent` skips
the Offscreen. But wait — `bailoutOffscreenComponent` is called AFTER the flag would
be set on the Offscreen... does `bailoutOffscreenComponent` preserve flags?

Looking at `bailoutOffscreenComponent` (line 809-829): it creates the stateNode and
returns the sibling. It does NOT clear flags. So if `Passive` was set on the Offscreen
before `bailoutOffscreenComponent`, it would persist.

**This could work**: Set `flags |= Passive` on the Offscreen in `beginWork` for
SuspenseComponent, right after setting the offscreenQueue. Then even though
`completeWork` is skipped, the Passive flag is set.

**BUT**: The user said "avoid adding passive flags". So this has the same objection.

### Approach F: Don't use _transitions at all in the deletion handler
Instead of checking `_transitions` on the Offscreen, check whether the deleted
Suspense boundary's transitions are still in `incompleteTransitions`. This avoids
relying on stale `_transitions` state entirely.

**But**: The deletion handler DOES check `incompleteTransitions.has(transition)` via
`abortRootTransitions`. The issue is that `_transitions` might contain stale data OR
that the TracingMarker's `transitions` field is stale.

## Key Code Locations (updated)

| File | Lines | What |
|------|-------|------|
| BeginWork.js | 770-774 | Offscreen beginWork reads `_transitions` for hidden→visible |
| BeginWork.js | 1285-1335 | `updateTracingMarkerComponent` — sets `transitions` on mount only |
| BeginWork.js | 2432-2470 | SuspenseComponent mount fallback path (sets offscreenQueue, calls bailout) |
| BeginWork.js | 2471-2521 | SuspenseComponent CPU defer path (same pattern) |
| BeginWork.js | 2555-2623 | SuspenseComponent update → still showing fallback (sets offscreenQueue, calls bailout) |
| BeginWork.js | 2624-2647 | SuspenseComponent update → showing content (NO transition data set) |
| CommitWork.js | 809-829 | `bailoutOffscreenComponent` — skips Offscreen, returns sibling |
| CommitWork.js | 920-953 | `abortRootTransitions` — iterates `deletedTransitions`, checks `has()` by ref equality |
| CommitWork.js | 955-1013 | `abortTracingMarkerTransitions` — adds abort to marker's markerInstance |
| CommitWork.js | 1014-1053 | `abortParentMarkerTransitionsForDeletedFiber` — walks up tree to HostRoot |
| CommitWork.js | 3406-3574 | `commitOffscreenPassiveMountEffects` — sets/clears `_transitions` |
| CommitWork.js | 3523-3526 | Where `_transitions` is SET |
| CommitWork.js | 3568-3570 | Where `_transitions` is CLEARED |
| CommitWork.js | 3870-3883 | Completion check: iterates `incompleteTransitions`, fires complete/incomplete |
| CommitWork.js | 4179-4186 | `flags & Passive` gate for `commitOffscreenPassiveMountEffects` |
| CommitWork.js | 5321-5357 | SuspenseComponent deletion handler — reads `_transitions` from OffscreenInstance |
| CommitWork.js | 5364-5396 | TracingMarkerComponent deletion handler — reads `instance.transitions` from TracingMarkerInstance |
| CompleteWork.js | 1106-1115 | HostRoot completeWork — sets Passive if transitions exist |
| CompleteWork.js | 2036-2048 | Fix 3 location (sets Passive if offscreenQueue has transition data) |
| WorkLoop.js | 540-543 | `workInProgressTransitions` global + `getWorkInProgressTransitions()` |
| WorkLoop.js | 746-770 | `addTransitionIncompleteCallbackToPendingTransition` — adds to pending callbacks |
| WorkLoop.js | 2809, 2961 | `workInProgressTransitions = getTransitionsForLanes(root, lanes)` |
| WorkLoop.js | 3925-3935 | Fix 1 location (clears `currentEndTime`) |
| WorkLoop.js | 4545-4574 | Post-paint callback scheduling (path 2 for `processTransitionCallbacks`) |
| WorkLoop.js | 4926-4933 | `flushPassiveEffectsImpl`: unmount then mount order |
| WorkLoop.js | 4958-4976 | `flushPassiveEffectsImpl`: path 3 for `processTransitionCallbacks` (needs all 3 non-null) |
| ReactFiberConfigDOM.js | 4600-4604 | DOM double rAF implementation of `requestPostPaintCallback` |
| createReactNoop.js | 612-615 | ReactNoop synchronous `requestPostPaintCallback` |
| ReactFiberLane.js | 1227-1254 | `getTransitionsForLanes` — looks up transitions by lane in `transitionLanesMap` |
| ReactFiberLane.js | 1256-1272 | `clearTransitionsForLanes` — clears lane-to-transition association |
| TracingMarkerComponent.js | 76-260 | `processTransitionCallbacks` — processes all callback types in fixed order |
| TracingMarkerComponent.js | 368-416 | `pushRootMarkerInstance` — two modes: specific transitions vs all markers |
| TracingMarkerComponent.js | 424-438 | `pushMarkerInstance` — TracingMarker pushes onto stack |
| ReactFiberThrow.js | 476-482 | Sets `_interrupted` when `_transitions` exists and wakeable changes |

## Test Strategy

The existing unit test in the diff attempts to reproduce Bug 3 but passes in ReactNoop
because ReactNoop fires `requestPostPaintCallback` synchronously. The test needs to either:

1. Directly assert on the OffscreenInstance's `_transitions` field to verify it's properly cleaned up
2. Simulate the timing conditions that cause the bug (multiple commits before post-paint callback)
3. Test the TracingMarkerComponent deletion path (Hypothesis B) instead of the SuspenseComponent path

The most promising approach: create a test where a transition navigates to a page with
TracingMarkers wrapping Suspense, let everything resolve, then navigate away. Assert
that no `onTransitionIncomplete` fires. The test should verify the TracingMarker's
`transitions` field is properly handled during deletion even when the old transition
is no longer in `incompleteTransitions`.
