# React Transition Tracing: Implementation

## New API

### `startTransition`

```js
startTransition(callback: () => void, transition?: {name?: string});
```

Optional `transition` config object with a `name` field.

### `<Suspense>`

```jsx
<Suspense name={string} />
```

Optional `name` prop for more detailed transition data.

### `<TracingMarker>`

```jsx
<TracingMarker name={string} />
```

New component for marking tracked subtrees.

### `createRoot` Callbacks

```js
createRoot(container, options: CreateRootOptions);
```

```ts
type CreateRootOptions = {
  onTransitionStart: (
    transitionName: string,
    startTime: number,
  ) => void;

  onTransitionProgress: (
    transitionName: string,
    startTime: number,
    currentTime: number,
    pending: Array<{name: null | string}>,
  ) => void;

  onMarkerProgress: (
    transitionName: string,
    marker: string,
    startTime: number,
    currentTime: number,
    pending: Array<{name: null | string}>,
  ) => void;

  onTransitionIncomplete: (
    transitionName: string,
    startTime: number,
    deletions: Array<{
      type: string;
      name?: string;
      newName?: string;
      endTime: number;
    }>,
  ) => void;

  onMarkerIncomplete: (
    transitionName: string,
    marker: string,
    startTime: number,
    deletions: Array<{
      type: string;
      name?: string;
      newName?: string;
      endTime: number;
    }>,
  ) => void;

  onTransitionComplete: (
    transitionName: string,
    startTime: number,
    endTime: number,
  ) => void;

  onMarkerComplete: (
    transitionName: string,
    marker: string,
    startTime: number,
    endTime: number,
  ) => void;
};
```

## Data Structures

### `currentPendingTransitionCallbacks`

A global variable in the work loop containing all newly generated transition callback calls within a unit of work. Contains pending callbacks that haven't been called yet. Stored here so we can use paint time for the transition (which may not happen before the passive phase). The lifetime of callbacks is per frame.

Type: `Array<dataObject>`

Pending transition callbacks are stored at the work loop level during render/commit and transferred to a config object (like `ReactCurrentBatchConfig`) after commit. The host config then calls the callback with the appropriate end time. This is done here rather than in the passive phase because the passive phase sometimes occurs before paint.

## Algorithm

### Host Config: Start Time

On React DOM:

1. Use `window.event.timestamp` if it exists.
2. Otherwise, approximate using `performance.now()` when `startTransition` is called.

> **Note (React Native):** React Native currently only has timestamps for Touch events. Options include working with React Native to add timestamps for all events, or using `performance.now()` as an approximation.

### Host Config: End Time

On React DOM:

1. Use `requestAnimationFrame` to get the end time of the most recent unit of work.
2. The RAF callback sets end times on `ReactPendingTransitionCallbacksConfig` and uses `setTimeout` to process the callbacks.

### `startTransition`

When called:

1. Store transition info (name and start time) in `ReactCurrentBatchConfig`.
2. When scheduling the actual update, move the transition info onto the root in a lane-to-transition map for access during render.

### Render Phase

**Key observation:** A tracing marker is part of a transition only if the marker was mounted, updated with a different name, or flipped from offscreen to visible as part of the transition update or retry. If a tracing marker has a different set of transitions, it was rendered by a different transition.

Transitions are **complete** when there are no more unresolved Suspense boundaries in the transition's subtree. They are **incomplete** if a boundary/marker was deleted or an error occurs before all Suspense boundaries resolve.

#### Algorithm

1. **Store pending transitions on the Suspense Offscreen boundary.** When a render is initiated via a transition, move initiated transitions from the root to a transition stack.
2. **Unresolved Suspense boundary encountered:** Add all transitions on the stack to the boundary.
   - If the fallback has already been rendered, skip (it belongs to a different transition).
3. **Resolved boundary encountered:** Add the boundary's transitions onto the stack. The next unresolved boundary will inherit both the current transitions and the parent boundary's transitions.
4. **Subtree flag:** Add a flag indicating whether any Suspense boundaries in a fiber's subtree are in the fallback state. Used for fiber traversal and future features.
5. **TracingMarker processing:** Store a list of unresolved transition names and a set of unresolved Suspense boundaries on each TracingMarker.
   - When encountering a newly mounted marker, a marker with a changed name, or a marker going from offscreen to visible, add all transitions on the stack to the marker.
   - If a marker changed its name, all unresolved transitions on it are considered incomplete (processed in the commit phase).
6. **Suspense boundary sets:** Store a pointer to the TracingMarker's pending set on each Suspense boundary changing state (fallback to render or render to fallback). Modifications happen in the commit phase.
7. **Root-level tracking:** Same as TracingMarker, with a `{[transitionName]: Set<suspenseBoundaryPointer>}` map.

