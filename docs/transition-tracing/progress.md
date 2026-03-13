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

### P1 -- Core correctness

- [ ] **02 - onTransitionIncomplete**: Implement the 7th callback accumulator. The callback type exists but is dead code -- never dispatched in `processTransitionCallbacks`.
- [ ] **07 - Transition Metadata/Tags**: Add `metadata: mixed` field to `startTransition` options, pass through to all callbacks. Low effort, high value for analytics.
- [ ] **08 - Mutable Pending Array**: Clone `SuspenseInfo` objects in `onMarkerProgress` and `onTransitionProgress` callbacks so users can't mutate React internals. Trivial fix (~6 lines).
- [ ] **09 - Abort Metadata**: Expand `TransitionAbort` type with `endTime`, `newName`, `error`, `componentStack`. Wire up `'error'` and `'unknown'` abort reasons (currently dead).
- [ ] **13 - Marker Name Change Fix**: Handle marker name changes in begin work update path. Add `newName` to `TransitionAbort`. Unskip test 12.
- [ ] **17 - Test Coverage Expansion**: Add tests for `onTransitionIncomplete`, error boundaries, `useTransition` hook, interruption, DOM renderer, and SSR/hydration. Currently 22 tests in one file with noop renderer only.

### P2 -- Important for adoption

- [ ] **01 - Timestamp Accuracy**: Enhance start time to use `window.event.timeStamp` (captures user interaction time, not JS processing time). Implement `requestPostPaintCallback` for DOM end time. The current lazy `performance.now()` init is functionally correct but misses event dispatch overhead.
- [ ] **04 - Hydration Tracing**: Add hydration lifecycle tracking. Prerequisite: fix TracingMarker in Fizz server renderer (currently would crash). Large effort.
- [ ] **06 - Per-Marker Callbacks**: Allow `onComplete`, `onProgress`, `onIncomplete` props on `<TracingMarker>`. Follows `Profiler` component precedent.
- [ ] **10 - DevTools Integration**: Phase 1: show `name` prop in component tree. Phase 2: timeline visualization. Phase 3: profiler linking. High effort.
- [ ] **14 - CPU Suspense**: Copy IO Suspense tracing block to CPU Suspense path in `updateSuspenseComponent`. ~15 lines, low risk. Depends on `enableCPUSuspense`.
- [ ] **18 - Fixture App**: Create `fixtures/transition-tracing/` with interactive scenarios, callback dashboard, and configurable delays for manual testing.

### P3 -- Nice to have / Defer

- [ ] **03 - HoldTrigger**: New `<TracingHold hold={boolean}>` component for non-Suspense loading states. Requires new fiber type. RFC lists as "Future Goal."
- [ ] **05 - Subtree Ignore List**: Add `ignoreBoundaries` option to `startTransition`. Userland workaround via `onMarkerProgress` filtering is sufficient for V1.
- [ ] **11 - Transition Timeout/SLA**: Add `timeout` option to `startTransition` for automatic SLA monitoring. Userland `setTimeout` workaround exists.
- [ ] **12 - Batched Disambiguation**: Better handling of batched/superseded transitions. RFC's naming convention workaround is functional for V1.
- [ ] **15 - Pre-rendering Exclusion**: Exclude pre-rendered (OffscreenLane) trees from transition metrics. Deferred until `<Activity>` semantics stabilize.
- [ ] **16 - Redundant clearTransitionsForLanes**: Remove first of two identical `clearTransitionsForLanes` calls in HostRoot passive mount. 1 line removed, trivial.
