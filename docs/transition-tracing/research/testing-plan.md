# Testing Plan

Strategy for improving transition tracing test coverage, organized by priority.

---

## Current State

- **1 test file**: `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` (2572 lines, 22 tests)
- **Renderer**: `react-noop-renderer` only (no DOM tests)
- **1 skipped test**: marker name change during pending transition
- **0 tests** for `onTransitionIncomplete` callback

---

## Priority 1: Fix Existing Issues

### P1.1: Fix or Remove Skipped Test

**Test 12**: `"warn and calls marker incomplete if name changes before transition completes"` is `it.skip`.

**Action**: Investigate why it was skipped. Either fix the underlying issue or document why the behavior is intentionally unsupported and remove the test.

**Approach**:
1. Remove `it.skip` and run the test
2. Analyze the failure
3. Fix the implementation if the behavior should be supported, or remove the test and document the limitation

### P1.2: Add `onTransitionIncomplete` Tests

The callback type exists but is never tested and appears to be dead code in `processTransitionCallbacks`.

**Test cases**:
- Transition with all markers deleted before completion → `onTransitionIncomplete` fires
- Transition with an error boundary catching a throw inside a TracingMarker → `onTransitionIncomplete` fires
- Transition where user navigates away (markers removed) → `onTransitionIncomplete` fires
- Verify `onTransitionIncomplete` does NOT fire when a transition completes normally

---

## Priority 2: Error and Edge Case Coverage

### P2.1: Error Boundary Interaction

No tests verify what happens when an error boundary catches a throw inside a TracingMarker.

**Test cases**:
- Component inside TracingMarker throws during render → error boundary catches → verify `onMarkerIncomplete` fires with `reason: 'error'`
- Error recovery (error boundary retry) → verify marker can complete after recovery
- Nested TracingMarkers where inner marker's child throws → verify outer marker gets `onMarkerIncomplete`

### P2.2: `useTransition` Hook

All tests use standalone `startTransition`. The hook-returned `startTransition` should also work.

**Test cases**:
- `useTransition` with name option → same callback behavior as standalone
- `isPending` state during traced transition → verify timing relationship with tracing callbacks
- Multiple `useTransition` hooks in different components → independent tracking

### P2.3: Transition Interruption

No tests for higher-priority updates interrupting a traced transition mid-render.

**Test cases**:
- Traced transition is rendering, discrete event fires → transition is interrupted → verify callbacks still fire correctly after restart
- Two traced transitions where the second interrupts the first → verify both get correct callbacks
- Traced transition interrupted by `flushSync` → verify completion timing

### P2.4: `useDeferredValue` Interaction

**Test cases**:
- `useDeferredValue` inside a TracingMarker → verify the deferred update doesn't extend the transition
- Transition triggers both immediate and deferred updates → verify tracing tracks only the transition's boundaries

---

## Priority 3: Renderer and Environment Coverage

### P3.1: React DOM Tests

All tests use `react-noop-renderer`. DOM-specific behavior (especially timestamps) needs testing.

**Test cases**:
- Same scenarios as noop tests but using `react-dom` with `createRoot`
- Verify timestamp accuracy when `window.event.timestamp` is available (once implemented)
- Verify `requestAnimationFrame`-based end time (once implemented)
- Verify callbacks fire correctly in a real DOM environment

**Setup**: Create a companion test file `ReactTransitionTracing-dom-test.js` in `packages/react-dom/src/__tests__/`.

### P3.2: SSR Tests

**Test cases**:
- `renderToPipeableStream` with `TracingMarker` in the tree → verify markers are treated as fragments (no special server behavior expected)
- Client hydration with `hydrateRoot` + `unstable_transitionCallbacks` → verify callbacks fire during hydration-triggered transitions
- Selective hydration of a subtree containing TracingMarkers → verify marker completion tracks hydration

**Setup**: Tests in `packages/react-dom/src/__tests__/` using `react-dom/server`.

### P3.3: Activity (Offscreen) Deep Testing

Test 19 covers the basic case. More edge cases needed:

**Test cases**:
- Activity goes from hidden to visible during a traced transition → verify boundaries in the revealed tree are tracked
- Activity goes from visible to hidden during a traced transition → verify boundaries in the hidden tree stop being tracked
- Nested Activity trees with TracingMarkers → verify correct scoping
- `Activity` with `mode="unstable-defer-without-hiding"` → verify interaction with transition tracing

---

## Priority 4: Integration and Scale

### P4.1: React.lazy / Code Splitting

**Test cases**:
- `React.lazy` component inside TracingMarker → verify Suspense boundary from lazy loading is tracked
- Lazy component that also suspends for data after loading → verify cascading Suspense is tracked
- Preloaded lazy component (no Suspense) → verify immediate completion

### P4.2: Multiple Roots

Test 22 covers the basic case. More scenarios:

**Test cases**:
- Two roots with the same transition name → verify callbacks are independent
- Root unmounted during a traced transition → verify cleanup (no leaked callbacks)
- Root with transition callbacks created after a transition starts → verify no stale state

### P4.3: Scale Testing

**Test cases**:
- 50+ concurrent TracingMarkers → verify no performance degradation in callback processing
- 10+ concurrent transitions → verify correct tracking
- Deeply nested TracingMarkers (10+ levels) → verify stack operations are correct
- Rapid transition start/complete cycles → verify no memory leaks in `incompleteTransitions`

### P4.4: Concurrent Features Interaction

**Test cases**:
- `startTransition` + View Transitions → verify both systems work together
- `startTransition` with `TransitionTypes` → verify types don't interfere with tracing
- Gesture transitions with tracing → verify `startGestureTransition` tracing works

---

## Test Infrastructure Needs

### Timestamp Testing

Once host config timestamp functions are implemented, tests need to verify:
- Start time matches `window.event.timestamp` when available
- Start time falls back to `performance.now()` when no event is in scope
- End time reflects post-paint timing

**Approach**: Mock `window.event` and `performance.now()` in DOM tests. The noop renderer already has `ReactNoop.expire()` for time simulation.

### Test Helpers

Consider extracting common patterns into shared helpers:
- Transition callback setup (currently duplicated across tests)
- Suspense cache creation (currently in the test file)
- Assertion helpers for callback sequences

---

## Proposed Test File Structure

```
packages/react-reconciler/src/__tests__/
  ReactTransitionTracing-test.js              # Existing (noop renderer)

packages/react-dom/src/__tests__/
  ReactTransitionTracing-dom-test.js           # New: DOM-specific tests
  ReactTransitionTracingHydration-test.js      # New: SSR + hydration tests

packages/react-reconciler/src/__tests__/
  ReactTransitionTracingErrorBoundary-test.js  # New: error boundary interaction
```
