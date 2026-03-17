# Plan 04: Hydration Tracing

## Problem Statement

`hydrateRoot` accepts `unstable_transitionCallbacks` but there is no mechanism to trace hydration itself -- from server HTML display through selective hydration completion. SSR apps can't measure time-to-interactive through hydration. The RFC lists this as a "Future Goal."

---

## Current State

### Root Creation

Both `createRoot` and `hydrateRoot` pass `transitionCallbacks` identically to `createFiberRoot`:
- `createRoot`: `packages/react-dom/src/client/ReactDOMRoot.js:171-260`
- `hydrateRoot`: `packages/react-dom/src/client/ReactDOMRoot.js:274-358`
- Both reach `createFiberRoot` (`packages/react-reconciler/src/ReactFiberRoot.js:157-236`) which sets `root.transitionCallbacks`

The key difference: `createHydrationContainer` (`packages/react-reconciler/src/ReactFiberReconciler.js:282-351`) schedules initial hydration using a bumped hydration lane.

### Hydration Lane System

React uses dedicated hydration lanes that shadow each priority level (`packages/react-reconciler/src/ReactFiberLane.js:46-122`). `getBumpedLaneForHydrationByLane` maps regular lanes to hydration variants.

### TracingMarker Is Broken on the Server

**Critical finding**: `REACT_TRACING_MARKER_TYPE` is NOT handled in `renderElement` in the Fizz server renderer (`packages/react-server/src/ReactFizzServer.js:2917-2999`). The switch statement handles Fragment, Profiler, StrictMode, Activity, Suspense, etc. -- but NOT TracingMarker. It would throw "Element type is invalid."

### TracingMarker Is Inert During Hydration

Because hydration has no `Transition` objects, `getPendingTransitions()` returns null, so `updateTracingMarkerComponent` (`packages/react-reconciler/src/ReactFiberBeginWork.js:1295-1296`) never creates a `TracingMarkerInstance`. TracingMarker is completely inert during hydration.

### Hydration Completion Detection

The commit phase detects hydration completion:
- **HostRoot** (`ReactFiberCommitWork.js:3806-3893`): Checks `alternate.memoizedState.isDehydrated` and sets `inHydratedSubtree = true`. Also handles transition tracing at root commit -- iterates `incompleteTransitions` and marks complete any transition whose `pendingBoundaries` is empty.
- **SuspenseComponent** (`ReactFiberCommitWork.js:3991-4047`): Detects `prevState.dehydrated !== null` -> `nextState.dehydrated === null`. Checks for `DehydratedFragment` in `deletions` to distinguish successful hydration from abandoned (client render).
- **ActivityComponent** (`ReactFiberCommitWork.js:3937-3989`): Nearly identical logic to SuspenseComponent for dehydrated-to-hydrated transitions.

### Existing Infrastructure That Supports Hydration Tracing

Several pieces are already in place:
- `createHydrationContainer` passes `transitionCallbacks` through to `createFiberRoot` (line 309)
- `updateHostRoot` calls `pushRootMarkerInstance(workInProgress)` BEFORE `enterHydrationState` (lines 1826-1828), so the marker instance stack is active during hydration
- `commitTracingMarkerPassiveMountEffect` (lines 3596-3612) fires immediate marker complete when no pending Suspense boundaries exist
- `inHydratedSubtree` flag in `commitPassiveMountOnFiber` already distinguishes hydrated vs client-rendered commits

---

## Performance Tracks Overlap Analysis

### What Performance Tracks Already Cover

The `enableComponentPerformanceTrack` system (`ReactFiberPerformanceTrack.js`, 1849 lines) already provides significant hydration visibility through Chrome DevTools Performance panel. It tracks hydration through six distinct mechanisms:

#### 1. Per-Component Hydration Color Coding
`logComponentRender()` (line 233) receives a `wasHydrated` boolean. Hydrated components get `tertiary-*` colors (teal palette) instead of `primary-*` colors (blue palette) on the Components track. This makes every hydrated component visually distinct in the flame chart, with self-time bucketing (`<0.5ms` light, `<10ms` medium, `<100ms` dark, `>100ms` error).

