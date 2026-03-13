# Plan 17: Test Coverage Expansion

## Problem Statement

Transition tracing has 22 tests in a single file (`ReactTransitionTracing-test.js`, 2572 lines) using only `react-noop-renderer`. There are significant gaps: no `onTransitionIncomplete` tests, no error boundary tests, no `useTransition` hook tests, no DOM-specific tests, no SSR/hydration tests, and 1 skipped test.

---

## Current Test File Analysis

### File: `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js`

**Structure**: Single `describe('ReactInteractionTracing', ...)` block with 22 `it()` tests, all using `@gate enableTransitionTracing` pragma.

**Setup**: `react-noop-renderer`, `Scheduler`, `internal-test-utils` (act, waitForAll, assertLog, assertConsoleErrorDev).

**Helper functions** (defined inside describe):
- `stringifyDeletions(deletions)` -- serializes deletion objects for assertion
- `createTextCache()` -- creates text cache with `resolve(text)` and `reject(text, error)`
- `readText(text)` -- reads from cache, throws thenable if pending (Suspense pattern)
- `AsyncText({text})` -- component that calls `readText`
- `Text({text})` -- synchronous text component
- `resolveMostRecentTextCache(text)` / `resolveText` -- resolve cache entries
- `advanceTimers(ms)` -- `jest.advanceTimersByTime(ms)` + awaits Promise.resolve()

**Time simulation**: `ReactNoop.expire(ms)` advances Scheduler's virtual time. Noop renderer's `requestPostPaintCallback` uses `Scheduler.unstable_now()` for endTime.

**Test progression**: Tests 1-3 (basic start/complete), 4-8 (Suspense), 9-11 (TracingMarker), 12-18 (marker incomplete/deletion), 19-22 (Activity, discrete events, multi-commit, multi-root).

**Skipped**: Test 12 (`it.skip`) -- marker name change during pending transition.

---

## Proposed New Test Files

| # | File | Location | Purpose |
|---|------|----------|---------|
| 1 | `ReactTransitionTracingErrorBoundary-test.js` | `packages/react-reconciler/src/__tests__/` | Error boundary interaction |
| 2 | `ReactTransitionTracingHook-test.js` | `packages/react-reconciler/src/__tests__/` | `useTransition` with tracing |
| 3 | `ReactTransitionTracingInterruption-test.js` | `packages/react-reconciler/src/__tests__/` | Transition interruption scenarios |
| 4 | `ReactTransitionTracing-dom-test.js` | `packages/react-dom/src/__tests__/` | DOM-specific behavior |
| 5 | `ReactTransitionTracingHydration-test.js` | `packages/react-dom/src/__tests__/` | SSR + hydration |

Separate files follow the codebase pattern of focused test files per concern (e.g., `ReactSuspenseWithNoopRenderer-test.js`, `ReactSuspenseEffectsSemantics-test.js` are separate).

---

## Test Categories

### Category A: `onTransitionIncomplete` (Critical -- 0 existing tests)

**File**: Extend existing `ReactTransitionTracing-test.js`

**Depends on**: Plan 02 implementation

1. **Transition incomplete when root marker deleted**: Start named transition, delete TracingMarker subtree before Suspense resolves. Verify `onTransitionIncomplete` fires, `onTransitionComplete` does NOT.
2. **Incomplete vs complete distinction**: Two transitions -- one completes, one has marker deleted. Verify correct callbacks for each.
3. **Partial deletion**: Transition with two TracingMarkers, delete one. Verify `onMarkerIncomplete` + transition tracking.
4. **Normal completion guard**: Regression -- normal transition flow never triggers `onTransitionIncomplete`.

### Category B: Error Boundary Interaction (Critical -- 0 existing tests)

**File**: `ReactTransitionTracingErrorBoundary-test.js`

```js
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { Scheduler.log(`ErrorBoundary caught: ${error.message}`); }
  render() {
    return this.state.error ? this.props.fallback || <Text text="Error" /> : this.props.children;
  }
}
```

1. **Error inside TracingMarker triggers `onMarkerIncomplete`**: Component throws, ErrorBoundary catches above TracingMarker.
2. **Error inside Suspense within TracingMarker**: Child throws (not suspends), ErrorBoundary catches.
3. **Error recovery allows completion**: ErrorBoundary catches, re-render with working component, transition completes.
4. **Nested TracingMarker error propagation**: Inner marker error affects outer marker.
5. **Error during Suspense fallback render**: Fallback itself throws.

### Category C: `useTransition` Hook (High -- 0 existing tests)

**File**: `ReactTransitionTracingHook-test.js`

**Key difference**: Internal `startTransition` in `ReactFiberHooks.js` sets `currentTransition.startTime = now()` (not `-1` like standalone).

