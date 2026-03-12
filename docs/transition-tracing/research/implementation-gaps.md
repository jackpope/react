# Implementation Gaps

Catalog of unfinished work mapped to the original implementation checklist from the input documents.

---

## Checklist Status

### Setup — Mostly Complete

| Item | Status | Notes |
|------|--------|-------|
| Create `enableTransitionTracing` feature flag | Done | `ReactFeatureFlags.js:104`, dynamic on www |
| Create `TracingMarker` component boilerplate | Done | Symbol, work tag, fiber creation, public export |
| Add transition callback functions as root arguments | Done | `createRoot`/`hydrateRoot` accept `unstable_transitionCallbacks` |
| Add `currentPendingTransitionCallbacks` global on WorkLoop | Done | `ReactFiberWorkLoop.js:542` |
| Create host config function to get start time | **Not done** | Start time is lazily set via `now()` in `scheduleUpdateOnFiber` instead of using `window.event.timestamp` |
| Create host config function to get end time and process callbacks | **Partial** | End time comes from passive effect timing / `schedulePostPaintCallback`, but no dedicated `requestAnimationFrame` + `setTimeout` pattern as described in the implementation doc |

### Render Phase — Complete

| Item | Status | Notes |
|------|--------|-------|
| Add `transitionName` to `startTransition` | Done | Via `options.name` |
| Store start time and name in batch config, pass to root | Done | Via `ReactSharedInternals.T` and `addTransitionToLanesMap` |
| Create stack for active transitions and pending Suspense boundary sets | Done | `transitionStack` in `ReactFiberTransition.js`, `markerInstanceStack` in `ReactFiberTracingMarkerComponent.js` |
| Add code on TracingMarkers in begin phase | Done | `updateTracingMarkerComponent` |
| Add `name` field on Suspense boundary | Done | Suspense `name` prop read in commit phase |
| Process root during render phase | Done | `pushRootTransition`, `pushRootMarkerInstance` |
| Process Suspense boundaries (fallback state) | Done | Stores transitions/markers on OffscreenQueue |
| Process Suspense boundaries (fallback to rendered) | Done | Transitions propagated via `pushTransition` |
| Propagate subtree flags | Done | Passive flag set on Offscreen when Suspense state changes |
| Add transitions to root | Done | Via `incompleteTransitions` map |

### Commit Phase — Mostly Complete

| Item | Status | Notes |
|------|--------|-------|
| Create subtree traversal for boundary names/transitions | Done | `commitTransitionProgress` |
| TracingMarker name change → incomplete | **Partial** | Code exists but test is skipped (`it.skip`). `TransitionAbort` type lacks `newName` field |
| Deletion phase: deleted markers/boundaries → incomplete | Done | `abortParentMarkerTransitionsForDeletedFiber` |
| Suspense fallback: add boundary to marker set | Done | In `commitTransitionProgress` |
| Suspense resolved: remove boundary from marker set | Done | In `commitTransitionProgress` |
| TracingMarker name changed: propagate incomplete | **Partial** | See above |
| No remaining boundaries: transition complete | Done | Checked in both `commitTransitionProgress` and HostRoot passive mount |
| Process root complete/progress | Done | In HostRoot passive mount |
| Create callback processing function | Done | `processTransitionCallbacks` |
| Combine fallbacks if possible | **Unknown** | No explicit fallback-combining logic found |

### Other — Incomplete

| Item | Status | Notes |
|------|--------|-------|
| Write tests | **Partial** | 22 tests exist but significant gaps (see test-coverage-and-known-issues.md) |
| Integrate DevTools | **Not done** | No DevTools integration exists |

---

## Detailed Gap Analysis

### 1. Host Config: Start Time Function (Not Implemented)

**What the spec says**: On React DOM, use `window.event.timestamp` if available, else `performance.now()` at `startTransition` call time. On React Native, use Touch event timestamps or `performance.now()`.

