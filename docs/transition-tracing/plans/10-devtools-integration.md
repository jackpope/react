# Plan 10: DevTools Integration

## Problem Statement

No DevTools integration exists. Transition tracing data is only available through root-level callbacks. The implementation checklist says: "Integrate DevTools (use commit time to link Profiler data with transition tracing data)."

---

## What Already Exists

TracingMarker has **partial** DevTools support:

| Aspect | Status |
|--------|--------|
| `TracingMarkerComponent` in `WorkTagMap` | Done (renderer.js:412) |
| `ElementTypeTracingMarker = 14` | Done (frontend/types.js:51) |
| `getDisplayNameForFiber()` returns `'TracingMarker'` | Done (renderer.js:717-718) |
| `getElementTypeForFiber()` returns correct type | Done (renderer.js:1735-1736) |
| Not filtered by `shouldFilterFiber()` | Done |
| `name` prop extracted for tree display | **NOT DONE** |
| Transition state in inspector | **NOT DONE** |
| Timeline visualization | **NOT DONE** |
| Profiler data linking | **NOT DONE** |

---

## Phase 1: Component Tree Support (Low effort, 1-2 days)

### 1a. Extract `name` prop

**File**: `packages/react-devtools-shared/src/backend/fiber/renderer.js` (~line 2375)

Add `TracingMarkerComponent` to the `nameProp` extraction alongside `SuspenseComponent` and `ActivityComponent`.

### 1b. Show transition state in inspector

In `inspectElementRaw()`, expose `TracingMarkerInstance` data: transitions (names, startTimes), pending boundaries, and status (pending/complete/incomplete).

---

## Phase 2: Timeline Visualization (High effort, 1-2 weeks)

### 2a. Define transition event types

**File**: `packages/react-devtools-timeline/src/types.js`

Add `TransitionEvent` and `TransitionMarkerEvent` types. Extend `TimelineData` with `transitionEvents` array.

### 2b. Add profiling hooks

**File**: `packages/react-devtools-shared/src/backend/profilingHooks.js`

Implement `markTransitionStarted`, `markTransitionComplete`, `markTransitionProgress`, `markMarkerComplete`, `markMarkerProgress`, `markMarkerIncomplete` in `createProfilingHooks()`. Also emit `performance.mark()` calls for Chrome Performance panel.

### 2c. Call hooks from reconciler

In `processTransitionCallbacks` and HostRoot passive mount, call DevTools profiling hooks alongside user callbacks.

### 2d. Create TransitionEventsView

**File** (new): `packages/react-devtools-timeline/src/content-views/TransitionEventsView.js`

Model after `SuspenseEventsView.js`. Transitions as horizontal bars (start->end), markers as nested bars. Green=complete, yellow=pending, red=incomplete.

### 2e. Wire up in CanvasPage

Add view to layout. Add tooltip rendering in `EventTooltip.js`.

---

## Phase 3: Profiler Linking (Medium-High effort, 3-5 days)

### 3a. Add transition context to commit data

Extend `CommitDataBackend` with `activeTransitions` and `transitionEvents`.

### 3b. Display in Profiler sidebar

Show which transitions were active during selected commit in `SidebarCommitInfo.js`.

### 3c. Cross-panel navigation

Allow clicking a transition in Timeline to navigate to relevant Profiler commits.

---

## Key Files

### Phase 1
| File | Action |
|------|--------|
| `packages/react-devtools-shared/src/backend/fiber/renderer.js` | Add name prop + inspector state |

### Phase 2
| File | Action |
|------|--------|
| `packages/react-devtools-timeline/src/types.js` | New event types |
| `packages/react-devtools-shared/src/backend/types.js` | New profiling hooks |
| `packages/react-devtools-shared/src/backend/profilingHooks.js` | Implement hooks |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Call hooks |
| `packages/react-devtools-timeline/src/content-views/TransitionEventsView.js` | **New file** |
| `packages/react-devtools-timeline/src/CanvasPage.js` | Wire up view |
| `packages/react-devtools-timeline/src/EventTooltip.js` | Tooltip rendering |

### Phase 3
| File | Action |
|------|--------|
| `packages/react-devtools-shared/src/backend/types.js` | Extend `CommitDataBackend` |
| `packages/react-devtools-shared/src/backend/fiber/renderer.js` | Collect transition data |
| `packages/react-devtools-shared/src/devtools/views/Profiler/SidebarCommitInfo.js` | Display transitions |

---

## Risks

1. **Feature flag guard**: All changes must be gated on `enableTransitionTracing`
2. **Performance**: Profiling hooks guarded by `isProfiling` check
3. **Backwards compatibility**: Handle renderers without transition tracing support
4. **Timeline panel uncertainty**: Keep data collection separate from visualization