#### 2. Render Phase Labels
`logRenderPhase()` (line 1062) checks `includesOnlyHydrationLanes(lanes)` and emits **"Hydrated"** instead of "Render" on the Scheduler track. Similarly, `logInterruptedRenderPhase()` emits **"Interrupted Hydration"** instead of "Interrupted Render". All hydration-lane phases get `tertiary-dark` color.

#### 3. Hydration Failure Detection
- `logRecoveredRenderPhase()` (line 1229) has a `hydrationFailed` parameter that produces tooltip **"Hydration Failed"** instead of "Recovered after Error"
- `logComponentErrored()` (line 387) uses tooltip **"Hydration failed"** specifically for `SuspenseComponent` tag
- Both fire in the commit phase when `ForceClientRender` flag is set on a previously-dehydrated root

#### 4. Mount Suppression
Hydrated components do NOT get "Mount" entries (line 4280 in CommitWork). The `isMount` calculation explicitly excludes `inHydratedSubtree`, so hydrated components only show render entries with the tertiary color — preventing misleading "Mount" markers for components that were already visible via SSR HTML.

#### 5. Boundary-Level Hydration State Tracking
The `inHydratedSubtree` state machine in `commitPassiveMountOnFiber()` detects dehydrated-to-hydrated transitions at both `SuspenseComponent` (line 3991) and `ActivityComponent` (line 3937) boundaries. It distinguishes successful hydration from abandoned hydration (client render fallback) by checking for `DehydratedFragment` in deletions.

#### 6. Lane-Level Timing
Hydration lanes get their own color treatment throughout blocking start, suspended, and delayed phases. `includesOnlyHydrationOrOffscreenLanes()` selects `tertiary-light` for pending segments so the entire hydration lifecycle is visually cohesive in the Scheduler track group.

### What Performance Tracks Do NOT Cover

| Capability | Performance Tracks | Proposed Hydration Tracing |
|---|---|---|
| **Programmatic callbacks** | No — DevTools-only visualization | Yes — `onHydrationStart/Complete/Progress/Incomplete` fire in userland JS |
| **Named boundary tracking** | No — components shown by component name, not Suspense `name` prop | Yes — callbacks include `boundaryName` from `<Suspense name="...">` |
| **Application-level metrics** | No — raw timing only, requires manual DevTools inspection | Yes — callbacks enable RUM (Real User Monitoring) integration, logging to analytics |
| **TracingMarker grouping** | No — no concept of grouping hydration by TracingMarker regions | Yes — markers define logical hydration regions |
| **Progress events** | No — only completion/failure, no incremental progress | Yes — `onHydrationProgress` fires as nested boundaries hydrate |
| **Selective hydration attribution** | Partial — shows the render but not why (user interaction vs priority) | Yes — links hydration to user interaction timing |
| **Production monitoring** | `console.timeStamp` only (no callbacks) | Yes — callbacks work in production for RUM |

### Overlap Assessment

**Phase 1 (Fizz TracingMarker support)**: No overlap. Performance tracks don't touch the server renderer. This is needed regardless.

**Phase 2 (Hydration timing infrastructure)**: **Significant overlap.** Performance tracks already capture per-component start/end times via `fiber.actualStartTime` and sibling timing. Adding `hydrationStartTime` to `FiberRootNode` and `SuspenseState` duplicates timing that performance tracks already derive from lane-level render phase boundaries. However, transition tracing needs these timestamps in a different form — as values passed to userland callbacks rather than as DevTools entries.

**Phase 3 (TracingMarker hydration awareness)**: No overlap. Performance tracks have no concept of TracingMarker at all — the transition tracing track group (`logTransitionTracingStart/Complete/Incomplete`, `logMarkerTracingComplete/Incomplete/Progress`) is called from `processTransitionCallbacks` in `ReactFiberTracingMarkerComponent.js`, which is part of the transition tracing system, not performance tracks. Making TracingMarker active during hydration is purely a transition tracing concern.

**Phase 4 (Commit phase hydration tracking)**: **Moderate overlap.** The `inHydratedSubtree` detection logic and `DehydratedFragment` checking already exist for performance tracks. The proposed hydration callbacks would fire from the same commit-phase locations using the same state detection. This is shared infrastructure, not duplicated work — hydration tracing would add callback accumulation alongside the existing `logComponentRender(wasHydrated)` calls.