**What exists**: `startTime` is initialized to `-1` in `startTransition`, then lazily set to `now()` (Scheduler's time function) in `scheduleUpdateOnFiber`.

**What's needed**: A host config function (e.g., `getTransitionStartTime()`) in `ReactDOMHostConfig` and `ReactNativeHostConfig` that reads the appropriate timestamp source.

**Files to modify**:
- `packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js` — add host config function
- `packages/react/src/ReactStartTransition.js` — call host config at transition creation
- Needs a way to bridge from React (package) to the host config (reconciler package)

**Complexity**: Medium — the challenge is that `startTransition` lives in the `react` package, which doesn't have access to host config functions. May need a shared internals hook.

### 2. Host Config: End Time Function (Partially Implemented)

**What the spec says**: Use `requestAnimationFrame` to get post-paint timestamp, then `setTimeout` to process callbacks.

**What exists**: End time comes from `currentEndTime` set during passive effects or via `schedulePostPaintCallback`. The `schedulePostPaintCallback` mechanism does use `requestAnimationFrame` in some paths.

**What's missing**: Verification that the end time accurately represents paint time across all code paths.

**Complexity**: Low — the infrastructure mostly exists.

### 3. `onTransitionIncomplete` Callback (Type Only)

**What exists**: The callback type is defined in `TransitionTracingCallbacks`. `abortRootTransitions` marks transitions as having aborts in `root.incompleteTransitions`.

**What's missing**: `processTransitionCallbacks` never dispatches `onTransitionIncomplete`. There's no `addTransitionIncompleteCallbackToPendingTransition` accumulation function (only 6 exist, missing this 7th).

**Files to modify**:
- `packages/react-reconciler/src/ReactFiberWorkLoop.js` — add `addTransitionIncompleteCallbackToPendingTransition`
- `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` — add `onTransitionIncomplete` to `PendingTransitionCallbacks` type and `processTransitionCallbacks`
- `packages/react-reconciler/src/ReactFiberCommitWork.js` — call the accumulator in the appropriate abort paths

**Complexity**: Low — follows the pattern of the existing 6 callback accumulators.

### 4. Marker Name Change (Test Skipped)

**What exists**: The commit phase handles name changes by treating them as incomplete. The console warning works (test 18).

**What's broken**: Test 12 is skipped, suggesting the full name-change-during-pending-transition flow has issues. The `TransitionAbort` type has `reason` and `name` but no `newName` field, which the RFC specifies for name changes.

**Files to modify**:
- `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` — add `newName` to `TransitionAbort` type
- `packages/react-reconciler/src/ReactFiberCommitWork.js` — pass `newName` in abort reason
- Fix whatever causes test 12 to fail

**Complexity**: Low-Medium — need to investigate why test 12 was skipped.

### 5. CPU Suspense (Not Supported)

**What the spec says**: N/A (not in original spec)

**What exists**: An explicit TODO: `// TODO: Transition Tracing is not yet implemented for CPU Suspense.`

**Impact**: If CPU Suspense (deferred rendering) becomes a real feature, transition tracing won't track it.

**Complexity**: Medium — depends on CPU Suspense's final design.

### 6. Pre-rendering Interaction

**What exists**: TODO: `// TODO: Pre-rendering should not be counted as part of a transition.`

**Impact**: Pre-rendered trees may incorrectly contribute to transition metrics, inflating boundary counts or delaying completion signals.

**Complexity**: Medium — needs clear rules about when pre-rendering boundaries should be excluded.

### 7. DevTools Integration (Not Started)

**What the spec says** (from implementation checklist): "Integrate DevTools (use commit time to link Profiler data with transition tracing data)"

**What exists**: Nothing. No DevTools hook imports `enableTransitionTracing` or transition tracing types. The DevTools shared package doesn't include the `REACT_TRACING_MARKER_TYPE` symbol.

**What's needed**:
- DevTools Timeline visualization of transitions (start → progress → complete)
- Linking transition data to Profiler commit data
- Displaying TracingMarker boundaries in the component tree
- Exposing transition state in the DevTools inspector

**Complexity**: High — significant DevTools work across multiple packages.

### 8. Redundant `clearTransitionsForLanes`

**Location**: `ReactFiberCommitWork.js:3750, 3763`

Two calls to `clearTransitionsForLanes` in the HostRoot passive mount. The first clears after processing `committedTransitions`, the second after checking `incompleteTransitions`. The first call may make the second's lane-clearing redundant for the same lanes.

**Complexity**: Trivial — investigate and remove if redundant.

---

## Priority Assessment

| Gap | Priority | Rationale |
|-----|----------|-----------|
| Start time host config | P0 | Timestamps are fundamental to the feature's purpose |
| `onTransitionIncomplete` implementation | P1 | Type exists, users expect it to work |
| Marker name change fix | P1 | Skipped test indicates known breakage |
| DevTools integration | P2 | Important for adoption but not blocking core functionality |
| End time verification | P2 | Mostly works, needs audit |
| CPU Suspense support | P3 | Depends on CPU Suspense shipping |
| Pre-rendering exclusion | P3 | Edge case |
| Redundant clear call | P3 | Code quality |
