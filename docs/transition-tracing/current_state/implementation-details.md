# Transition Tracing: Implementation Details

## Architecture Overview

Transition tracing tracks the lifecycle of named transitions as they interact with Suspense boundaries. The system has two tracking concepts:

1. **TransitionRoot** (tag `0`): Root-level tracking — a transition completes when all its Suspense boundaries resolve.
2. **TransitionTracingMarker** (tag `1`): A `<TracingMarker>` component that tracks a named subset of a transition's Suspense boundaries.

---

## Data Structures

### TracingMarkerInstance

The core instance object stored on `TracingMarker` fibers and root-level transition entries.

```flow
// packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:41-47
type TracingMarkerInstance = {
  tag?: TracingMarkerTag,                    // TransitionRoot (0) or TransitionTracingMarker (1)
  transitions: Set<Transition> | null,       // transitions this marker tracks
  pendingBoundaries: PendingBoundaries | null, // suspense boundaries not yet resolved
  aborts: Array<TransitionAbort> | null,     // abort reasons
  name: string | null,                       // marker name
};
```

### OffscreenQueue

Bridge between render and commit phases for Suspense boundaries.

```flow
// packages/react-reconciler/src/ReactFiberOffscreenComponent.js:45-49
type OffscreenQueue = {
  transitions: Array<Transition> | null,
  markerInstances: Array<TracingMarkerInstance> | null,
  retryQueue: RetryQueue | null,
};
```

During render, when a Suspense boundary shows fallback, current transitions and marker instances are saved here.

### OffscreenInstance

Stable identity that persists across renders (used as Map key for pending boundaries).

```flow
// packages/react-reconciler/src/ReactFiberOffscreenComponent.js:56-61
type OffscreenInstance = {
  _visibility: OffscreenVisibility,
  _pendingMarkers: Set<TracingMarkerInstance> | null,  // markers waiting on this boundary
  _transitions: Set<Transition> | null,                // transitions associated with this boundary
  _retryCache: WeakSet<Wakeable> | Set<Wakeable> | null,
};
```

### PendingTransitionCallbacks

Accumulated callback data during a commit, dispatched after passive effects.

```flow
// packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:25-38
type PendingTransitionCallbacks = {
  transitionStart: Array<Transition> | null,
  transitionProgress: Map<Transition, PendingBoundaries> | null,
  transitionComplete: Array<Transition> | null,
  markerProgress: Map<string, {pendingBoundaries: PendingBoundaries, transitions: Set<Transition>}> | null,
  markerIncomplete: Map<string, {aborts: Array<TransitionAbort>, transitions: Set<Transition>}> | null,
  markerComplete: Map<string, Set<Transition>> | null,
};
```

### TransitionAbort

```flow
// packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:49-52
type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
};
```

### Supporting Types

```flow
type PendingBoundaries = Map<OffscreenInstance, SuspenseInfo>;
type SuspenseInfo = {name: string | null};
```

---

## Complete Data Flow

### Phase 1: Transition Creation

1. User calls `startTransition(() => setState(...), {name: 'nav'})`
2. Creates `Transition` object with `name='nav'`, `startTime=-1`
3. Sets `ReactSharedInternals.T = transition`
4. `setState` triggers `scheduleUpdateOnFiber` in the reconciler

### Phase 2: Lane Registration

In `scheduleUpdateOnFiber` (`ReactFiberWorkLoop.js:1036-1044`):

```js
if (enableTransitionTracing) {
  const transition = ReactSharedInternals.T;
  if (transition !== null && transition.name != null) {
    if (transition.startTime === -1) {
      transition.startTime = now();  // Lazily set start time
    }
    addTransitionToLanesMap(root, transition, lane);
  }
}
```

`addTransitionToLanesMap` (`ReactFiberLane.js:1209-1225`) maps the `Transition` object to its assigned lane in `root.transitionLanes`.

### Phase 3: Render Phase

