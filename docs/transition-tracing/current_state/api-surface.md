# Transition Tracing: Current API Surface

## Feature Flag

The feature is gated behind `enableTransitionTracing`.

| Build | Value | Notes |
|-------|-------|-------|
| Default (OSS) | `false` | `packages/shared/ReactFeatureFlags.js:104` |
| www (Meta) | dynamic (`__VARIANT__`) | GK-controlled via `ReactFeatureFlags.www-dynamic.js` |
| React Native (OSS) | `false` | |
| React Native (FB) | `false` | |
| Test renderer | `false` | |
| Test renderer (www) | `false` | |

The flag is **off everywhere** except Meta's www build where it's dynamically gated.

---

## Public API Components

### 1. `React.unstable_TracingMarker`

A component that marks a subtree for transition tracking.

- **Export**: `packages/react/src/ReactClient.js:125` — exported as `unstable_TracingMarker`
- **Symbol**: `Symbol.for('react.tracing_marker')` — defined in `packages/shared/ReactSymbols.js:37`
- **Work tag**: `TracingMarkerComponent = 25` — defined in `packages/react-reconciler/src/ReactWorkTags.js:67`
- **Note**: The symbol is unconditionally exported. Feature flag gating happens in the reconciler.

**Props**:
```jsx
<React.unstable_TracingMarker name="marker-name">
  {children}
</React.unstable_TracingMarker>
```

- `name: string` — identifies this marker in callbacks

### 2. `startTransition` with `name` option

```js
startTransition(callback, options?)
```

- **Options type** (`packages/shared/ReactTypes.js:147-149`):
  ```flow
  type StartTransitionOptions = {
    name?: string,
  };
  ```

- The `name` option is also available on the `startTransition` function returned by `useTransition()`.
- When a `name` is provided, the transition is registered for tracing.
- When no `name` is provided, the transition is invisible to the tracing system.

### 3. Suspense `name` prop

```jsx
<Suspense name="boundary-name" fallback={...}>
```

- Optional prop that identifies a Suspense boundary in progress/incomplete callbacks.
- Does **not** define the scope of a transition — only provides metadata.

### 4. `createRoot` / `hydrateRoot` with `unstable_transitionCallbacks`

Both `createRoot` and `hydrateRoot` accept transition callbacks:

```js
const root = createRoot(container, {
  unstable_transitionCallbacks: {
    onTransitionStart,
    onTransitionProgress,
    onTransitionComplete,
    onTransitionIncomplete,
    onMarkerProgress,
    onMarkerComplete,
    onMarkerIncomplete,
  },
});
```

- **Defined in**: `packages/react-dom/src/client/ReactDOMRoot.js:30-32` (createRoot), `:57-58` (hydrateRoot)
- **Passed to**: `createContainer` / `createHydrationContainer`, then stored on `FiberRoot.transitionCallbacks`
- **Also supported by**: `react-noop-renderer` (for testing)

---

## Callback Type Signatures

Defined in `packages/react-reconciler/src/ReactInternalTypes.js:318-363`:

```flow
type TransitionTracingCallbacks = {
  onTransitionStart?: (
    transitionName: string,
    startTime: number,
  ) => void,

  onTransitionProgress?: (
    transitionName: string,
    startTime: number,
    currentTime: number,
    pending: Array<{name: null | string}>,
  ) => void,

  onTransitionIncomplete?: (
    transitionName: string,
    startTime: number,
    deletions: Array<{
      type: string,
      name?: string | null,
      endTime: number,
    }>,
  ) => void,

  onTransitionComplete?: (
    transitionName: string,
    startTime: number,
    endTime: number,
  ) => void,

  onMarkerProgress?: (
    transitionName: string,
    marker: string,
    startTime: number,
    currentTime: number,
    pending: Array<{name: null | string}>,
  ) => void,

  onMarkerIncomplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    deletions: Array<{
      type: string,
      name?: string | null,
      endTime: number,
    }>,
  ) => void,

  onMarkerComplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    endTime: number,
  ) => void,
};
```

All 7 callbacks are optional. They are called at **idle scheduler priority** after passive effects flush.

---

## Callback Semantics

| Callback | When it fires |
|----------|---------------|
| `onTransitionStart` | When a named transition's first update commits |
| `onTransitionProgress` | When a Suspense boundary under the root suspends or resolves |
| `onTransitionComplete` | When all Suspense boundaries in the transition resolve |
| `onTransitionIncomplete` | When the transition is aborted (marker/boundary deleted, error) |
| `onMarkerProgress` | When a Suspense boundary under a `TracingMarker` suspends or resolves |
| `onMarkerComplete` | When all Suspense boundaries inside a `TracingMarker` resolve |
| `onMarkerIncomplete` | When a marker is aborted (deleted, renamed, child error) |

---

## Internal Type: `Transition`

The `Transition` object flows through the system. Defined in `packages/react/src/ReactStartTransition.js:30-37`:

```flow
type Transition = {
  types: null | TransitionTypes,     // enableViewTransition
  gesture: null | GestureProvider,   // enableGestureTransition
  name: null | string,               // enableTransitionTracing
  startTime: number,                 // enableTransitionTracing
  _updatedFibers: Set<Fiber>,        // DEV-only
};
```

---

## FiberRoot Properties

Defined in `packages/react-reconciler/src/ReactInternalTypes.js:366-376`:

```flow
type TransitionTracingOnlyFiberRootProperties = {
  transitionCallbacks: null | TransitionTracingCallbacks,
  transitionLanes: LaneMap<Set<Transition> | null>,
  incompleteTransitions: Map<Transition, TracingMarkerInstance>,
};
```

- `transitionCallbacks`: User-provided callbacks from `createRoot` options
- `transitionLanes`: Maps lanes to the transitions that use them
- `incompleteTransitions`: Tracks all transitions that haven't completed yet, each associated with a root-level `TracingMarkerInstance`
