# RCP: Transition Tracing — Status and Open Design Questions

## Background

[RFC v1](../transition-tracing/input/rfc-transition-tracing.md) introduced transition tracing — an API that measures the lifecycle of `startTransition`-initiated state changes, from the initiating user event through Suspense boundary resolution to paint. The core problem: when a user taps a nav link and the page takes seconds to appear, existing tooling can't tell you whether the delay came from data fetching, lazy-loaded components, or nested Suspense boundaries. Transition tracing gives you that breakdown through seven root-level callbacks registered via `createRoot`/`hydrateRoot` and `<TracingMarker>` components that scope measurements to subtrees.

The feature is gated behind the `enableTransitionTracing` flag (off in all production builds, dynamic on Meta www). Most of the core implementation is now complete. This document covers remaining work and three design questions that should be resolved before the feature moves toward shipping.

---

## Implementation Status

### Core correctness
- **Interruption handling**: When a transition is interrupted by a newer transition reusing the same Suspense boundary, wakeable identity tracking ensures cross-attribution is correct — old transitions are cleaned up and `pushRootMarkerInstance` is properly filtered
- **`onTransitionIncomplete`**: 7th callback fully implemented and dispatched in `processTransitionCallbacks`
- **Mutable pending array**: `SuspenseInfo` objects are cloned in progress callbacks so consumers can't mutate React internals
- **Abort metadata**: `TransitionAbort` type expanded with `endTime`, `newName`, `error`, `componentStack`; `'error'` and `'unknown'` abort reasons wired up

### Adoption readiness
- **Pre-rendering exclusion**: Pre-rendered (OffscreenLane) trees excluded from transition metrics so background renders don't pollute measurements
- **Fizz TracingMarker support**: `TracingMarker` renders as a transparent wrapper in SSR, so it can be used in server-rendered apps without crashing
- **CPU Suspense support**: Transition tracing block extended to the CPU Suspense path in `updateSuspenseComponent`
- **Test coverage**: Tests for `onTransitionIncomplete`, error boundaries, `useTransition` hook, interruption, DOM renderer, and SSR/hydration
- **Fixture app**: Interactive app at `fixtures/transition-tracing/` with callback dashboard and configurable delays
- **DevTools**: `TracingMarkerComponent` work tag, element type, and display name wired into DevTools component tree

---

## Remaining Implementation Gaps

### Timestamp accuracy

**Problem**: `startTime` is lazily initialized to `performance.now()` in `scheduleUpdateOnFiber`. This is functionally correct (the `scope()` callback runs synchronously, so timing is nearly identical), but it misses event dispatch overhead. The RFC intended `startTime` to use `window.event.timeStamp`, which captures when the browser generated the event — before any JS runs. On the end-time side, the DOM host config doesn't implement `requestPostPaintCallback`, so end times may not reflect actual paint.

**Proposed fix**:

1. Add a `TS` (TransitionStartTime) field to `ReactSharedInternalsClient`, following the existing `S` hook pattern that bridges the `react` package to host config functions
2. Register a `TS` provider in `ReactFiberTransition.js` that reads `resolveEventTimeStamp()` (which already exists in `ReactFiberConfigDOM.js` and handles `window.event` availability), falling back to `now()`
3. In `startTransition`, call `ReactSharedInternals.TS()` instead of deferring to `-1`
4. Keep the existing lazy `now()` fallback in `scheduleUpdateOnFiber` for renderers that don't register `TS`
5. Implement `requestPostPaintCallback` for DOM using `rAF + setTimeout(0)` for accurate post-paint end times

Medium effort — roughly 6 files modified.

### Redundant `clearTransitionsForLanes`

Two identical `clearTransitionsForLanes` calls exist in the HostRoot passive mount path. The first clears after processing `committedTransitions`, the second after checking `incompleteTransitions`. The first call makes the second redundant for the same lanes.

Fix: remove the first call. One line.

### Batched transition disambiguation

**Problem**: When transitions batch in the same tick (e.g., clicking Home then Marketplace quickly), consumers must use string-matching heuristics to determine which transition actually rendered. This is error-prone — the v1 RFC acknowledges this as a known friction point.

**Proposed enhancement**: Add `batchedWith` info to `onTransitionStart` — when transitions batch together, each callback receives the names of other transitions in the batch. The `batchedWith` field would be populated from the `transitionLanes` map which already tracks multiple transitions per lane.

**Recommendation**: Implement as a follow-up after the other gaps are closed. Low risk, medium value. Depends on interruption handling (now complete).

---

## Design Question: Transition Types Integration

### Context

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

**Don't auto-trace unnamed transitions.** The tracing system is opt-in by design — only named transitions are tracked. Auto-tracing every typed transition would change the semantics and potentially create noise. If a consumer wants to trace a view transition, they should add a `name` to the `startTransition` call.