#### 3a. Root Setup

At render start (`renderRootSync`/`renderRootConcurrent`):
```js
workInProgressTransitions = getTransitionsForLanes(root, lanes);
```

`getTransitionsForLanes` (`ReactFiberLane.js:1227-1254`) collects all transitions across the lanes being rendered.

#### 3b. HostRoot BeginWork

- `pushRootTransition`: Pushes `workInProgressTransitions` onto the `transitionStack`
- `pushRootMarkerInstance`: For each transition, creates a `TracingMarkerInstance` (tag `TransitionRoot`) in `root.incompleteTransitions` if one doesn't exist. Pushes all incomplete transition marker instances onto `markerInstanceStack`.

#### 3c. TracingMarker BeginWork

In `updateTracingMarkerComponent` (`ReactFiberBeginWork.js:1279-1339`):

- **Initial mount**: Creates `TracingMarkerInstance` with `tag=TransitionTracingMarker`, captures current `workInProgressTransitions`, stores as `stateNode`. Pushes onto `markerInstanceStack`.
- **Update**: Reuses existing instance. Pushes onto `markerInstanceStack`.
- A marker only tracks transitions active when it **first mounted**. New transitions after mount are not added.

#### 3d. Suspense Boundary BeginWork

When a Suspense boundary shows fallback during a transition (`ReactFiberBeginWork.js:2445-2463`):

```js
if (enableTransitionTracing) {
  const currentTransitions = getPendingTransitions();
  const parentMarkerInstances = getMarkerInstances();
  offscreenQueue.transitions = currentTransitions;
  offscreenQueue.markerInstances = parentMarkerInstances;
}
```

Captures both the current transitions and the marker instances in scope. Stores them on the Offscreen child's `OffscreenQueue`.

#### 3e. CompleteWork

- **HostRoot**: Sets `Passive` flag if transitions exist, pops root marker instance and transition stacks.
- **TracingMarkerComponent**: Pops marker instance from stack.
- **SuspenseComponent**: If suspended state changed, sets `Passive` flag on Offscreen child.

### Phase 4: Commit Phase

#### 4a. Root Commit

`pendingPassiveTransitions = workInProgressTransitions` — caches for passive effect processing.

#### 4b. Passive Effects: OffscreenComponent

In `commitOffscreenPassiveMountEffects` (`ReactFiberCommitWork.js:3394-3454`):

When hidden:
- Moves transitions and marker instances from `OffscreenQueue` into `OffscreenInstance._transitions` and `_pendingMarkers`
- Calls `commitTransitionProgress`

When visible:
- Clears `_transitions` and `_pendingMarkers`

#### 4c. Passive Effects: commitTransitionProgress

`commitTransitionProgress` (`ReactFiberCommitWork.js:1054-1181`) — the core boundary tracking logic:

**Boundary goes hidden** (`!wasHidden && isHidden`):
- For each marker in `_pendingMarkers`, adds the OffscreenInstance to the marker's `pendingBoundaries` map
- Fires progress callbacks

**Boundary reveals** (`wasHidden && !isHidden`):
- For each marker, removes OffscreenInstance from `pendingBoundaries`
- Fires progress callbacks
- If `pendingBoundaries.size === 0` and no aborts → fires marker complete

#### 4d. Passive Effects: TracingMarkerComponent

In `commitTracingMarkerPassiveMountEffect` (`ReactFiberCommitWork.js:3479-3495`):

If marker has transitions but no pending boundaries → immediately complete (no Suspense in subtree).

#### 4e. Passive Effects: HostRoot

In the HostRoot passive mount (`ReactFiberCommitWork.js:3739-3764`):

1. For each committed transition → `addTransitionStartCallbackToPendingTransition`
2. For each incomplete transition with empty `pendingBoundaries` and no aborts → `addTransitionCompleteCallbackToPendingTransition`
3. Clears transition lane maps

#### 4f. Abort Handling

Three functions handle aborts during deletion:

