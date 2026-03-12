# API Gaps Analysis

Comparison of the current implementation against the RFC, implementation checklist, and Hero Tracing reference.

---

## Gap 1: `startTime` Is Not Captured at Transition Start

**Severity**: High

**Current behavior**: `startTime` is set to `-1` in `startTransition`, then lazily initialized to `performance.now()` on the first `scheduleUpdateOnFiber` call.

**Expected behavior (per RFC)**: `startTime` should be the event time — `window.event.timestamp` if available, falling back to `performance.now()` when `startTransition` is called.

**Impact**: The measured start time misses the gap between when a user action occurs and when React processes the resulting state update. For transitions triggered by event handlers, this could undercount interaction duration by the time spent in event dispatch and React scheduling overhead.

**RFC specification**: The implementation checklist calls for a host config function to read the start time, using `window.event.timestamp` on DOM. This function was never implemented.

---

## Gap 2: No Host Config Functions for Timestamps

**Severity**: High

**Current behavior**: Start time uses `now()` from the scheduler. End time uses the value passed to `schedulePostPaintCallback` or `currentEndTime` captured during passive effects.

**Expected behavior (per RFC)**: Two host config functions:
1. **Start time**: Use `window.event.timestamp` if available, else `performance.now()` at `startTransition` call time.
2. **End time**: Use `requestAnimationFrame` to capture paint time, then `setTimeout` to process callbacks after paint.

**Impact**: Without event timestamps, the start time doesn't accurately reflect when the user initiated the interaction. Without RAF-based end times, the end time may not reflect actual paint time.

---

## Gap 3: `onTransitionIncomplete` Is Defined but Untested

**Severity**: Medium

**Current behavior**: The callback type exists in `TransitionTracingCallbacks`. The implementation in `processTransitionCallbacks` does NOT process `onTransitionIncomplete` — it's absent from the dispatch loop. The root-level abort handling in `abortRootTransitions` sets `markerInstance.aborts` but doesn't accumulate a transition-level incomplete callback.

**Expected behavior (per RFC)**: `onTransitionIncomplete(transitionName, startTime, currentTime, deletions)` should fire when a transition can no longer complete (analogous to `onMarkerIncomplete` but at the root level).

**Impact**: There's no way to detect that an entire transition was aborted. Users can only detect marker-level incompleteness, not transition-level. The callback exists in the type but is dead code from the user's perspective.

---

## Gap 4: No Non-Suspense Loading State Support

**Severity**: Medium

**Current behavior**: Transition tracing only tracks Suspense boundaries. There's no way to signal a loading state that isn't backed by Suspense.

**Expected behavior (per RFC)**: Listed as a "Future Goal" — initially implementable in userland with Suspense + thrown Promises, with a first-class API planned later.

**Hero Tracing reference**: Hero Tracing provides `<HeroHoldTrigger hold={boolean}>` which lets any component signal a loading state to the interaction tracker. This is useful for imperative loading states (e.g., waiting for a timer, animation, or non-React async operation).

**Impact**: Apps with loading states not backed by Suspense (common in incremental migrations) can't fully trace their interactions.

---

## Gap 5: No Hydration Support

**Severity**: Medium

**Current behavior**: `hydrateRoot` accepts `unstable_transitionCallbacks` but there's no mechanism to trace the hydration process itself — from server HTML load through selective hydration completion.

**Expected behavior (per RFC)**: Listed as a "Future Goal" — V1 only traces from server start to HTML load. Hydration tracing is planned.

**Impact**: SSR apps can't measure the full time-to-interactive through hydration. This is a significant gap for server-rendered applications where hydration time is a key performance metric.

---

## Gap 6: No Subtree Ignore List on `startTransition`

**Severity**: Low

**Current behavior**: The only way to ignore a subtree's loading state is via `onMarkerProgress` — checking Suspense boundary names in the `pending` array and treating the transition as complete when only "ignorable" boundaries remain.

**Expected behavior (per RFC)**: Listed as a "Future Goal" — a Suspense ignore list on `startTransition` for edge cases where callbacks aren't sufficient.

**Impact**: The workaround via `onMarkerProgress` + Suspense `name` props is functional but verbose. The RFC's complex example (Profile Photo Modal) demonstrates this pattern. For most apps, this is workable.

---

## Gap 7: Callback-on-Root Pattern May Not Scale

**Severity**: Low (design concern)

**Current behavior**: All callbacks are registered at root creation via `createRoot` options. Every transition and marker in the entire app reports through the same set of callbacks.

**Alternative approaches**:
- Per-component callbacks (e.g., props on `TracingMarker`)
- Hook-based API (e.g., `useTransitionTracing`)
- Context-based scoping

**Impact**: For large apps with many transitions and markers, the root-level callbacks must dispatch/filter themselves. The RFC acknowledges this is intentional — it provides maximum flexibility for post-processing. However, it means every user must build their own routing/filtering layer.

---

## Gap 8: Marker Name Change Handling Is Incomplete

**Severity**: Low

**Current behavior**: Test 12 (marker name change during pending transition) is **skipped**. Test 18 shows that changing a marker's name without a key change produces a console error warning. The implementation in the commit phase handles name changes by treating them as incomplete, but the test is disabled, suggesting edge cases remain.

**Expected behavior (per RFC)**: `onMarkerIncomplete` should fire with `{type: 'marker', name, newName, endTime}` when a marker's name changes. The `newName` field exists in the RFC's deletion type but is not present in the current `TransitionAbort` type (which has `reason` and `name`, but no `newName`).

**Impact**: Marker renames during transitions may not produce correct callbacks. This is an unusual edge case but represents a spec/implementation mismatch.

---

## Gap 9: `pending` Array Is Mutable

**Severity**: Low

**Current behavior**: The `pending` array passed to `onMarkerProgress` and `onTransitionProgress` is the actual internal data structure, not a clone.

**Known TODO**: `// TODO: Clone the suspense object so users can't modify it`

**Impact**: Users could accidentally mutate React's internal tracking state. This is a correctness hazard, though unlikely in practice since most callback implementations are read-only.

---

## Summary

| Gap | Severity | Effort to Fix | Blocks Shipping? |
|-----|----------|---------------|-----------------|
| startTime not captured at event time | High | Medium | Yes |
| No host config timestamp functions | High | Medium | Yes |
| onTransitionIncomplete dead code | Medium | Low | No (but confusing) |
| No non-Suspense loading states | Medium | High | No (userland workaround exists) |
| No hydration tracing | Medium | High | No (SSR-only concern) |
| No subtree ignore list | Low | Medium | No (workaround exists) |
| Callback-on-root scaling | Low | N/A (design) | No |
| Marker name change incomplete | Low | Low | No |
| Mutable pending array | Low | Trivial | No |