**Phase 5 (Callback accumulation)**: No overlap. Performance tracks use `console.timeStamp` / `performance.measure` directly. Transition tracing accumulates callbacks into `PendingTransitionCallbacks` and fires them through `processTransitionCallbacks`. These are completely separate dispatch mechanisms.

**Phase 6 (Selective hydration)**: Minimal overlap. Performance tracks show the render phases but don't attribute selective hydration to user interactions. The proposed tracing would link interaction timing to boundary hydration completion.

### Recommendation

**Phase 1 should proceed as-is** — Fizz TracingMarker support is a prerequisite with no overlap.

**Phases 2-6 should be reconsidered.** The proposed `onHydration*` callbacks add a parallel tracking system for hydration that overlaps with performance tracks' hydration visibility. The key question is: **does the transition tracing API need hydration-specific callbacks, or should it focus on what it does uniquely — tracking user-initiated transitions?**

Arguments for **keeping hydration callbacks** (smaller scope):
- RUM/analytics integration requires programmatic callbacks, not DevTools inspection
- Named boundary tracking (`<Suspense name="...">`) is a transition tracing concept not available in performance tracks
- The existing transition tracing API already has the callback infrastructure; hydration callbacks extend it naturally
- Production monitoring of hydration performance (TTI per boundary) is a real use case that performance tracks can't serve

Arguments for **dropping hydration callbacks** (letting performance tracks handle it):
- The RFC explicitly listed hydration tracing as a "Future Goal," not a core requirement
- Performance tracks already provide comprehensive hydration visibility (component-level, phase-level, failure detection)
- Adding a parallel hydration tracking path without `Transition` objects requires significant complexity (new marker tag, parallel tracking path, synthetic timing)
- The highest-value hydration metrics (overall TTI, per-component hydration cost) are already captured by performance tracks
- Reducing scope keeps the transition tracing API focused on its core purpose: tracking `startTransition`-initiated state changes

**Recommended middle ground**: Implement **Phase 1 only** (Fizz TracingMarker support) as a standalone change. This unblocks using TracingMarker in SSR apps and lets the existing transition tracing callbacks work for post-hydration transitions. Defer Phases 2-6 until there's a concrete use case that performance tracks can't serve. If hydration callbacks are needed later, the infrastructure from Phase 1 makes them straightforward to add.

---

## Implementation Plan

### Phase 1: Server-Side TracingMarker Support (Prerequisite)

Add `REACT_TRACING_MARKER_TYPE` case to `renderElement` in `ReactFizzServer.js`. Render as transparent wrapper (just render children, like Fragment).

**Details**:
- In `packages/react-server/src/ReactFizzServer.js`, add a case in the `renderElement` switch (around line 2958, after the Fragment/Profiler/StrictMode group):
  ```js
  case REACT_TRACING_MARKER_TYPE: {
    // TracingMarker is a client-only tracing concept.
    // On the server, render children directly (like Fragment).
    renderNodeDestructive(request, task, null, props.children, childIndex);
    return;
  }
  ```
- Gate behind `enableTransitionTracing` feature flag
- Import `REACT_TRACING_MARKER_TYPE` from `shared/ReactSymbols`

### Phase 2: Hydration Timing Infrastructure

- Add `hydrationStartTime` field to `FiberRootNode` (set in `createHydrationContainer`)
- Add `hydrationStartTime` to `SuspenseState` (set when entering hydration state)