- **`abortRootTransitions`** (`ReactFiberCommitWork.js:918-951`): Marks transitions as aborted in `root.incompleteTransitions`
- **`abortTracingMarkerTransitions`** (`:953-1010`): Aborts transitions on a specific marker, fires `addMarkerIncompleteCallbackToPendingTransition`
- **`abortParentMarkerTransitionsForDeletedFiber`** (`:1012-1052`): Walks up the fiber tree from a deleted fiber, calling the above for each ancestor TracingMarker/HostRoot

### Phase 5: Callback Dispatch

After passive effects flush (`ReactFiberWorkLoop.js:4774-4792`):

```js
scheduleCallback(IdleSchedulerPriority, () => {
  processTransitionCallbacks(
    prevPendingTransitionCallbacks,
    prevEndTime,
    prevRootTransitionCallbacks,
  );
});
```

`processTransitionCallbacks` (`ReactFiberTracingMarkerComponent.js:60-193`) iterates through accumulated callbacks and invokes user-provided functions in order:
1. `onTransitionStart`
2. `onMarkerProgress`
3. `onMarkerComplete`
4. `onMarkerIncomplete`
5. `onTransitionProgress`
6. `onTransitionComplete`

### Phase 6: Lane Cleanup

`clearTransitionsForLanes` (`ReactFiberLane.js:1256-1272`) clears the `transitionLanes` map entries for committed lanes, called from the HostRoot passive mount.

---

## Stack-Based Tracking

Two fiber stacks maintain context during render traversal:

### Transition Stack

`transitionStack` in `ReactFiberTransition.js:205-206` — tracks which `Transition` objects are in scope.

- `pushRootTransition`: Pushes `workInProgressTransitions` at HostRoot
- `pushTransition`: Called at Offscreen boundaries, concatenates new transitions with existing ones
- `getPendingTransitions`: Returns current stack value (used by Suspense beginWork)

### Marker Instance Stack

`markerInstanceStack` in `ReactFiberTracingMarkerComponent.js:200-276` — tracks which `TracingMarkerInstance` objects are in scope.

- `pushRootMarkerInstance`: Pushes all incomplete root-level transition markers
- `pushMarkerInstance`: Pushes a `<TracingMarker>`'s instance (appends to array)
- `getMarkerInstances`: Returns current stack value (used by Suspense beginWork)

Both stacks are popped in `completeWork` to maintain push/pop symmetry.

---

## Callback Accumulation

Six functions in `ReactFiberWorkLoop.js:545-701` lazily initialize `currentPendingTransitionCallbacks` and populate specific categories:

| Function | Category |
|----------|----------|
| `addTransitionStartCallbackToPendingTransition` | `transitionStart` |
| `addMarkerProgressCallbackToPendingTransition` | `markerProgress` |
| `addMarkerIncompleteCallbackToPendingTransition` | `markerIncomplete` |
| `addMarkerCompleteCallbackToPendingTransition` | `markerComplete` |
| `addTransitionProgressCallbackToPendingTransition` | `transitionProgress` |
| `addTransitionCompleteCallbackToPendingTransition` | `transitionComplete` |

---

## Key Design Decisions

1. **Markers capture transitions at mount time only**: A `TracingMarker` only tracks transitions active when it first rendered. Later transitions don't get added.

2. **OffscreenInstance as stable identity**: The `OffscreenInstance` (stateNode) is used as a Map key for pending boundaries because fibers can be recreated but `stateNode` persists.

3. **Idle priority dispatch**: Callbacks are dispatched at `IdleSchedulerPriority` to avoid interfering with rendering work.

4. **Queue cloning**: When the work-in-progress Offscreen queue is the same object as current, it's cloned before modification to avoid corrupting the current tree.

5. **Bailout consistency**: Even during early bailout (`attemptEarlyBailoutIfNoScheduledUpdate`), `pushMarkerInstance` is called to maintain stack push/pop symmetry.
