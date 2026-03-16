# Transition Tracing: Project Progress

## Overview

Transition tracing is an experimental React feature (`enableTransitionTracing`) that measures transition lifecycles -- from `startTransition` through Suspense resolution to paint. It provides callbacks (`onTransitionStart`, `onTransitionProgress`, `onTransitionComplete`, etc.) via `createRoot` options and uses `<TracingMarker>` components to scope measurements to subtrees.

The feature exists in the codebase behind a feature flag (off in all production builds, dynamic on www). The implementation is partially complete with gaps in timestamp accuracy, missing callbacks, broken edge cases, no DevTools integration, and limited test coverage.

## Documents

| Path | Contents |
|------|----------|
| `docs/transition-tracing/research/` | Analysis of gaps, enhancements, test coverage, and fixture design |
| `docs/transition-tracing/plans/` | Detailed implementation plans for each work item |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Core tracing marker types and callback dispatch |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Commit phase transition tracking |
| `packages/react-reconciler/src/ReactFiberWorkLoop.js` | Callback accumulator functions |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | TracingMarker and Suspense render phase |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | Existing test suite (22 tests) |

## Plans

### P0 -- Project health and testing
- [x] **17 - Test Coverage Expansion**: Add tests for `onTransitionIncomplete`, error boundaries, `useTransition` hook, interruption, DOM renderer, and SSR/hydration. Currently 22 tests in one file with noop renderer only.
- [x] **18 - Fixture App**: Create `fixtures/transition-tracing/` with interactive scenarios, callback dashboard, and configurable delays for manual testing.
- [x] **10 - DevTools Integration**: Phase 1: show `name` prop in component tree + inspector state. Phase 2: Chrome custom performance track via `console.timeStamp()` (following existing scheduler/component track patterns). Phase 3 (optional): `performance.mark()` hooks bridge. Medium effort.


### P1 -- Core correctness

- [x] **19 - Interruption Handling**: Fix cross-attribution when a transition is interrupted by a newer transition reusing the same Suspense boundary. Four-part fix: (1) detect interruption via wakeable identity tracking on OffscreenInstance in throwException, (2) clean up old transition associations and update TracingMarker instances in commitOffscreenPassiveMountEffects, (3) handle hidden→hidden in commitTransitionProgress, (4) filter pushRootMarkerInstance to current render's transitions. Also: set Passive on HostRoot when incompleteTransitions.size > 0.
- [x] **02 - onTransitionIncomplete**: Implement the 7th callback accumulator. The callback type exists but is dead code -- never dispatched in `processTransitionCallbacks`.
- [x] **08 - Mutable Pending Array**: Clone `SuspenseInfo` objects in `onMarkerProgress` and `onTransitionProgress` callbacks so users can't mutate React internals. Trivial fix (~6 lines).
- [x] **09 - Abort Metadata**: Expand `TransitionAbort` type with `endTime`, `newName`, `error`, `componentStack`. Wire up `'error'` and `'unknown'` abort reasons (currently dead). Error boundary integration (Phase 3) deferred.
- [ ] **15 - Pre-rendering Exclusion**: Exclude pre-rendered (OffscreenLane) trees from transition metrics. Deferred until `<Activity>` semantics stabilize.

### P2 -- Important for adoption

- [ ] **04 - Hydration Tracing**: Add hydration lifecycle tracking. Prerequisite: fix TracingMarker in Fizz server renderer (currently would crash). Large effort.
- [ ] **01 - Timestamp Accuracy**: Enhance start time to use `window.event.timeStamp` (captures user interaction time, not JS processing time). Implement `requestPostPaintCallback` for DOM end time. The current lazy `performance.now()` init is functionally correct but misses event dispatch overhead.
- [ ] **14 - CPU Suspense**: Copy IO Suspense tracing block to CPU Suspense path in `updateSuspenseComponent`. ~15 lines, low risk. Depends on `enableCPUSuspense`.

### P3 -- Nice to have / Defer

- [ ] **16 - Redundant clearTransitionsForLanes**: Remove first of two identical `clearTransitionsForLanes` calls in HostRoot passive mount. 1 line removed, trivial.
- [ ] **12 - Batched Disambiguation**: Add `batchedWith` info to `onTransitionStart` callback — when transitions are batched in the same tick, each receives the names of other transitions in the batch. Helps consumers disambiguate same-tick batched transitions. (Reverted from P1; depends on Plan 19 for interruption correctness.)

### Consider later
- [ ] **07 - Transition Metadata/Tags**: Add `metadata: mixed` field to `startTransition` options, pass through to all callbacks. Low effort, high value for analytics.
- [ ] **05 - Subtree Ignore List**: Add `ignoreBoundaries` option to `startTransition`. Userland workaround via `onMarkerProgress` filtering is sufficient for V1.
- [ ] **03 - HoldTrigger**: New `<TracingHold hold={boolean}>` component for non-Suspense loading states. Requires new fiber type. RFC lists as "Future Goal."
- [ ] **06 - Per-Marker Callbacks**: Allow `onComplete`, `onProgress`, `onIncomplete` props on `<TracingMarker>`. Follows `Profiler` component precedent.
- [ ] **11 - Transition Timeout/SLA**: Add `timeout` option to `startTransition` for automatic SLA monitoring. Userland `setTimeout` workaround exists.
