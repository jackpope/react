# Transition Tracing: Test Coverage and Known Issues

## Test File

**Location**: `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` (2572 lines)

This is the **only** test file for transition tracing in the codebase. No other files exercise `TracingMarker`, `transitionCallbacks`, or related APIs.

**Setup**:
- Renderer: `react-noop-renderer` (in-memory mutation-mode renderer, not DOM)
- Feature gate: `@gate enableTransitionTracing` on every test
- Describe block: `'ReactInteractionTracing'` (historical naming; file says "Transition")
- Time simulation: `ReactNoop.expire(ms)` + `advanceTimers(ms)` for controlled timestamps
- Suspense simulation: Custom text cache with manual `resolveText()` for control

---

## Test Catalog

### 22 tests total (21 active, 1 skipped)

| # | Test Name | Callbacks Tested | Key Scenario |
|---|-----------|-----------------|--------------|
| 1 | should not call callbacks when transition is not defined | Start, Progress, Complete, MarkerProgress, MarkerComplete | Unnamed transitions are invisible to tracing |
| 2 | should correctly trace basic interaction | Start, Progress, Complete | Synchronous page navigation, no Suspense |
| 3 | multiple updates in transition callback should only result in one transitionStart/transitionComplete call | Start, Complete | Batched state updates in a single transition |
| 4 | should correctly trace interactions for async roots | Start, Progress, Complete | Suspense boundary suspends then resolves |
| 5 | should correctly trace multiple separate root interactions | Start, Progress, Complete | Two sequential independent transitions |
| 6 | should correctly trace multiple intertwined root interactions | Start, Progress, Complete | Two overlapping concurrent transitions |
| 7 | trace interaction with nested and sibling suspense boundaries | Start, Progress, Complete | Nested Suspense, children revealed after parent |
| 8 | trace interactions with the same child suspense boundaries | Start, Progress, Complete | Entangled transitions sharing Suspense boundaries |
| 9 | should correctly trace basic interaction with tracing markers | Start, Progress, Complete, MarkerProgress, MarkerComplete | TracingMarker wrapping navigated content |
| 10 | should correctly trace interactions for tracing markers | Start, Complete, MarkerProgress, MarkerComplete | Sync marker (no Suspense) + async marker |
| 11 | trace interaction with multiple tracing markers | Start, Complete, MarkerProgress, MarkerComplete | Nested TracingMarkers (outer containing inner) |
| 12 | warn and calls marker incomplete if name changes before transition completes | Start, Progress, Complete, MarkerProgress, MarkerIncomplete, MarkerComplete | **SKIPPED** — marker name change during pending transition |
| 13 | marker incomplete for tree with parent and sibling tracing markers | Start, Progress, Complete, MarkerProgress, MarkerIncomplete, MarkerComplete | Marker deletion with sibling still active |
| 14 | marker gets deleted | Start, Progress, Complete, MarkerProgress, MarkerIncomplete, MarkerComplete | Child marker deleted, parent becomes incomplete |
| 15 | Suspense boundary added by the transition is deleted | Start, Progress, Complete, MarkerProgress, MarkerIncomplete, MarkerComplete | Suspense boundary removed during transition |
| 16 | Suspense boundary not added by the transition is deleted | Start, Progress, Complete, MarkerProgress, MarkerComplete | Non-transition Suspense removal doesn't affect tracing |
| 17 | marker incomplete gets called properly if child suspense marker is not part of it | Start, Progress, Complete, MarkerProgress, MarkerIncomplete, MarkerComplete | Cross-transition Suspense tracking |
| 18 | warns when marker name changes | Start, Complete, MarkerIncomplete, MarkerComplete | Name change with vs without key remount |
| 19 | offscreen trees should not stop transition from completing | Start, Complete, MarkerComplete | Activity (mode="hidden") doesn't block completion |
| 20 | discrete events | Start, Progress, Complete | Transition inside discrete event handler |
| 21 | multiple commits happen before a paint | Start, Progress, Complete | Layout effect triggers sync rerender |
| 22 | transition callbacks work for multiple roots | Start, Progress, Complete | Independent callbacks per root |

---

## Callback Coverage

| Callback | # Tests | Notes |
|----------|---------|-------|
| `onTransitionStart` | 21 | Tested in all active tests |
| `onTransitionProgress` | 15 | Well covered for Suspense scenarios |
| `onTransitionComplete` | 21 | Tested in all active tests |
| `onTransitionIncomplete` | 0 | **Never tested** — exists in type but no test exercises it |
| `onMarkerProgress` | 10 | Tested with Suspense + TracingMarker |
| `onMarkerComplete` | 9 | Tested for sync and async completion |
| `onMarkerIncomplete` | 5 (+ 1 skipped) | Tested for deletions, name changes |

---

