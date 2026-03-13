# Plan 07: Transition Metadata / Tags

## Problem Statement

Transitions only have a `name`. There is no way to attach arbitrary metadata (user ID, page type, A/B test bucket, navigation context) that would be useful for analytics. Users must maintain external maps from transition names to metadata, which is error-prone and loses the temporal binding between transition and context.

---

## Proposed API

```js
startTransition(() => setPage('profile'), {
  name: 'navigate',
  metadata: {
    from: 'home',
    to: 'profile',
    userId: currentUser.id,
    experimentBucket: 'control',
  },
});
```

The metadata would flow through to all callbacks as an additional parameter.

---

## Current State: Transition Data Flow

### Transition Type

**File**: `packages/react/src/ReactStartTransition.js:30-37`

```flow
export type Transition = {
  name: string | null,
  startTime: number,
  _updatedFibers?: Set<Fiber>,
};
```

### Creation

**File**: `packages/react/src/ReactStartTransition.js:50-73`

```js
const currentTransition: Transition = ({}: any);
if (enableTransitionTracing) {
  currentTransition.name =
    options !== undefined && options.name !== undefined ? options.name : null;
  currentTransition.startTime = -1;
}
```

### StartTransitionOptions

**File**: `packages/shared/ReactTypes.js`

```flow
type StartTransitionOptions = {
  name?: string,
};
```

### How `name` Flows to Callbacks

1. **Creation**: `startTransition` reads `options.name` and sets `currentTransition.name`
2. **Lane mapping**: `addTransitionToLanesMap` (`ReactFiberLane.js:1209-1225`) stores the `Transition` object (with its `name`) in the root's `transitionLanes` map
3. **Render**: `getTransitionsForLanes` collects `Transition` objects into `workInProgressTransitions`
4. **Commit**: `committedTransitions` passed to HostRoot passive mount handler
5. **Accumulation**: `addTransitionStartCallbackToPendingTransition` etc. receive the full `Transition` object
6. **Dispatch**: `processTransitionCallbacks` (`ReactFiberTracingMarkerComponent.js:60-193`) reads `transition.name` and passes it to user callbacks

### Callback Signatures

**File**: `packages/react-reconciler/src/ReactInternalTypes.js:326-356`

```flow
type TransitionTracingCallbacks = {
  onTransitionStart?: (transitionName: string, startTime: number) => void,
  onTransitionProgress?: (transitionName: string, startTime: number, currentTime: number, pending: Array<{name: null | string}>) => void,
  onTransitionComplete?: (transitionName: string, startTime: number, endTime: number) => void,
  // ... marker callbacks also receive transitionName
};
```

---

## Implementation Steps

### Step 1: Extend StartTransitionOptions

**File**: `packages/shared/ReactTypes.js`

```flow
type StartTransitionOptions = {
  name?: string,
  metadata?: mixed,  // NEW
};
```

### Step 2: Add `metadata` to Transition type

**File**: `packages/react/src/ReactStartTransition.js:30-37`

```flow
export type Transition = {
  name: string | null,
  startTime: number,
  metadata: mixed,  // NEW
  _updatedFibers?: Set<Fiber>,
};
```

### Step 3: Read metadata in startTransition

**File**: `packages/react/src/ReactStartTransition.js:50-73`

Add after setting `name`:
```js
currentTransition.metadata =
  options !== undefined && options.metadata !== undefined ? options.metadata : null;
```

Same change for `startGestureTransition`.

### Step 4: Update callback signatures

**File**: `packages/react-reconciler/src/ReactInternalTypes.js:326-356`

Add `metadata?: mixed` parameter to all transition-level callbacks:

```flow
onTransitionStart?: (transitionName: string, startTime: number, metadata?: mixed) => void,
onTransitionProgress?: (transitionName: string, startTime: number, currentTime: number, pending: Array<{name: null | string}>, metadata?: mixed) => void,
onTransitionComplete?: (transitionName: string, startTime: number, endTime: number, metadata?: mixed) => void,
onTransitionIncomplete?: (transitionName: string, startTime: number, deletions: Array<...>, metadata?: mixed) => void,
```

For marker callbacks, the metadata is passed from the parent transition:
```flow
onMarkerComplete?: (transitionName: string, markerName: string, startTime: number, endTime: number, metadata?: mixed) => void,
// ... same pattern for onMarkerProgress, onMarkerIncomplete
```

### Step 5: Pass metadata through processTransitionCallbacks

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:60-193`

In each callback dispatch, read `transition.metadata` and pass it as the final argument:

```js
// Example: onTransitionStart dispatch
transitionStart.forEach(transition => {
  if (transition.name != null) {
    onTransitionStart(transition.name, transition.startTime, transition.metadata);
  }
});
```

Same pattern for all 7 callback types.

### Step 6: Update accumulator functions

The accumulator functions in `ReactFiberWorkLoop.js:545-700` store the full `Transition` object. Since `metadata` is already on the object, no changes needed to the accumulators -- they already carry the transition reference through.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/ReactTypes.js` | Add `metadata` to `StartTransitionOptions` |
| `packages/react/src/ReactStartTransition.js` | Add to `Transition` type; read from options |
| `packages/react-reconciler/src/ReactInternalTypes.js` | Add `metadata` parameter to all callback signatures |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Pass `transition.metadata` in `processTransitionCallbacks` |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | Add test cases |

---

## Test Cases

1. **Metadata passed to `onTransitionStart`**: Start transition with metadata, verify it arrives in callback
2. **Metadata passed to `onTransitionComplete`**: Same metadata appears in completion callback
3. **Metadata passed to marker callbacks**: `onMarkerComplete` receives the originating transition's metadata
4. **No metadata**: `startTransition` without metadata option -- callbacks receive `null`/`undefined`
5. **Multiple transitions with different metadata**: Each callback gets the correct transition's metadata
6. **Metadata is opaque**: Verify React doesn't read, clone, or modify the metadata object

---

## Risks

1. **Memory**: Metadata is held in memory from transition start until all callbacks dispatch. Large metadata objects could contribute to memory pressure, but this is the user's responsibility.
2. **Serialization**: The metadata type is `mixed`. React doesn't serialize it. Users who need cross-worker support must handle serialization themselves.
3. **API surface**: Adding a parameter to every callback is a significant API change. Using `mixed` rather than a generic keeps it simple.

---

## Complexity Assessment

**Estimated effort**: Low. This is a mechanical change that extends existing types and passes an additional field through existing plumbing. No new control flow, no new data structures, no architectural changes.
