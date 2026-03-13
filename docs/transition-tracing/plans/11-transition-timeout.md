# Plan 11: Transition Timeout / SLA Support

## Problem Statement

The RFC mentions implementing timeouts in userland via `onTransitionStart`, but this is cumbersome and error-prone. A built-in `timeout` option on `startTransition` would enable automatic SLA monitoring without userland timer management.

---

## Proposed API

```js
startTransition(() => setPage('profile'), {
  name: 'navigate',
  timeout: 3000, // ms
});
```

When the timeout expires before the transition completes, `onTransitionTimeout` (or `onTransitionIncomplete` with a timeout reason) fires automatically. The transition continues tracking -- the actual completion time is still reported via `onTransitionComplete`.

---

## Current State

### Transition Type

**File**: `packages/react/src/ReactStartTransition.js:30-37`

```flow
export type Transition = {
  name: string | null,
  startTime: number,
  _updatedFibers?: Set<Fiber>,
};
```

No `timeout` field.

### StartTransitionOptions

**File**: `packages/shared/ReactTypes.js:147-149`

```flow
export type StartTransitionOptions = {
  name?: string,
};
```

No `timeout` field.

### Existing Timer Infrastructure

The reconciler has timeout mechanisms:

- `scheduleTimeout` / `cancelTimeout` are host config functions available in the reconciler (`packages/react-reconciler/src/ReactFiberConfig.js`). Used for Suspense timeouts, commit phase scheduling, etc.
- `packages/react-reconciler/src/ReactFiberWorkLoop.js:527-532` has `RENDER_TIMEOUT_MS = 500` for CPU suspense heuristics.
- Suspense boundaries previously supported a `timeoutMs` concept (now removed in favor of automatic heuristics).

### Transition Lifecycle Tracking

Transitions are tracked in `root.incompleteTransitions` (`Map<Transition, TracingMarkerInstance>`). A transition is "complete" when its `pendingBoundaries.size === 0` and `aborts === null`, checked in the HostRoot passive mount handler (`ReactFiberCommitWork.js:3753-3761`).

---

## Implementation Steps

### Step 1: Extend Types

**`packages/shared/ReactTypes.js`**:
```flow
type StartTransitionOptions = {
  name?: string,
  timeout?: number,  // NEW: milliseconds
};
```

**`packages/react/src/ReactStartTransition.js`**:
```flow
export type Transition = {
  name: string | null,
  startTime: number,
  timeout: number | null,  // NEW
  _updatedFibers?: Set<Fiber>,
};
```

### Step 2: Read timeout in startTransition

**`packages/react/src/ReactStartTransition.js:50-73`**:

```js
currentTransition.timeout =
  options !== undefined && options.timeout !== undefined ? options.timeout : null;
```

Same for `startGestureTransition`.

### Step 3: Add timeout callback type

**`packages/react-reconciler/src/ReactInternalTypes.js`**:

Option A -- new callback:
```flow
onTransitionTimeout?: (transitionName: string, startTime: number, timeoutMs: number) => void,
```

Option B -- extend `onTransitionIncomplete` with a `'timeout'` reason.

**Recommendation**: Option A (dedicated callback) is cleaner. Timeouts are informational, not terminal -- the transition continues tracking.

### Step 4: Register timeout timer in commit phase

**`packages/react-reconciler/src/ReactFiberCommitWork.js`** (HostRoot passive mount handler):

When `committedTransitions` are processed, for each transition with `transition.timeout !== null`:

```js
const timeoutHandle = scheduleTimeout(() => {
  // Fire onTransitionTimeout callback
  if (root.incompleteTransitions.has(transition)) {
    // Transition still incomplete -- fire timeout
    const callbacks = root.transitionCallbacks;
    if (callbacks !== null && callbacks.onTransitionTimeout != null) {
      callbacks.onTransitionTimeout(
        transition.name,
        transition.startTime,
        transition.timeout,
      );
    }
  }
}, transition.timeout);
```