1. **useTransition with name option**: Same callback behavior as standalone `startTransition`.
2. **startTime uses `now()`**: Verify `startTime` reflects scheduler time, not `-1`.
3. **isPending during traced transition**: Verify timing relationship with tracing callbacks.
4. **Multiple useTransition hooks**: Independent callback tracking per transition name.
5. **useTransition with TracingMarker**: Marker callbacks fire correctly.
6. **useTransition without name**: No transition callbacks fire.

### Category D: Transition Interruption (High -- 0 existing tests)

**File**: `ReactTransitionTracingInterruption-test.js`

1. **Discrete event interrupts transition**: High-priority update during pending transition. Callbacks fire correctly after restart.
2. **Second transition interrupts first**: Start A (suspends), start B (suspends). Resolve independently. Both get correct callbacks.
3. **flushSync interrupts transition**: `flushSync` from useLayoutEffect during traced transition.
4. **Root unmount during transition**: No stale callbacks, no errors.
5. **Shared Suspense boundaries across interrupted transitions**: One interrupted, other still tracks boundary.

### Category E: DOM-Specific Tests (Medium)

**File**: `packages/react-dom/src/__tests__/ReactTransitionTracing-dom-test.js`

Setup: JSDOM environment, `ReactDOMClient.createRoot(container, { unstable_transitionCallbacks })`.

1. **Basic transition with DOM renderer**: Same scenario as noop test 2, verify callbacks in DOM.
2. **Suspense boundary tracking in DOM**: Transition reveals Suspense, verify progress/complete callbacks.
3. **TracingMarker with DOM renderer**: Marker callbacks fire correctly.
4. **Multiple DOM roots**: Independent tracking per root.
5. **Timestamp behavior**: Verify timestamps are reasonable positive numbers.

### Category F: SSR/Hydration Tests (Medium)

**File**: `packages/react-dom/src/__tests__/ReactTransitionTracingHydration-test.js`

Setup: JSDOM, `react-dom/server`, `renderToPipeableStream`, `Stream.PassThrough`.

1. **TracingMarker renders as fragment during SSR**: No special DOM output, children render normally.
2. **hydrateRoot with callbacks**: Post-hydration transitions work correctly.
3. **Transition started during hydration**: Callbacks track Suspense during hydration.
4. **Selective hydration with TracingMarker**: Marker completion tracks hydration.
5. **SSR smoke test**: `renderToPipeableStream` with TracingMarker doesn't crash.

---

## Test Infrastructure Needs

### Callback Factory

Each test file should define a callback factory to reduce boilerplate:

```js
function createTransitionCallbacks(options = {}) {
  const callbacks = {};
  callbacks.onTransitionStart = (name, startTime) => {
    Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
  };
  callbacks.onTransitionComplete = (name, startTime, endTime) => {
    Scheduler.log(`onTransitionComplete(${name}, ${startTime}, ${endTime})`);
  };
  // ... optionally include progress, markers, incomplete
  return callbacks;
}
```

### Timestamp Mocking for DOM Tests

- Noop renderer: `ReactNoop.expire(ms)` + `Scheduler.unstable_now()`
- DOM renderer: `jest.useFakeTimers()`, mock `performance.now()` if precision matters
- For most DOM tests, use `expect.any(Number)` for timestamps

### SSR Test Infrastructure

Follow `ReactDOMFizzShellHydration-test.js` pattern: JSDOM setup, `serverAct`, `clientAct`, `Stream.PassThrough` for collecting HTML.

---

## Gate Pragma Configuration

All transition tracing tests: `@gate enableTransitionTracing`

Multiple pragmas use AND logic:
```js
// @gate enableTransitionTracing
// @gate enableLegacyCache
it('test with cache API', () => { ... })
```

---

## Implementation Sequence

### Phase 1: Foundation
1. Fix or address skipped test 12 (existing file)
2. Add `onTransitionIncomplete` tests (Category A) -- requires Plan 02
3. Add `useTransition` hook tests (Category C)

### Phase 2: Error + Interruption Coverage
4. Create error boundary test file (Category B)
5. Create interruption test file (Category D)

### Phase 3: Cross-Renderer Coverage
6. Create DOM test file (Category E)
7. Create SSR/hydration test file (Category F)

---

## Key Implementation Notes

1. **`onTransitionIncomplete` is dead code**: `processTransitionCallbacks` has no code to invoke it. Category A tests serve as a forcing function for Plan 02.
2. **`TransitionAbort` reason gap**: Switch statement handles `'marker'` and `'suspense'` but silently drops `'error'` and `'unknown'`. Error boundary tests (Category B) expose this.
3. **`useTransition` timestamp difference**: Standalone sets `startTime = -1`, `useTransition`'s internal `startTransition` sets `startTime = now()`. Tests should document this.
4. **Noop vs DOM differences**: Different time simulation (`ReactNoop.expire` vs `jest.advanceTimersByTime`), different root creation, different output assertion patterns.