**Details**:
- In `packages/react-reconciler/src/ReactFiberRoot.js`, add `hydrationStartTime: number` to `FiberRootNode` constructor, initialized to `-1`
- In `packages/react-reconciler/src/ReactFiberReconciler.js` `createHydrationContainer`, after creating the root (line 313), set `root.hydrationStartTime = now()` (using the scheduler's `now` function)
- In `packages/react-reconciler/src/ReactFiberSuspenseComponent.js`, add `hydrationStartTime: number` field to `SuspenseState`, initialized to `-1` when in dehydrated state
- Set the time in `mountDehydratedSuspenseComponent` or wherever `SuspenseState` is created with a `dehydrated` reference

### Phase 3: TracingMarker Hydration Awareness

In `updateTracingMarkerComponent`, check for hydration context and create marker instances even without active transitions. Populate `markerInstanceStack` during hydration.

**Details**:
- In `packages/react-reconciler/src/ReactFiberBeginWork.js` `updateTracingMarkerComponent` (line 1285):
  - On mount (`current === null`), if `getPendingTransitions()` returns null, check `getIsHydrating()` from `ReactFiberHydrationContext`
  - If hydrating, create a `TracingMarkerInstance` with a new tag (e.g., `HydrationTracingMarker`) and store it on `workInProgress.stateNode`
  - This instance won't have associated `Transition` objects but will track `pendingBoundaries` for hydration progress
- The marker instance stack is already active during hydration (pushed by `pushRootMarkerInstance` in `updateHostRoot`), so child Suspense boundaries can look up parent markers

### Phase 4: Commit Phase Hydration Tracking

- Add dehydrated-to-hydrated branch in `commitTransitionProgress`
- Fire hydration callbacks in HostRoot and SuspenseComponent passive mounts

**Details**:
- In `packages/react-reconciler/src/ReactFiberCommitWork.js`:
  - In the SuspenseComponent passive mount case (lines 3991-4047), when detecting a successful dehydrated-to-hydrated transition (`inHydratedSubtree = true` path at line 4027), accumulate hydration completion callbacks
  - In the HostRoot passive mount case (lines 3806-3893), when `inHydratedSubtree` is set, accumulate root-level hydration complete callbacks
  - Use the existing `addMarkerCompleteCallbackToPendingTransition` pattern but for hydration-specific accumulators
- In `commitTransitionProgress` (called from layout effects), add a branch that handles the dehydrated-to-hydrated transition for Suspense boundaries, analogous to the existing fallback-to-content transition tracking

### Phase 5: Callback Accumulation and Processing

Add hydration callback accumulators and extend `processTransitionCallbacks`.

**Details**:
- In `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js`:
  - Add new fields to `PendingTransitionCallbacks`: `hydrationStart`, `hydrationProgress`, `hydrationComplete`, `hydrationIncomplete`
  - Add accumulator functions: `addHydrationStartCallbackToPendingTransition`, `addHydrationCompleteCallbackToPendingTransition`, etc.
  - Extend `processTransitionCallbacks` (lines 76-357) with new sections that iterate accumulated hydration callbacks and fire the user-provided `onHydrationStart`, `onHydrationComplete`, etc.
- In `packages/react-reconciler/src/ReactInternalTypes.js`:
  - Add hydration callback types to `TransitionTracingCallbacks`:
    ```flow
    onHydrationStart?: (boundaryName: string | null, startTime: number) => void,
    onHydrationProgress?: (boundaryName: string | null, startTime: number, currentTime: number, pending: Array<{name: null | string}>) => void,
    onHydrationComplete?: (boundaryName: string | null, startTime: number, endTime: number) => void,
    onHydrationIncomplete?: (boundaryName: string | null, startTime: number, endTime: number, reason: 'error' | 'client-render' | 'timeout') => void,
    ```
- In `packages/react-reconciler/src/ReactFiberWorkLoop.js`:
  - Ensure hydration callbacks are included in the pending transition callbacks that get flushed during passive effects

### Phase 6: Selective Hydration Integration

Track user-interaction-triggered hydration as traced operations.

**Details**:
- When `SelectiveHydrationException` is thrown and the boundary is force-hydrated due to user interaction, capture the interaction start time
- Associate the selective hydration with the appropriate markers via `getMarkerInstances()`
- Fire `onHydrationStart` when selective hydration begins and `onHydrationComplete` when the boundary transitions from dehydrated to hydrated
- Handle the interruption case: `SelectiveHydrationException` can restart renders, so timing must be tracked on the persistent `SuspenseState` (not on the work-in-progress fiber which may be discarded)

---

## Proposed Callbacks

```flow
onHydrationStart?: (boundaryName: string | null, startTime: number) => void,
onHydrationProgress?: (boundaryName: string | null, startTime: number, currentTime: number, pending: Array<{name: null | string}>) => void,
onHydrationComplete?: (boundaryName: string | null, startTime: number, endTime: number) => void,
onHydrationIncomplete?: (boundaryName: string | null, startTime: number, endTime: number, reason: 'error' | 'client-render' | 'timeout') => void,
```

---

## Key Risks

1. **No Transition object for hydration (HIGH)**: The entire system is built around `Transition` objects from `startTransition`. Recommend a parallel tracking path rather than synthetic transitions.
2. **Server renderer crash (HIGH)**: Must fix Fizz TracingMarker handling as prerequisite.
3. **Selective hydration interruptions (MEDIUM)**: `SelectiveHydrationException` can interrupt renders; track start time on persistent `SuspenseState`.
4. **Streaming SSR complications (MEDIUM)**: Boundaries may arrive after initial hydration.
5. **ActivityComponent hydration (MEDIUM)**: Must handle both Suspense and Activity dehydrated states.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-server/src/ReactFizzServer.js` | Add TracingMarker case to `renderElement` |
| `packages/react-reconciler/src/ReactInternalTypes.js` | Add hydration callback types |
| `packages/react-reconciler/src/ReactFiberRoot.js` | Add `hydrationStartTime` field |
| `packages/react-reconciler/src/ReactFiberSuspenseComponent.js` | Add `hydrationStartTime` to `SuspenseState` |
| `packages/react-reconciler/src/ReactFiberReconciler.js` | Record hydration start time |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Make TracingMarker work during hydration |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Track dehydrated-to-hydrated transitions |
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Add hydration callback dispatch |
| `packages/react-reconciler/src/ReactFiberWorkLoop.js` | Add hydration callback accumulators |

---

## Unit Tests

### Test File Location

All hydration tracing unit tests go in the existing file:

**`packages/react-dom/src/__tests__/ReactTransitionTracingHydration-test.js`**

This file already exists with 3 skipped tests awaiting this plan's implementation and 1 active test. As each phase is implemented, unskip the relevant tests and add new ones.

### Test Infrastructure and Patterns

Follow the patterns established in the existing test file:

```js
// @jest-environment jsdom
// @gate enableTransitionTracing

let React;
let ReactDOMClient;
let ReactDOMServer;
let Scheduler;
let act;
let assertLog;
let container;

beforeEach(() => {
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  Scheduler = require('scheduler');
  const InternalTestUtils = require('internal-test-utils');
  act = InternalTestUtils.act;
  assertLog = InternalTestUtils.assertLog;
  container = document.createElement('div');
  document.body.appendChild(container);
});
```

- **SSR**: Use `ReactDOMServer.renderToString()` for synchronous SSR, `ReactDOMServer.renderToPipeableStream()` for streaming SSR
- **Hydration**: Use `ReactDOMClient.hydrateRoot(container, <App />, { unstable_transitionCallbacks })`
- **Assertions**: Log to `Scheduler.log(...)` inside callbacks, verify with `assertLog([...])`
- **Async data**: Use the `throw promise` / `resolve()` Suspense pattern from `ReactTransitionTracing-dom-test.js`
- **Feature gate**: Every test must have `// @gate enableTransitionTracing`

### Phase 1 Tests: Server-Side TracingMarker Support

Unskip and verify the 2 existing tests, plus add streaming test:

**Test 1: Unskip `'TracingMarker renders as fragment during SSR'`**
- Already written at line 43. Remove `it.skip` and `eslint-disable` comment.
- Verifies `renderToString(<TracingMarker>)` outputs only children HTML with no wrapper element.

**Test 2: Unskip `'SSR renderToString with TracingMarker does not crash'`**
- Already written at line 65. Remove `it.skip` and `eslint-disable` comment.
- Verifies single-child TracingMarker in `renderToString`.

**Test 3: Unskip `'renderToPipeableStream with TracingMarker'`**
- Already written at line 199. Remove `it.skip` and `eslint-disable` comment.
- Verifies TracingMarker is transparent in streaming SSR.

**Test 4 (new): `'TracingMarker with nested Suspense in SSR'`**
```js
it('TracingMarker with nested Suspense in SSR', async () => {
  function App() {
    return (
      <React.unstable_TracingMarker name="outer">
        <Suspense fallback={<span>Loading...</span>}>
          <div>Content</div>
        </Suspense>
      </React.unstable_TracingMarker>
    );
  }
  const html = ReactDOMServer.renderToString(<App />);
  expect(html).toBe('<div>Content</div>');
  // TracingMarker adds no DOM, Suspense renders content (not fallback) on server
});
```

**Test 5 (new): `'Nested TracingMarkers in SSR render as fragments'`**
```js
it('Nested TracingMarkers in SSR render as fragments', async () => {
  function App() {
    return (
      <div>
        <React.unstable_TracingMarker name="outer">
          <span>one</span>
          <React.unstable_TracingMarker name="inner">
            <span>two</span>
          </React.unstable_TracingMarker>
        </React.unstable_TracingMarker>
      </div>
    );
  }
  const html = ReactDOMServer.renderToString(<App />);
  expect(html).toBe('<div><span>one</span><span>two</span></div>');
});
```

### Phase 2-4 Tests: Hydration Callbacks

**Test 6 (new): `'onHydrationComplete fires when root hydration finishes'`**
```js
it('onHydrationComplete fires when root hydration finishes', async () => {
  function App() {
    return <div>Hello</div>;
  }
  const transitionCallbacks = {
    onHydrationComplete: (name, startTime, endTime) => {
      Scheduler.log(`onHydrationComplete(${name}, ${startTime}, ${endTime})`);
    },
  };
  container.innerHTML = ReactDOMServer.renderToString(<App />);
  await act(async () => {
    ReactDOMClient.hydrateRoot(container, <App />, {
      unstable_transitionCallbacks: transitionCallbacks,
    });
  });
  // Root-level hydration complete
  assertLog([/* onHydrationComplete with root boundary name */]);
});
```

**Test 7 (new): `'onHydrationComplete fires for Suspense boundary hydration'`**
- SSR an app with `<Suspense name="main">` wrapping content
- Hydrate with `transitionCallbacks` including `onHydrationComplete`
- Verify `onHydrationComplete('main', startTime, endTime)` fires when the dehydrated boundary becomes hydrated

**Test 8 (new): `'onHydrationProgress fires for nested Suspense boundaries'`**
- SSR an app with outer `<Suspense name="page">` containing two inner `<Suspense name="feed">` and `<Suspense name="sidebar">`
- Hydrate with `onHydrationProgress` callback
- Verify progress fires as inner boundaries hydrate incrementally

**Test 9 (new): `'onHydrationIncomplete fires when hydration falls back to client render'`**
- SSR HTML, then hydrate with a component that has a hydration mismatch causing client render fallback
- Verify `onHydrationIncomplete(name, startTime, endTime, 'client-render')` fires

**Test 10 (new): `'onHydrationIncomplete fires on error during hydration'`**
- SSR HTML, then hydrate where a component throws during hydration
- Error boundary catches the error
- Verify `onHydrationIncomplete(name, startTime, endTime, 'error')` fires

**Test 11 (new): `'TracingMarker tracks hydration progress without Transition objects'`**
- SSR an app with `<TracingMarker name="profile">` containing `<Suspense name="data">`
- Hydrate (no `startTransition` involved)
- Verify the marker fires hydration callbacks even though there's no active `Transition`

**Test 12 (new): `'Hydration callbacks include correct timing'`**
- Verify `startTime` reflects when `hydrateRoot` was called
- Verify `endTime` reflects when the hydrated content is committed
- Use `performance.now()` mocking to control timestamps

### Phase 5-6 Tests: Selective Hydration and Edge Cases

**Test 13: Unskip `'Transition started during selective hydration with TracingMarker'`**
- Already written at line 148. Remove `it.skip`.
- This test will need to be updated to use `renderToPipeableStream` instead of `renderToString` once Phase 1 is complete, since TracingMarker will be supported in Fizz.

**Test 14 (new): `'Selective hydration triggered by user interaction fires callbacks'`**
- SSR with streaming, deliver a dehydrated Suspense boundary
- Simulate a click on the dehydrated content (triggers selective hydration)
- Verify `onHydrationStart` and `onHydrationComplete` fire for that boundary

**Test 15 (new): `'Streaming SSR with late-arriving Suspense boundaries'`**
- Use `renderToPipeableStream` with a suspending component
- Hydrate before the server content arrives
- Verify hydration callbacks fire correctly when boundaries resolve on both server and client sides

**Test 16 (new): `'Activity component hydration fires callbacks'`**
- SSR with `<Activity>` containing dehydrated content
- Hydrate and verify hydration callbacks fire for Activity boundaries (not just Suspense)

**Test 17 (new): `'Multiple Suspense boundaries hydrate independently'`**
- SSR with multiple sibling `<Suspense>` boundaries
- Hydrate and verify each fires independent `onHydrationComplete` with correct `boundaryName`

**Test 18 (new): `'Post-hydration transitions still fire normal transition callbacks'`**
- This test already exists (line 80) and passes. Keep it as a regression test to ensure hydration tracing doesn't break existing post-hydration transition behavior.

### Running Tests

```bash
# Run just the hydration tracing tests
yarn jest packages/react-dom/src/__tests__/ReactTransitionTracingHydration-test.js --reactVersion=experimental

# Run all transition tracing tests together
yarn jest --testPathPattern='ReactTransitionTracing' --reactVersion=experimental

# Run with verbose output for debugging
yarn jest packages/react-dom/src/__tests__/ReactTransitionTracingHydration-test.js --reactVersion=experimental --verbose
```

All tests require the `enableTransitionTracing` feature flag, which is enabled in the experimental channel. Use `--reactVersion=experimental` or ensure the flag is on.

---

## Fixture App: SSR/Hydration Scenario

### Overview

Add a new SSR page to the existing transition tracing fixture at `fixtures/transition-tracing/`. This requires converting the fixture from a purely client-rendered Vite app to one that supports an SSR entry point for the hydration page.

### New Files

```
fixtures/transition-tracing/
  server.js                              # Express server for SSR page
  src/
    ssr-entry.jsx                        # Server-side render entry
    components/
      HydrationPage.jsx                  # SSR + hydration demo page
      HydrationPage.module.css
```

### Server Setup (`server.js`)

A minimal Express server that:
1. Imports the SSR entry and uses `renderToPipeableStream` to server-render the `HydrationPage`
2. Serves the page at `/ssr` (or as a route within the existing app)
3. Injects the client bundle for hydration
4. Falls back to Vite's dev server for all other routes (the existing client-only pages)

```js
// fixtures/transition-tracing/server.js
import express from 'express';
import {renderToPipeableStream} from 'react-dom/server';
import {HydrationPage} from './src/components/HydrationPage';

const app = express();

app.get('/ssr', (req, res) => {
  const {pipe} = renderToPipeableStream(
    <HydrationPage />,
    {
      bootstrapScripts: ['/src/ssr-hydrate.jsx'],
      onShellReady() {
        res.setHeader('Content-Type', 'text/html');
        pipe(res);
      },
    }
  );
});

// Proxy other routes to Vite dev server
// ...
```

### Alternative: In-App SSR Simulation (Simpler Approach)

If a full Express server is too heavy for the fixture, use an **in-app SSR simulation** approach:

1. Add a "Hydration Demo" button to the NavBar
2. The `HydrationPage` component:
   - On mount, calls `renderToString(<SSRContent />)` in the browser
   - Injects the HTML into a container div
   - Calls `hydrateRoot(container, <SSRContent />, { unstable_transitionCallbacks })` with the tracing dashboard's callbacks
   - The dashboard shows hydration events alongside normal transition events

This avoids needing a separate server while still demonstrating the hydration tracing API.

### HydrationPage Component

```jsx
// fixtures/transition-tracing/src/components/HydrationPage.jsx
import React, {Suspense, useState, useRef, useEffect} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {renderToString} from 'react-dom/server';
import {createTracingCallbacks} from '../dashboard/TracingDashboard';
import {useSimulatedDelay} from '../hooks/useSimulatedDelay';

function SSRContent() {
  return (
    <React.unstable_TracingMarker name="ssr-page">
      <Suspense name="ssr-header" fallback={<div>Loading header...</div>}>
        <Header />
      </Suspense>
      <React.unstable_TracingMarker name="ssr-page:content">
        <Suspense name="ssr-content" fallback={<div>Loading content...</div>}>
          <MainContent />
        </Suspense>
      </React.unstable_TracingMarker>
      <React.unstable_TracingMarker name="ssr-page:sidebar">
        <Suspense name="ssr-sidebar" fallback={<div>Loading sidebar...</div>}>
          <Sidebar />
        </Suspense>
      </React.unstable_TracingMarker>
    </React.unstable_TracingMarker>
  );
}

function Header() {
  const data = useSimulatedDelay('ssrHeader', 300);
  return <div className="header">{data}</div>;
}

function MainContent() {
  const data = useSimulatedDelay('ssrContent', 1000);
  return <div className="content">{data}</div>;
}

function Sidebar() {
  const data = useSimulatedDelay('ssrSidebar', 2000);
  return <div className="sidebar">{data}</div>;
}

export default function HydrationPage({eventEmitter}) {
  const containerRef = useRef(null);
  const [hydrationState, setHydrationState] = useState('idle');
  // idle | server-rendered | hydrating | hydrated

  const handleSSRAndHydrate = () => {
    // Step 1: Server render
    const html = renderToString(<SSRContent />);
    containerRef.current.innerHTML = html;
    setHydrationState('server-rendered');

    // Step 2: Hydrate after a brief delay (simulating JS bundle load)
    setTimeout(() => {
      setHydrationState('hydrating');
      const {callbacks} = createTracingCallbacks(eventEmitter);
      hydrateRoot(containerRef.current, <SSRContent />, {
        unstable_transitionCallbacks: callbacks,
      });
      setHydrationState('hydrated');
    }, 500);
  };

  return (
    <div>
      <h2>Hydration Tracing Demo</h2>
      <p>Status: {hydrationState}</p>
      <button onClick={handleSSRAndHydrate}>
        SSR + Hydrate
      </button>
      <div ref={containerRef} style={{border: '1px solid #ccc', padding: 16}} />
    </div>
  );
}
```

### Dashboard Integration

The existing `TracingDashboard` already handles all transition callbacks via the `eventEmitter` pub/sub pattern. To support hydration callbacks:

1. In `TracingDashboard.jsx` `createTracingCallbacks()`, add the new hydration callbacks to the returned `callbacks` object:
   ```js
   onHydrationStart: (name, startTime) => {
     emitter.emit({type: 'hydration-start', name, startTime});
   },
   onHydrationProgress: (name, startTime, currentTime, pending) => {
     emitter.emit({type: 'hydration-progress', name, startTime, currentTime, pending});
   },
   onHydrationComplete: (name, startTime, endTime) => {
     emitter.emit({type: 'hydration-complete', name, startTime, endTime});
   },
   onHydrationIncomplete: (name, startTime, endTime, reason) => {
     emitter.emit({type: 'hydration-incomplete', name, startTime, endTime, reason});
   },
   ```

2. In `EventLog.jsx`, add color coding for hydration events (e.g., cyan for hydration-start, teal for hydration-complete)

3. In `Timeline.jsx`, render hydration operations as a distinct bar type (e.g., dashed border or different color palette to distinguish from transition bars)

### NavBar Integration

Add a "Hydration" button to `NavBar.jsx` alongside the existing Home, Profile, Search, Activity buttons. This navigates to the `HydrationPage` via the existing routing mechanism in `App.jsx`.

### Package Dependencies

The `renderToString` import requires `react-dom/server` to be available in the browser bundle. Since the fixture already copies the experimental build into `node_modules/`, this should work. If not, the in-app simulation approach can use a pre-rendered HTML string instead of calling `renderToString` at runtime (similar to the approach in the existing hydration unit test at line 117).

### What This Demonstrates

1. **Server rendering with TracingMarker**: Shows that TracingMarker is transparent on the server (Phase 1)
2. **Hydration timing**: Shows `onHydrationStart` -> `onHydrationProgress` -> `onHydrationComplete` lifecycle in the dashboard
3. **Incremental hydration**: Multiple Suspense boundaries hydrate at different times, showing progress events
4. **Visual comparison**: The dashboard shows hydration events alongside normal transition events, making it easy to see the difference
5. **Error scenarios**: Could add a toggle (like SearchPage's error mode) to force a hydration mismatch, demonstrating `onHydrationIncomplete`

---

## Implementation Order

1. **Phase 1** first (Fizz support) -- this unblocks everything else and unskips 3 tests immediately
2. **Phase 2** next (timing infrastructure) -- data model changes with no behavioral impact
3. **Phases 3-5** together (TracingMarker awareness + commit tracking + callbacks) -- these are tightly coupled
4. **Phase 6** last (selective hydration) -- can be done independently after the core is working
5. **Fixture updates** can be done in parallel with Phase 3-5, since the in-app simulation approach doesn't require the full hydration callback infrastructure

**Estimated effort**: Large. This is the most complex plan in the set, touching server renderer, reconciler render phase, commit phase, lane system, and callback infrastructure.
