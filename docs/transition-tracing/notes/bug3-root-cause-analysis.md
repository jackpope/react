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

## Remaining Investigation Needed

### 1. When exactly is `_transitions` set to non-null?

I could NOT definitively trace a path where `_transitions` becomes non-null on the
CPU page's Offscreens. If `_transitions` stays null, the deletion handler would skip,
and `transition-incomplete` would NOT fire through that path. This needs verification:

**Hypothesis A**: `_transitions` IS set during some render path I haven't traced
(e.g., a concurrent render, pre-warming, or OffscreenLane render where the Offscreen
IS visited with `Passive` flag).

**Hypothesis B**: The `transition-incomplete` comes from a DIFFERENT path — not the
SuspenseComponent deletion handler, but the TracingMarkerComponent deletion handler.
TracingMarker instances have their own `transitions` field (distinct from `_transitions`),
and those ARE set during render. When a TracingMarker is deleted, its `transitions` are
used in `abortParentMarkerTransitionsForDeletedFiber`. If those transitions match
something in `incompleteTransitions`, abort fires.

**Hypothesis C**: The issue is with `processTransitionCallbacks` accumulation. Multiple
commits accumulate callbacks in `currentPendingTransitionCallbacks` before the post-paint
callback fires. This accumulation can cause duplicate starts and orphaned incomplete events.

### 2. TracingMarker deletion path (Hypothesis B — most likely)

When the CPU page is deleted, TracingMarker components ARE deleted. Their deletion
handler (CommitWork.js:5347-5378) reads `instance.transitions` (the TracingMarkerInstance's
transitions set, NOT `_transitions`). This is set during render in `beginWork` for
TracingMarkerComponent and is NOT cleared when the content resolves.

The TracingMarker's `transitions` contains the `navigate-to-cpu` Transition object.
When `abortRootTransitions` runs, it checks `incompleteTransitions.has(navigate-to-cpu)`.

**If `navigate-to-cpu` is still in `incompleteTransitions`** (because boundaries were
never removed, so the completion check never fired), then the abort IS added to the
`navigate-to-cpu` markerInstance.

But the trace shows `transition-incomplete navigate-to-home`, not `navigate-to-cpu`.
So this doesn't directly explain it.

**Unless**: There's a timing issue in the DOM where `navigate-to-cpu` IS still in
`incompleteTransitions` when the `navigate-to-home` commit runs, and somehow the
abort gets attributed to `navigate-to-home`.

### 3. The `_interrupted` flag path

`ReactFiberThrow.js:479` sets `_interrupted = true` when `_transitions !== null` and
the wakeable changes. This could interact with the hidden→hidden interruption handling
in `commitOffscreenPassiveMountEffects` (line 3464-3515). Need to check if this path
could cause `_transitions` to be set or marker instances to be contaminated.

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
| CommitWork.js | 809-829 | `bailoutOffscreenComponent` — skips Offscreen, returns sibling |
| CommitWork.js | 920-953 | `abortRootTransitions` — checks incompleteTransitions.has() |
| CommitWork.js | 955-1013 | `abortTracingMarkerTransitions` — adds abort to marker |
| CommitWork.js | 1014-1053 | `abortParentMarkerTransitionsForDeletedFiber` — walks up tree |
| CommitWork.js | 3406-3574 | `commitOffscreenPassiveMountEffects` — sets/clears _transitions |
| CommitWork.js | 3523-3526 | Where `_transitions` is SET |
| CommitWork.js | 3568-3570 | Where `_transitions` is CLEARED |
| CommitWork.js | 4179-4186 | `flags & Passive` gate for commitOffscreenPassiveMountEffects |
| CommitWork.js | 5304-5341 | SuspenseComponent deletion handler — reads `_transitions` |
| CommitWork.js | 5347-5378 | TracingMarkerComponent deletion handler — reads `instance.transitions` |
| BeginWork.js | 2432-2470 | SuspenseComponent mount fallback path (sets offscreenQueue, calls bailout) |
| BeginWork.js | 2471-2521 | SuspenseComponent CPU defer path (same pattern) |
| BeginWork.js | 2555-2623 | SuspenseComponent update → still showing fallback (sets offscreenQueue, calls bailout) |
| BeginWork.js | 2624-2647 | SuspenseComponent update → showing content (NO transition data set) |
| BeginWork.js | 770-774 | Offscreen beginWork reads `_transitions` for hidden→visible |
| CompleteWork.js | 2036-2048 | Fix 3 location (sets Passive if offscreenQueue has transition data) |
| WorkLoop.js | 3925-3935 | Fix 1 location (clears currentEndTime) |
| WorkLoop.js | 4965-4987 | Moved completion check in flushPassiveEffectsImpl |
| TracingMarkerComponent.js | 368-416 | `pushRootMarkerInstance` — pushes ALL incompleteTransitions markers |
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
