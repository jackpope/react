# Plan 10: DevTools Integration -- Chrome Performance Track

## Problem Statement

No DevTools integration exists. Transition tracing data is only available through root-level callbacks. Users have no way to visualize transition lifecycles in their browser tooling.

React already emits custom Chrome Performance tracks via `console.timeStamp()` for components, scheduler lanes (Blocking, Transition, Suspense, Idle), and render/commit phases. Transition tracing should follow the same pattern -- a dedicated "Transitions" track (or track group) in the Chrome Performance panel showing transition and marker lifecycles as timed entries.

The DevTools Profiler panel is deprecated and should **not** be a target for this integration.

---

## What Already Exists

### TracingMarker in DevTools component tree

| Aspect | Status |
|--------|--------|
| `TracingMarkerComponent` in `WorkTagMap` | Done (renderer.js:412) |
| `ElementTypeTracingMarker = 14` | Done (frontend/types.js:51) |
| `getDisplayNameForFiber()` returns `'TracingMarker'` | Done (renderer.js:717-718) |
| `getElementTypeForFiber()` returns correct type | Done (renderer.js:1735-1736) |
| Not filtered by `shouldFilterFiber()` | Done |
| `name` prop extracted for tree display | **NOT DONE** |
| Transition state in inspector | **NOT DONE** |

### Existing performance track infrastructure

React uses `console.timeStamp(label, startTime, endTime, track, trackGroup, color)` to emit entries to Chrome's custom performance tracks. Key patterns in `ReactFiberPerformanceTrack.js`:

- **Track constants**: `COMPONENTS_TRACK = 'Components ⚛'`, `LANES_TRACK_GROUP = 'Scheduler ⚛'`
- **Track ordering**: `markAllLanesInOrder()` emits zero-width entries at time 0 to establish track order
- **DEV vs prod**: In DEV, entries are emitted via `debugTask.run(console.timeStamp.bind(...))` for async stack trace attribution; in prod, direct `console.timeStamp()` calls
- **`performance.measure()` with devtools detail**: Used in DEV for component renders to attach tooltip properties (changed props, self time, etc.)
- **Color coding**: Uses Chrome's named colors (`primary`, `primary-light`, `secondary`, `warning`, `error`, etc.)
- **Guard**: All behind `supportsUserTiming` check (requires `enableProfilerTimer` + `console.timeStamp` support)

---

## Phase 1: Component Tree Support (Low effort)

### 1a. Extract `name` prop

**File**: `packages/react-devtools-shared/src/backend/fiber/renderer.js` (~line 2375)

Add `TracingMarkerComponent` to the `nameProp` extraction alongside `SuspenseComponent` and `ActivityComponent`.

### 1b. Show transition state in inspector

In `inspectElementRaw()`, expose `TracingMarkerInstance` data: transitions (names, startTimes), pending boundaries, and status (pending/complete/incomplete).

---

## Phase 2: Chrome Performance Track (Medium effort)

Emit transition tracing events as entries on a custom Chrome Performance track, following the same `console.timeStamp()` pattern used by the existing scheduler and component tracks.

### 2a. Define track constants

**File**: `packages/react-reconciler/src/ReactFiberPerformanceTrack.js`

```js
const TRANSITIONS_TRACK_GROUP = 'Transitions ⚛';
```

Individual transitions get their own sub-track within the group, keyed by their `name`. Markers appear as nested entries within their transition's track.

### 2b. Register tracks in `markAllLanesInOrder()`

**File**: `packages/react-reconciler/src/ReactFiberPerformanceTrack.js`

Add a zero-width entry for the Transitions track group so it appears in the correct order in Chrome's Performance panel. Since individual transition tracks are dynamic (created per `startTransition` call with a `name`), we only need to register the group header.

Gate behind `enableTransitionTracing` feature flag.

### 2c. Add logging functions

**File**: `packages/react-reconciler/src/ReactFiberPerformanceTrack.js`

Add functions following the existing patterns:

```js
export function logTransitionStart(
  name: string,
  startTime: number,
): void {
  // Emit a zero-width entry to mark transition start
  // Track: transition name, TrackGroup: TRANSITIONS_TRACK_GROUP
  // Color: primary-light
}

export function logTransitionComplete(
  name: string,
  startTime: number,
  endTime: number,
): void {
  // Full-width entry spanning transition lifetime
  // Color: primary (short) / primary-dark (long) / error (very long)
}

export function logTransitionIncomplete(
  name: string,
  startTime: number,
  endTime: number,
  abortReason: string,
): void {
  // Color: warning or error depending on abort reason
}

export function logMarkerComplete(
  transitionName: string,
  markerName: string,
  startTime: number,
  endTime: number,
): void {
  // Nested entry within the transition's track
  // Label: markerName
  // Color: secondary / secondary-light
}

export function logMarkerIncomplete(
  transitionName: string,
  markerName: string,
  startTime: number,
  endTime: number,
  abortReason: string,
): void {
  // Color: warning
}

export function logMarkerProgress(
  transitionName: string,
  markerName: string,
  time: number,
  pendingBoundaries: Array<string>,
): void {
  // Zero-width marker with tooltip showing pending boundary names
  // Color: secondary-light
}
```

Color coding scheme:
| Event | Color |
|-------|-------|
| Transition complete (< 100ms) | `primary-light` |
| Transition complete (100ms - 1s) | `primary` |
| Transition complete (> 1s) | `primary-dark` |
| Transition complete (> 5s) | `error` |
| Transition incomplete | `warning` |
| Marker complete | `secondary` |
| Marker incomplete | `warning` |
| Marker progress | `secondary-light` |

### 2d. Call logging functions from transition callback dispatch

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js`

In `processTransitionCallbacks()`, after dispatching each user callback, call the corresponding `log*` function from `ReactFiberPerformanceTrack.js`. This keeps the Chrome track entries in sync with the callback data without duplicating the lifecycle detection logic.

For `onTransitionStart`:
```js
if (onTransitionStart != null) {
  onTransitionStart(transition.name, transition.startTime);
}
logTransitionStart(transition.name, transition.startTime);
```

Similarly for `onTransitionComplete`, `onMarkerComplete`, `onMarkerProgress`, `onMarkerIncomplete`.

### 2e. Tooltip properties (DEV only)

For DEV builds, use `performance.measure()` with the `detail.devtools` convention (same as component renders) to attach rich tooltip data:

- **Transition entries**: Show transition name, duration, number of markers
- **Marker entries**: Show marker name, transition name, pending boundaries at completion
- **Progress entries**: Show list of pending Suspense boundary names

---

## Phase 3: Profiling Hooks Bridge (Low effort, optional)

### 3a. Emit `performance.mark()` entries

**File**: `packages/react-devtools-shared/src/backend/profilingHooks.js`

In `createProfilingHooks()`, add `markTransitionStarted`, `markTransitionComplete`, `markMarkerComplete` hooks that emit `performance.mark()` calls. These can be consumed by any tooling that reads User Timing marks (not just Chrome DevTools).

This is a lightweight bridge -- the primary visualization is the Chrome Performance track from Phase 2.

---

## Key Files

### Phase 1
| File | Action |
|------|--------|
| `packages/react-devtools-shared/src/backend/fiber/renderer.js` | Add name prop + inspector state |

### Phase 2
| File | Action |
|------|--------|
| `packages/react-reconciler/src/ReactFiberPerformanceTrack.js` | Add track constants + logging functions |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Call logging functions from callback dispatch |

### Phase 3 (optional)
| File | Action |
|------|--------|
| `packages/react-devtools-shared/src/backend/profilingHooks.js` | Add performance.mark() hooks |

---

## Risks

1. **Feature flag guard**: All Phase 2 changes must be gated on both `enableTransitionTracing` and `enableProfilerTimer` (the latter gates `supportsUserTiming`)
2. **Performance**: `console.timeStamp()` calls are cheap but should still be behind the `supportsUserTiming` guard
3. **Track proliferation**: Many concurrent named transitions could create many sub-tracks in Chrome. Consider collapsing unnamed transitions or limiting track count
4. **Timestamp accuracy**: Depends on Plan 01 (Timestamp Accuracy) for correct start/end times. Current `performance.now()` timestamps are functional but may miss event dispatch overhead
5. **`onTransitionIncomplete` dependency**: Phase 2 logging for incomplete transitions depends on Plan 02 (implementing the incomplete callback). Can be added incrementally