## Feature Coverage

| Feature | Tested | Notes |
|---------|--------|-------|
| `startTransition` with `{name}` | Yes | All tests |
| `React.unstable_TracingMarker` | Yes | 12 tests |
| `Suspense` with `name` prop | Yes | Extensively |
| `useState` | Yes | Multiple tests |
| `Activity` (mode="hidden") | Yes | Test 19 |
| `useLayoutEffect` | Yes | Test 21 |
| Discrete events | Yes | Test 20 |
| Concurrent mode | Yes | All (via createRoot) |
| Multiple roots | Yes | Test 22 |
| Nested TracingMarkers | Yes | Test 11 |
| Marker deletion | Yes | Tests 13, 14 |
| Suspense boundary deletion | Yes | Tests 15, 16 |
| Batched state updates | Yes | Test 3 |
| Overlapping transitions | Yes | Tests 6, 8 |

---

## Gaps in Test Coverage

### Not Tested At All

1. **SSR / Server-Side Rendering**: No tests for transition tracing during server rendering or streaming SSR.
2. **Hydration**: No tests for transition tracing during client hydration of server-rendered content.
3. **Error boundaries**: No tests for error boundary interaction with transition tracing. No verification of `onMarkerIncomplete` firing on error.
4. **DevTools integration**: No tests for DevTools interaction.
5. **`useTransition` hook**: All tests use standalone `startTransition`. The hook's returned `startTransition` is never tested.
6. **`useDeferredValue`**: Not tested with transition tracing.
7. **`React.lazy` / code splitting**: Not tested with TracingMarker or traced transitions.
8. **`SuspenseList`**: Not tested with transition tracing.
9. **DOM renderer (`react-dom`)**: All tests use `react-noop-renderer`. No DOM-based tests exist.
10. **`onTransitionIncomplete`**: Exists in the type definition but never exercised by any test.
11. **Transition interruption**: No explicit test for a higher-priority update interrupting a traced transition mid-render.
12. **Nested transitions**: No tests for transitions started within transition callbacks.
13. **TracingMarker with ref**: Not tested.
14. **TracingMarker unmount outside transition**: Not tested.
15. **Scale/stress testing**: No tests with many concurrent markers or transitions.

### Skipped Test

Test 12 (`"warn and calls marker incomplete if name changes before transition completes"`) is skipped via `it.skip`. This tests marker name changes during pending transitions — the scenario where a TracingMarker's `name` prop changes while Suspense is still unresolved. The skip suggests this behavior may be broken or intentionally deferred.

---

## Known Issues and TODOs

### Critical

1. **`startTime` is lazily initialized to `-1`**
   - Location: `packages/react/src/ReactStartTransition.js:68`
   - Code: `currentTransition.startTime = -1; // TODO: This should read the timestamp.`
   - Impact: The start time isn't set at transition creation. It's lazily set in `scheduleUpdateOnFiber` on the first state update. This means if there's any delay between `startTransition` being called and the first `setState`, the measured duration will be shorter than actual.
   - Same issue exists in `startGestureTransition` (line 149).

### Moderate

2. **CPU Suspense not supported**
   - Location: `packages/react-reconciler/src/ReactFiberBeginWork.js:2487`
   - Code: `// TODO: Transition Tracing is not yet implemented for CPU Suspense.`

3. **Pre-rendering may affect transition metrics**
   - Location: `packages/react-reconciler/src/ReactFiberCommitWork.js:3395`
   - Code: `// TODO: Pre-rendering should not be counted as part of a transition.`

4. **Pending boundaries are passed by reference**
   - Location: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:82`
   - Code: `// TODO: Clone the suspense object so users can't modify it`
   - Impact: Users could mutate the `pending` array in callbacks.

5. **Redundant `clearTransitionsForLanes` call**
   - Location: `packages/react-reconciler/src/ReactFiberCommitWork.js:3750, 3763`
   - Called twice during HostRoot passive mount, appears redundant.

### Minor / Code Quality

6. **Tag/name overhead on TracingMarkerInstance**
   - Location: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:40`
   - Code: `// TODO: Is there a way to not include the tag or name here?`

7. **Abort phase refactoring**
   - Location: `packages/react-reconciler/src/ReactFiberCommitWork.js:965`
   - Code: `// TODO: Refactor this code. Is there a way to move this code to the deletions phase instead of calculating it here while making sure complete is called appropriately?`

8. **if/else branch refactoring**
   - Location: `packages/react-reconciler/src/ReactFiberCommitWork.js:3449`
   - Code: `// TODO: Refactor this into an if/else branch`

---

## API Stability

All public APIs use the `unstable_` prefix:
- `React.unstable_TracingMarker`
- `unstable_transitionCallbacks` (createRoot option)

This signals the feature is experimental and may change without notice.