---

## Design Question: Hydration Transition Tracing

### Context

The v1 RFC lists hydration tracing as a "Future Goal." A 6-phase implementation plan exists that would add `onHydrationStart/Complete/Progress/Incomplete` callbacks for tracking the hydration lifecycle.

### Overlap with Performance Tracks

The `enableComponentPerformanceTrack` system already provides significant hydration visibility in Chrome DevTools:

| Capability | Performance Tracks | Proposed Hydration Tracing |
|---|---|---|
| Per-component hydration color coding | Yes (teal palette) | No |
| "Hydrated" / "Hydration Failed" render phase labels | Yes | No |
| Boundary-level dehydrated-to-hydrated detection | Yes | Yes |
| Programmatic callbacks for RUM | No | Yes |
| Named boundary tracking (`<Suspense name="...">`) | No | Yes |
| TracingMarker grouping of hydration regions | No | Yes |
| Progress events as boundaries hydrate | No | Yes |

### Recommendation

**Don't pursue hydration-specific callbacks.** Performance tracks already cover the DevTools visualization need with per-component hydration timing, color coding, and failure detection. The main unique value of hydration tracing callbacks — programmatic RUM for hydration TTI — is a real but niche use case that doesn't justify the significant implementation complexity (new tracking path without `Transition` objects, new marker tag, synthetic timing infrastructure).

Phase 1 (Fizz TracingMarker support) is already complete, so if production RUM for hydration is needed later, the foundation is in place and the remaining phases can be revisited.

---

## Design Question: Chrome Performance Tracks Display

### Context

React already emits custom Chrome Performance tracks via `console.timeStamp()` for components, scheduler lanes, and render/commit phases. Adding a "Transitions" track group would follow the same pattern.

### Proposed Approach

A **"Transitions"** track group in the Chrome Performance panel, with individual transitions as sub-tracks:

| Entry type | Representation | Color coding |
|---|---|---|
| Transition lifecycle | Timed entry spanning start-to-complete | Duration-based: `primary-light` (<100ms), `primary` (100ms-1s), `primary-dark` (>1s), `error` (>5s) |
| Transition incomplete | Timed entry spanning start-to-abort | `warning` or `error` by abort reason |
| Marker lifecycle | Nested entry within transition track | `secondary` / `secondary-light` |
| Marker progress | Zero-width marker with tooltip | `secondary-light`, tooltip lists pending boundary names |

The logging functions would be called from `processTransitionCallbacks()` after dispatching each user callback, keeping Chrome track entries in sync with callback data without duplicating lifecycle detection logic. In DEV builds, `performance.measure()` with the `detail.devtools` convention would attach rich tooltip data (transition name, duration, pending boundaries).

### Recommendation

**Implement the Chrome Performance Track.** This follows established patterns in `ReactFiberPerformanceTrack.js`, is gated behind both `enableTransitionTracing` and `enableProfilerTimer`, and provides immediate visual value in Chrome DevTools without requiring additional DevTools extension work.

**Skip the profiling hooks bridge** unless there's demand. The `performance.mark()` hooks in `react-devtools-shared` are a lightweight extension but add a second emission path. The Chrome Performance track is the primary visualization target.

---

## Rollout

Transition tracing is currently gated behind `enableTransitionTracing`, which is off in all production builds and dynamic on Meta www. The path to shipping:

1. **Close implementation gaps** — timestamp accuracy and the redundant `clearTransitionsForLanes` call are the remaining blockers. Batched disambiguation can follow.
2. **Resolve design questions** — the three questions above should be settled before expanding the API surface.
3. **Internal validation at Meta** — with the feature flag dynamic on www, the API can be validated against real product usage before committing to a stable API.
4. **Chrome Performance Track** — implement the DevTools visualization to give the feature visible value beyond programmatic callbacks.
5. **Stable release** — once the API is validated and the design questions are resolved, enable the flag in stable builds.

The feature is additive and opt-in (only named transitions are traced, callbacks are optional root config), so there's no migration burden for existing apps.

---

## Trade-offs

**Callback-based vs. Performance Observer**: The callback API requires registering functions at root creation time, which is more boilerplate than a `PerformanceObserver` pattern. But it gives React full control over the data shape and timing, and avoids coupling to browser APIs that may not exist in all renderers (React Native, server).

**TracingMarker as a component vs. a directive**: Making TracingMarker a component means it participates in the React tree and can be conditionally rendered, but it also means it adds fiber nodes. The component approach was chosen because it naturally scopes to subtrees and composes with Suspense boundaries.

**Opt-in naming**: Only named transitions are traced. This keeps the feature zero-cost for apps that don't use it, but means consumers must remember to add names. The alternative — tracing all transitions — would create noise and performance overhead for apps that don't want it.
