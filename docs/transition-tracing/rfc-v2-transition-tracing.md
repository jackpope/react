# RFC v2: React Transition Tracing

## 1. Summary

Transition tracing is an experimental React feature that measures the lifecycle of `startTransition`-initiated state changes -- from the initiating user event, through Suspense boundary resolution, to paint. It provides seven root-level callbacks (`onTransitionStart`, `onTransitionProgress`, `onTransitionComplete`, `onTransitionIncomplete`, `onMarkerProgress`, `onMarkerComplete`, `onMarkerIncomplete`) registered via `createRoot`/`hydrateRoot` options, and uses `<TracingMarker>` components to scope measurements to subtrees.

The original design is described in [RFC v1](input/rfc-transition-tracing.md). The feature is gated behind the `enableTransitionTracing` flag (off in all production builds, dynamic on Meta www).

Most of the core implementation is now complete. This document covers what remains and three design questions that should be resolved before the feature moves toward shipping.

---

## 2. What's been built

### Project health and testing
- **Test coverage expansion** (Plan 17): Tests for `onTransitionIncomplete`, error boundaries, `useTransition` hook, interruption, DOM renderer, and SSR/hydration
- **Fixture app** (Plan 18): Interactive `fixtures/transition-tracing/` app with callback dashboard and configurable delays
- **DevTools component tree** (Plan 10, Phase 1): `TracingMarkerComponent` work tag, element type, and display name wired into DevTools

### Core correctness
- **Interruption handling** (Plan 19): Cross-attribution fix when a transition is interrupted by a newer transition reusing the same Suspense boundary -- wakeable identity tracking, old transition cleanup, hidden→hidden handling, and filtered `pushRootMarkerInstance`
- **`onTransitionIncomplete`** (Plan 02): 7th callback accumulator implemented and dispatched in `processTransitionCallbacks`
- **Mutable pending array** (Plan 08): `SuspenseInfo` objects cloned in progress callbacks so users can't mutate React internals
- **Abort metadata** (Plan 09): `TransitionAbort` type expanded with `endTime`, `newName`, `error`, `componentStack`; `'error'` and `'unknown'` abort reasons wired up

### Adoption readiness
- **Pre-rendering exclusion** (Plan 15): Pre-rendered (OffscreenLane) trees excluded from transition metrics at both root and per-Offscreen levels
- **Fizz TracingMarker support** (Plan 04a): `REACT_TRACING_MARKER_TYPE` handled in `renderElement` so TracingMarker renders as a transparent wrapper in SSR
- **CPU Suspense** (Plan 14): Transition tracing block copied to the CPU Suspense path in `updateSuspenseComponent`

---

## 3. Remaining implementation gaps

Three items from the [progress tracker](progress.md) remain unchecked.

### 3.1 Timestamp accuracy (Plan 01)

**Problem**: `startTime` is lazily initialized to `performance.now()` in `scheduleUpdateOnFiber`. This is functionally correct (the `scope()` callback runs synchronously, so timing is nearly identical), but it misses event dispatch overhead. The RFC intended `startTime` to use `window.event.timeStamp`, which captures when the browser generated the event -- before any JS runs. On the end-time side, the DOM host config doesn't implement `requestPostPaintCallback`, so end times may not reflect actual paint.

**Recommended approach** ([Plan 01 details](plans/01-timestamp-accuracy.md)):

1. Add a `TS` (TransitionStartTime) field to `ReactSharedInternalsClient`, following the existing `S` hook pattern that bridges the `react` package to host config functions
2. In `ReactFiberTransition.js`, register a `TS` provider that reads `resolveEventTimeStamp()` (which already exists in `ReactFiberConfigDOM.js` and handles `window.event` availability), falling back to `now()`
3. In `startTransition`, call `ReactSharedInternals.TS()` instead of deferring to `-1`
4. Keep the existing lazy `now()` fallback in `scheduleUpdateOnFiber` for renderers that don't register `TS`
5. Implement `requestPostPaintCallback` for DOM using `rAF + setTimeout(0)` for accurate post-paint end times

**Scope**: Medium effort, 6 files modified.

### 3.2 Redundant `clearTransitionsForLanes` (Plan 16)

**Problem**: Two identical `clearTransitionsForLanes` calls exist in the HostRoot passive mount path. The first clears after processing `committedTransitions`, the second after checking `incompleteTransitions`. The first call makes the second redundant for the same lanes.

**Fix**: Remove the first call. Trivial -- 1 line removed.

### 3.3 Batched disambiguation (Plan 12)

**Problem**: When transitions batch in the same tick (e.g., clicking Home then Marketplace quickly), consumers must use the RFC's heuristic (compare transition name to marker name) to determine which transition actually rendered. This is error-prone.

**Proposed enhancement**: Add `batchedWith` info to `onTransitionStart` -- when transitions are batched together, each callback receives the names of other transitions in the batch. This lets consumers disambiguate without manual string matching.

**Status**: Originally P1, reverted to P3. Depends on interruption handling (now complete). The `batchedWith` field would be populated from the `transitionLanes` map which already tracks multiple transitions per lane.

**Recommendation**: Implement as a follow-up after the other gaps are closed. Low risk, medium value.