Store the timeout handle on the root or marker instance for cleanup.

### Step 5: Cancel timeout on completion

When a transition completes (in the `pendingBoundaries.size === 0` branch), cancel the timeout:

```js
if (markerInstance.timeoutHandle != null) {
  cancelTimeout(markerInstance.timeoutHandle);
  markerInstance.timeoutHandle = null;
}
```

### Step 6: Add `timeoutHandle` to TracingMarkerInstance

**`packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:41-47`**:

```flow
export type TracingMarkerInstance = {
  tag?: TracingMarkerTag,
  transitions: Set<Transition> | null,
  pendingBoundaries: PendingBoundaries | null,
  aborts: Array<TransitionAbort> | null,
  name: string | null,
  timeoutHandle: TimeoutID | null,  // NEW
};
```

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/ReactTypes.js` | Add `timeout` to `StartTransitionOptions` |
| `packages/react/src/ReactStartTransition.js` | Add to `Transition` type; read from options |
| `packages/react-reconciler/src/ReactInternalTypes.js` | Add `onTransitionTimeout` callback type |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Add `timeoutHandle` to `TracingMarkerInstance` |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Register/cancel timeout in HostRoot passive mount |

---

## Design Decisions

### Timeout is Informational, Not Terminal

When the timeout fires:
- `onTransitionTimeout` is called
- The transition continues tracking normally
- `onTransitionComplete` still fires when the transition actually completes

This allows users to:
- Log SLA violations immediately
- Still measure the actual completion time
- Decide in their own code whether to take action (show degraded UI, cancel, etc.)

### Per-Transition vs Per-Marker Timeout

The timeout applies at the transition level, not per-marker. This is simpler and covers the most common use case (overall page load SLA). Per-marker timeouts could be added later via Plan 06's per-marker callback props.

### Multiple Transitions Sharing a Marker

If two transitions with different timeouts share the same markers, each transition gets its own independent timeout. This is correct because each transition represents a separate user interaction with its own SLA.

---

## Test Cases

1. **Timeout fires**: Start transition with 1000ms timeout, Suspense doesn't resolve -> `onTransitionTimeout` fires after 1000ms
2. **Timeout cancelled on completion**: Start transition with 3000ms timeout, Suspense resolves after 1000ms -> `onTransitionTimeout` does NOT fire
3. **Completion after timeout**: Timeout fires at 1000ms, Suspense resolves at 2000ms -> both `onTransitionTimeout` and `onTransitionComplete` fire
4. **No timeout option**: Start transition without timeout -> no timeout behavior
5. **Transition aborted before timeout**: TracingMarker deleted before timeout expires -> timeout is cancelled
6. **Multiple transitions with different timeouts**: Verify independent tracking

---

## Userland Alternative

The existing workaround uses `onTransitionStart` to set a `setTimeout`:

```js
let activeTimeouts = new Map();

const callbacks = {
  onTransitionStart: (name, startTime) => {
    activeTimeouts.set(name, setTimeout(() => {
      logSLAViolation(name, startTime);
    }, 3000));
  },
  onTransitionComplete: (name) => {
    const handle = activeTimeouts.get(name);
    if (handle) {
      clearTimeout(handle);
      activeTimeouts.delete(name);
    }
  },
};
```

**Problems with userland approach**:
- Must manage timer state manually
- No cleanup when transitions abort
- No way to handle multiple concurrent transitions with the same name
- Verbose boilerplate

---

## Complexity Assessment

**Estimated effort**: Medium. The core mechanism (register timer on commit, cancel on completion) is straightforward. The complexity is in edge cases: abort cleanup, multiple transitions sharing markers, and ensuring timeouts don't fire for completed transitions during the async gap between passive effects and timeout firing.

**Recommendation**: Defer to post-V1. The userland workaround is functional, and the SLA monitoring use case is less critical than core tracing accuracy. Nice to have for developer experience.