The algorithm is the same for initial transitions, entangled transitions, and retries. The only difference is the initial stack contents: for initial transitions, the stack starts with the transition name(s); for retries, it starts empty because the names were already moved onto the Suspense boundaries.

### Commit Phase

#### Mutation Phase

1. **Add Suspense boundary sets:** Store the set-to-modify (from the render phase) on the Suspense boundary for editing in the commit phase.

2. **Process incomplete transitions (deletion phase):** When encountering a deleted Suspense boundary or TracingMarker, all pending transitions on them are incomplete.
   - Trace up return fibers, finding all TracingMarkers and the root.
   - Add `onMarkerIncomplete`/`onTransitionIncomplete` entries in `currentPendingTransitionCallbacks` for the intersection of transitions on the markers/root and the deleted element.
   - Combine deletions per transition when calling callbacks.

3. **Process complete and progress transitions (mutation complete phase):**
   - If a marker's name changed, process as incomplete (same as deletions).
   - If a subtree goes from onscreen to offscreen, all markers in the subtree are incomplete.
   - For every **Suspense boundary**:
     - Newly committed in fallback state: add the pointer to the set.
     - Going from fallback to resolved: remove the pointer from the set.
   - For every **TracingMarker**:
     - Check the pending Suspense boundaries set. The transition is complete if the set is empty.
     - Add `onMarkerProgress` entry for every transition on the marker.
     - Add `onMarkerComplete` entry for every completed transition.
     - If `onMarkerProgress` is not defined, skip gathering pending boundaries (performance optimization).
   - Process the root the same way using `onTransitionProgress` and `onTransitionComplete`.

4. **Transfer callbacks:** At the end of the commit phase, transfer `currentPendingTransitionCallbacks` to `ReactPendingTransitionCallbacksConfig` so the variable is available for the next unit of work.

5. **Schedule end time:** If there are transition callbacks to process, call the host config function to get the end time and schedule callback processing.

## Project Checklist

### Setup

- [ ] Create `enableTransitionTracing` feature flag
- [ ] Create `TracingMarker` component boilerplate
- [ ] Add transition callback functions as arguments to the root
- [ ] Add `currentPendingTransitionCallbacks` global on `ReactFiberWorkLoop` (type: `Array<dataObject>`)
- [ ] Create ReactDOMHostConfig function to get start time
- [ ] Create ReactDOMHostConfig function to get end time and process callbacks

### Render Phase

- [ ] Add `transitionName` to `startTransition`, store start time and name in batch config, pass to root on render
- [ ] Create a stack for active transitions and their pending Suspense boundary sets
- [ ] Add code on TracingMarkers in the begin phase to add pending transitions on mount and remove interactions on name change
- [ ] Add `name` field on Suspense boundary
- [ ] Process the root during render phase by adding new transitions onto the stack
- [ ] Process Suspense boundaries during render phase:
  - [ ] Fallback state: store pending transitions on the Suspense Offscreen component
  - [ ] Fallback state: add TracingMarker pending set pointer to the Offscreen component
  - [ ] Fallback to rendered: add pending transitions from Offscreen to stack, clear Offscreen transitions
  - [ ] Fallback to rendered: add TracingMarker pending set pointer to the Offscreen component
  - [ ] Fallback to rendered: pop the stack during the complete phase
- [ ] Propagate Suspense fallback subtree flag (any fallback in subtree) during complete phase
- [ ] Propagate resolved fallback subtree flag (any just-resolved fallback in subtree) during complete phase
- [ ] Add transitions to the root

### Commit Phase

- [ ] Create subtree traversal function using the Suspense fallback subtree flag to find all fallback boundary names and pending transitions; call during mutation phase for TracingMarkers/root

### Callbacks

- [ ] If TracingMarker name changed during update, process this and all parent TracingMarkers/root as incomplete
- [ ] During deletion phase, process deleted TracingMarkers/Suspense boundaries as incomplete for all parent markers/root
- [ ] During mutation phase for Suspense boundaries:
  - [ ] Fallback state: add boundary pointer to TracingMarker set
  - [ ] Fallback to rendered: remove boundary pointer from TracingMarker set
- [ ] During mutation phase for TracingMarkers:
  - [ ] Name changed: propagate canceled transitions up, add intersection to `currentPendingTransitionCallbacks`, remove from marker
  - [ ] No remaining fallback boundaries: transition complete, add to `currentPendingTransitionCallbacks`
  - [ ] Add `onMarkerProgress` to `currentPendingTransitionCallbacks` with pending Suspense boundary info
- [ ] Process root `onTransitionComplete` and `onTransitionProgress` the same way as TracingMarkers
- [ ] Create function to process all callbacks in `currentPendingTransitionCallbacks` and clear them
- [ ] Combine fallbacks if possible

### Other

- [ ] Write tests
- [ ] Integrate DevTools (use commit time to link Profiler data with transition tracing data)
