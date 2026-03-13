# Plan 01: Timestamp Accuracy (Start Time & End Time)

## Problem Statement

The current `startTime` uses a `-1` sentinel in `startTransition`, lazily filled in with `Scheduler.unstable_now()` (i.e., `performance.now()`) on the first `scheduleUpdateOnFiber` call. **This lazy init is functionally correct** -- the `scope()` callback runs synchronously, so the `now()` captured in `scheduleUpdateOnFiber` is practically identical to calling `now()` at `startTransition` time. (`useTransition`'s internal `startTransition` already calls `now()` directly, confirming the lazy path produces equivalent results.)

The enhancement is to use `window.event.timeStamp` instead of `performance.now()`, which captures when the browser *generated* the event (before any JS runs), not when React processes it. This closes the gap between user interaction and `startTransition` execution -- typically a few milliseconds of event dispatch overhead, but meaningful for precise interaction measurement.

The end time capture also has gaps -- the DOM host config doesn't implement `requestPostPaintCallback`.

---

## Current State

### Start Time

- `packages/react/src/ReactStartTransition.js:68` -- `currentTransition.startTime = -1; // TODO: This should read the timestamp.`
- `packages/react/src/ReactStartTransition.js:149` -- Same pattern for `startGestureTransition`
- `packages/react-reconciler/src/ReactFiberWorkLoop.js:1036-1044` -- Lazy initialization: `if (transition.startTime === -1) { transition.startTime = now(); }`
- `packages/react/src/ReactStartTransition.js:30-37` -- `Transition` type includes `startTime: number`

**The `react` package limitation**: `startTransition` lives in the `react` package which is renderer-agnostic. It does not have access to host config functions (like `window.event.timeStamp`). The reconciler (`react-reconciler`) is where host config functions are available via `ReactFiberConfig`.

### End Time

- `packages/react-reconciler/src/ReactPostPaintCallback.js:1-27` -- Intermediary module using `requestPostPaintCallback` from host config
- `packages/react-reconciler/src/ReactFiberWorkLoop.js:543` -- `let currentEndTime: number | null = null;`
- `packages/react-reconciler/src/ReactFiberWorkLoop.js:4361-4390` -- Post-commit scheduling of `schedulePostPaintCallback`
- `packages/react-reconciler/src/ReactFiberWorkLoop.js:4774-4793` -- Fallback path in `flushPassiveEffectsImpl`

### Host Config Implementations

- **DOM (`ReactFiberConfigDOM.js`)**: `requestPostPaintCallback` is NOT exported -- dead-code-eliminated since `enableTransitionTracing` is `false`
- **Native (`ReactFiberConfigNative.js:770-772`)**: noop (never calls callback)
- **Noop (`createReactNoop.js:612-615`)**: calls callback synchronously with `Scheduler.unstable_now()`

### Existing Cross-Package Bridge Pattern

- `packages/react/src/ReactSharedInternalsClient.js:24-56` -- `SharedStateClient` with fields `H`, `A`, `T`, `S`, `G`
- `packages/react-reconciler/src/ReactFiberTransition.js:78-130` -- `ReactSharedInternals.S` hook pattern
- `packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js:802-815` -- `resolveEventTimeStamp` already reads `window.event`

---

## Implementation

### Part 1: Accurate Start Time Capture

#### Step 1: Add `TS` field to SharedStateClient

**File**: `packages/react/src/ReactSharedInternalsClient.js`

Add `TS: null | (() => number)` (TransitionStartTime provider) to `SharedStateClient`. Initialize to `null`.

#### Step 2: Use the hook in startTransition

**File**: `packages/react/src/ReactStartTransition.js`

Replace `-1` sentinel with:
```js
const getTimestamp = ReactSharedInternals.TS;
currentTransition.startTime = getTimestamp !== null ? getTimestamp() : -1;
```

Same change for `startGestureTransition`.

#### Step 3: Register the timestamp provider from the reconciler

**File**: `packages/react-reconciler/src/ReactFiberTransition.js`

```js
if (enableTransitionTracing) {
  ReactSharedInternals.TS = function getTransitionStartTimestamp(): number {
    const eventTimeStamp = resolveEventTimeStamp();
    if (eventTimeStamp > 0) {
      return eventTimeStamp;
    }
    return now();
  };
}
```

#### Step 4: Keep lazy fallback in scheduleUpdateOnFiber

**File**: `packages/react-reconciler/src/ReactFiberWorkLoop.js:1036-1044`

Keep the existing `if (transition.startTime === -1) { transition.startTime = now(); }` as a fallback for renderers that don't register `TS`, but add a comment explaining it's now a legacy path.

### Part 2: Accurate End Time Capture

#### Step 5: Implement requestPostPaintCallback for DOM

**File**: `packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js`

```js
export function requestPostPaintCallback(callback: (time: number) => void) {
  localRequestAnimationFrame(() => {
    scheduleTimeout(() => {
      callback(performance.now());
    }, 0);
  });
}
```

#### Step 6: Implement requestPostPaintCallback for React Native

**File**: `packages/react-native-renderer/src/ReactFiberConfigNative.js`

Replace noop with `setTimeout(() => { callback(performance.now()); }, 0);`

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react/src/ReactSharedInternalsClient.js` | Add `TS` field |
| `packages/react/src/ReactStartTransition.js` | Use `ReactSharedInternals.TS()` for `startTime` |
| `packages/react-reconciler/src/ReactFiberTransition.js` | Register `TS` timestamp provider |
| `packages/react-reconciler/src/ReactFiberWorkLoop.js` | Document fallback as legacy path |
| `packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js` | Add `requestPostPaintCallback` |
| `packages/react-native-renderer/src/ReactFiberConfigNative.js` | Implement real `requestPostPaintCallback` |

---

## Risks and Open Questions

1. **`window.event` availability**: Non-standard but available in Chrome, Edge, Firefox. `resolveEventTimeStamp` already handles this with a fallback.
2. **`event.timeStamp` base mismatch**: Modern browsers use `DOMHighResTimeStamp` (same origin as `performance.now()`). Older browsers may use epoch-based timestamps.
3. **Multiple renderers**: `TS` follows the composition pattern of `S`. Only the last renderer to register wins, which is acceptable.
4. **Post-paint timing accuracy**: `rAF + setTimeout(0)` approximates post-paint timing. `PerformanceObserver` with `"paint"` entries would be more accurate but more complex.
5. **Server Components**: `TS` will be `null` in server environments since no reconciler registers it. The `-1` fallback is maintained.

---

## Testing Approach

### Noop Renderer Tests
1. Start time captured at `startTransition` time (not deferred to `scheduleUpdateOnFiber`)
2. End time from post-paint callback >= commit time
3. Multiple transitions get independent start times

### DOM Integration Tests
4. Start time uses event timestamp when inside a click handler
5. Start time uses `performance.now()` for programmatic transitions (no `window.event`)
6. End time is after paint (requires rAF mocking)