---

## 4. Design consideration: Transition types integration

### Background

The `Transition` object carries fields for two related but independent systems:

```flow
type Transition = {
  types: null | TransitionTypes,     // View Transitions (enableViewTransition)
  gesture: null | GestureProvider,   // Gesture Transitions (enableGestureTransition)
  name: null | string,               // Transition Tracing (enableTransitionTracing)
  startTime: number,                 // Transition Tracing (enableTransitionTracing)
};
```

`transition.types` (an `Array<string>`) is managed by `addTransitionType()` and consumed by the view transition system to drive CSS view-transition classes. `transition.name` and `transition.startTime` are consumed by the tracing system to drive callbacks.

Currently these two systems don't cross-reference. A transition can have `types` but no `name` (view transition only), a `name` but no `types` (traced only), or both.

### Questions

1. **Should transition types flow into tracing callbacks?** For example, `onTransitionStart(name, startTime, types)` would let analytics consumers correlate view transition classifications with performance measurements.

2. **Should tracing callbacks fire for unnamed transitions that have types?** Currently, only transitions with a `name` are traced. An unnamed transition with `types: ['nav-forward']` is invisible to the tracing system.

### Recommendation

**Pass `types` through to tracing callbacks as optional metadata.** When a transition has both a `name` and `types`, include `types` as a parameter in the callbacks. This is low-effort (the `Transition` object already carries both fields) and high-value for analytics that want to correlate transition categories with timing.

**Don't auto-trace unnamed transitions.** The tracing system is opt-in by design -- only named transitions are tracked. Auto-tracing every typed transition would change the semantics and potentially create noise. If a consumer wants to trace a view transition, they should add a `name` to the `startTransition` call.

---

## 5. Design consideration: Hydration transition tracing

### Background

The RFC lists hydration tracing as a "Future Goal." [Plan 04](plans/04-hydration-tracing.md) describes a 6-phase implementation that would add `onHydrationStart/Complete/Progress/Incomplete` callbacks for tracking the hydration lifecycle.

### Overlap with performance tracks

The `enableComponentPerformanceTrack` system already provides significant hydration visibility in Chrome DevTools:

| Capability | Performance Tracks | Proposed Hydration Tracing |
|---|---|---|
| Per-component hydration color coding | Yes (teal palette) | No |
| "Hydrated" / "Hydration Failed" render phase labels | Yes | No |
| Boundary-level dehydrated→hydrated detection | Yes | Yes |
| Programmatic callbacks for RUM | No | Yes |
| Named boundary tracking (`<Suspense name="...">`) | No | Yes |
| TracingMarker grouping of hydration regions | No | Yes |
| Progress events as boundaries hydrate | No | Yes |

### Current state

Phase 1 (Fizz TracingMarker support) is already complete -- TracingMarker renders as a transparent wrapper in the server renderer, so it can be used in SSR apps without crashing.

### Recommendation

**Don't pursue hydration-specific callbacks (Phases 2-6).** Performance tracks already cover the DevTools visualization need with per-component hydration timing, color coding, and failure detection. The main unique value of hydration tracing callbacks -- programmatic RUM for hydration TTI -- is a real but niche use case that doesn't justify the significant implementation complexity (new tracking path without `Transition` objects, new marker tag, synthetic timing infrastructure).

If production RUM for hydration is needed later, the Fizz foundation from Phase 1 is in place and Phases 2-6 can be revisited.

---

## 6. Design consideration: Chrome Performance tracks display

### Background

React already emits custom Chrome Performance tracks via `console.timeStamp()` for components, scheduler lanes, and render/commit phases. [Plan 10](plans/10-devtools-integration.md) describes adding a "Transitions" track group following the same pattern.

### Proposed approach

A **"Transitions ⚛"** track group in the Chrome Performance panel, with individual transitions as sub-tracks:

| Entry type | Representation | Color coding |
|---|---|---|
| Transition lifecycle | Timed entry spanning start→complete | Duration-based: `primary-light` (<100ms), `primary` (100ms-1s), `primary-dark` (>1s), `error` (>5s) |
| Transition incomplete | Timed entry spanning start→abort | `warning` or `error` by abort reason |
| Marker lifecycle | Nested entry within transition track | `secondary` / `secondary-light` |
| Marker progress | Zero-width marker with tooltip | `secondary-light`, tooltip lists pending boundary names |

The logging functions would be called from `processTransitionCallbacks()` after dispatching each user callback, keeping Chrome track entries in sync with callback data without duplicating lifecycle detection logic.

In DEV builds, `performance.measure()` with the `detail.devtools` convention would attach rich tooltip data (transition name, duration, pending boundaries).

### Recommendation

**Implement Phase 2 (Chrome Performance Track).** This follows established patterns in `ReactFiberPerformanceTrack.js`, is gated behind both `enableTransitionTracing` and `enableProfilerTimer`, and provides immediate visual value in Chrome DevTools.

**Skip Phase 3 (profiling hooks bridge)** unless there's demand. The `performance.mark()` hooks in `react-devtools-shared` are a lightweight extension but add a second emission path. The Chrome Performance track from Phase 2 is the primary visualization target.
