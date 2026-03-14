# Plan 17: Test Coverage Expansion

## Problem Statement

Transition tracing has 22 tests in a single file (`ReactTransitionTracing-test.js`, 2572 lines) using only `react-noop-renderer`. There are significant gaps: no `onTransitionIncomplete` tests, no error boundary tests, no `useTransition` hook tests, no DOM-specific tests, no SSR/hydration tests, and 1 skipped test.

## Approach

**Build out extensive feature coverage first, even for unimplemented features.** The goal is to define the full expected behavior of transition tracing through tests. Tests for features that are not yet implemented (e.g., `onTransitionIncomplete`, error abort reasons) should be skipped (`it.skip` or `xit`) so the suite stays green. As each feature is implemented (Plans 02, 09, etc.), the corresponding tests get unskipped and must pass.

For features that ARE already implemented, tests should be made to pass. This creates a living specification: the test suite documents both what works today and what the complete feature set should look like.

**Priority coverage:**
- All testing gaps identified in `test-coverage-and-known-issues.md` (error boundaries, `useTransition`, interruption, DOM renderer, SSR/hydration)
- P0 scenarios: `onTransitionIncomplete` (Plan 02), DevTools smoke tests
- P1 scenarios: mutable pending array (Plan 08), abort metadata (Plan 09), marker name change (Plan 13), pre-rendering exclusion (Plan 15)

Tests for P0/P1 features that depend on unimplemented code should be written with expected behavior and skipped.

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

**File**: `ReactTransitionTracingErrorBoundary-test.js` (noop renderer)

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

**File**: `ReactTransitionTracingHook-test.js` (noop renderer)

**Key difference**: Internal `startTransition` in `ReactFiberHooks.js` sets `currentTransition.startTime = now()` (not `-1` like standalone).

1. **useTransition with name option**: Same callback behavior as standalone `startTransition`.
2. **startTime uses `now()`**: Verify `startTime` reflects scheduler time, not `-1`.
3. **isPending during traced transition**: Verify timing relationship with tracing callbacks.
4. **Multiple useTransition hooks**: Independent callback tracking per transition name.
5. **useTransition with TracingMarker**: Marker callbacks fire correctly.
6. **useTransition without name**: No transition callbacks fire.

### Category D: Transition Interruption (High -- 0 existing tests)

**File**: `ReactTransitionTracingInterruption-test.js` (noop renderer)

1. **Discrete event interrupts transition**: High-priority update during pending transition. Callbacks fire correctly after restart.
2. **Second transition interrupts first**: Start A (suspends), start B (suspends). Resolve independently. Both get correct callbacks.
3. **flushSync interrupts transition**: `flushSync` from useLayoutEffect during traced transition.
4. **Root unmount during transition**: No stale callbacks, no errors.
5. **Shared Suspense boundaries across interrupted transitions**: One interrupted, other still tracks boundary.

### Category E: DOM-Specific Tests (Medium -- narrowly scoped)

**File**: `packages/react-dom/src/__tests__/ReactTransitionTracing-dom-test.js`

Setup: JSDOM environment, `ReactDOMClient.createRoot(container, { unstable_transitionCallbacks })`.

Most transition tracing behavior is renderer-agnostic and tested via the noop renderer (Categories A-D). DOM tests should only cover integrations that are specific to the DOM renderer:

1. **Timestamp behavior**: Verify timestamps are reasonable positive numbers (DOM uses real `performance.now()` vs noop's virtual clock).
2. **`createRoot` callback options**: Verify `unstable_transitionCallbacks` option works with `ReactDOMClient.createRoot`.
3. **Multiple DOM roots**: Independent tracking per root (DOM-specific root lifecycle).
4. **Basic smoke test**: One end-to-end transition with Suspense to confirm DOM renderer wiring works.

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

### Phase 1: Foundation (implemented features -- tests must pass)
1. Add `useTransition` hook tests (Category C) -- feature exists, tests should pass
2. Create interruption test file (Category D) -- interruption paths exist, tests should pass

### Phase 2: Unimplemented features (tests written but skipped)
4. Add `onTransitionIncomplete` tests (Category A) -- skip until Plan 02 is implemented
5. Create error boundary test file (Category B) -- skip tests that depend on `'error'` abort reason (Plan 09)
6. Add P1 scenario tests:
   - Mutable pending array exposure (Plan 08) -- skip, write test showing user mutation problem
   - Abort metadata fields (Plan 09) -- skip, write tests expecting `endTime`, `newName`, `error`, `componentStack`
   - Marker name change (Plan 13) -- unskip existing test 12 attempt, add new cases, skip if still failing
   - Pre-rendering exclusion (Plan 15) -- skip, write tests expecting OffscreenLane exclusion

### Phase 3: DOM-Specific Coverage (only for DOM-specific integrations)
7. Create DOM test file (Category E) -- only for behavior that differs from noop renderer (timestamps, real DOM output, `createRoot` options)
8. Create SSR/hydration test file (Category F) -- skip tests that depend on Fizz TracingMarker support (Plan 04); smoke tests for "doesn't crash" should pass
9. Fix or address skipped test 12 in existing file

---

## Key Implementation Notes

1. **Skip convention**: Use `it.skip` for tests that depend on unimplemented features. Add a comment referencing the plan that must be completed first (e.g., `// skip: requires Plan 02 (onTransitionIncomplete)`). When a plan is implemented, unskip the relevant tests and ensure they pass.
2. **`onTransitionIncomplete` is dead code**: `processTransitionCallbacks` has no code to invoke it. Category A tests serve as a forcing function for Plan 02.
3. **`TransitionAbort` reason gap**: Switch statement handles `'marker'` and `'suspense'` but silently drops `'error'` and `'unknown'`. Error boundary tests (Category B) expose this.
4. **`useTransition` timestamp difference**: Standalone sets `startTime = -1`, `useTransition`'s internal `startTransition` sets `startTime = now()`. Tests should document this.
5. **Noop vs DOM differences**: Different time simulation (`ReactNoop.expire` vs `jest.advanceTimersByTime`), different root creation, different output assertion patterns.
6. **P1 scenario tests as specification**: Even though P1 features aren't implemented, the skipped tests document the expected behavior. This makes implementation plans concrete and testable from day one.
