# Enhancement Suggestions

Ideas for improving transition tracing beyond the original specification, informed by Hero Tracing patterns and real-world usage needs.

---

## Enhancement 1: HoldTrigger Component for Non-Suspense Loading States

**Inspiration**: Hero Tracing's `<HeroHoldTrigger hold={boolean}>`

**Problem**: Many apps have loading states not backed by Suspense — imperative loading indicators, timer-based delays, non-React async operations, or incremental migration paths where not everything uses Suspense yet.

**Proposal**: A `<TracingHold hold={boolean}>` component (or similar) that signals a loading state to the nearest `TracingMarker` without using Suspense.

```jsx
function DataGrid({data, isLoading}) {
  return (
    <TracingMarker name="data-grid">
      <TracingHold hold={isLoading} name="grid-data" />
      {isLoading ? <Spinner /> : <Grid data={data} />}
    </TracingMarker>
  );
}
```

**Implementation approach**: Similar to how Suspense boundaries register with marker instances, `TracingHold` would register/unregister itself as a pending boundary. When `hold` transitions from `true` to `false`, the boundary is removed from the marker's `pendingBoundaries`.

**Complexity**: Medium — needs new fiber type or effect-based tracking, plus integration with the existing pending boundaries system.

---

## Enhancement 2: Richer Abort Metadata

**Problem**: The current `TransitionAbort` type is minimal:
```flow
type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
};
```

The RFC specifies richer deletion info including `endTime`, `newName` (for renames), `boundary`, `error`, and `componentStack` for error cases. The current implementation doesn't capture most of this.

**Proposal**: Expand `TransitionAbort` to include:
```flow
type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
  newName?: string | null,    // for marker renames
  endTime: number,            // when the abort occurred
  error?: mixed,              // for error boundary cases
  componentStack?: string,    // for debugging
};
```

**Benefit**: Enables users to distinguish between cancellations (user navigated away), errors (component threw), and renames. The `endTime` enables duration measurement even for incomplete transitions.

**Complexity**: Low — extends existing types and abort-creation call sites.

---

## Enhancement 3: DevTools Timeline Integration

**Problem**: No DevTools integration exists. Transition tracing data is only available through root-level callbacks, requiring users to build their own visualization.

**Proposal**: Integrate transition tracing with the DevTools Timeline (Scheduling Profiler):

1. **Timeline lanes per transition**: Show each named transition as a lane in the timeline, with visual markers for start, suspense boundaries suspending/resolving, and completion.
2. **TracingMarker tree view**: In the Components tab, show TracingMarker components with their current state (pending boundaries, transitions).
3. **Profiler linking**: Connect transition events to Profiler commits, so users can see which commits were part of a transition and what rendered in each.

**Implementation points**:
- Add `REACT_TRACING_MARKER_TYPE` to `react-devtools-shared/src/backend/ReactSymbols`
- Emit transition events through the DevTools hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`)
- Add timeline visualization in `react-devtools-timeline`

**Complexity**: High — spans multiple DevTools packages and requires new visualization work.

---

## Enhancement 4: Transition Metadata / Tags

**Problem**: Transitions only have a `name`. There's no way to attach arbitrary metadata (user ID, page type, A/B test bucket, etc.) that would be useful for analytics.

**Proposal**: Extend `StartTransitionOptions` with a `metadata` field:

```js
startTransition(() => setPage('profile'), {
  name: 'navigate',
  metadata: {
    from: 'home',
    to: 'profile',
    userId: currentUser.id,
  },
});
```

The metadata would flow through to all callbacks as an additional parameter.

**Benefit**: Eliminates the need for users to maintain external maps from transition names to metadata. Particularly useful for analytics pipelines.

**Complexity**: Low — extends `Transition` type, passes through existing plumbing.

---

## Enhancement 5: Per-Marker Callbacks

**Problem**: All callbacks are registered at root creation. For large apps with many unrelated transitions, every callback receives events for every transition, requiring filtering logic.

**Proposal**: Allow callbacks as props on `TracingMarker`:

```jsx
<TracingMarker
  name="profile-feed"
  onComplete={(startTime, endTime) => logMetric('profile-feed', endTime - startTime)}
  onProgress={(startTime, currentTime, pending) => updateLoadingBar(pending)}
>
  <Suspense fallback={<FeedSkeleton />}>
    <ProfileFeed />
  </Suspense>
</TracingMarker>
```

**Benefit**: Collocates tracing logic with the component it tracks. Reduces boilerplate in the root callbacks. Makes it easier to add tracing to specific parts of an app without a centralized callback registry.

**Trade-off**: The root-level callback pattern is more flexible for aggregation and post-processing. Per-marker callbacks are better for local concerns. Both could coexist.

**Complexity**: Medium — needs to fire callbacks from `commitTracingMarkerPassiveMountEffect` using the marker's props.

---

## Enhancement 6: Transition Timeout / SLA Support

**Problem**: The RFC mentions implementing timeouts in userland via `onTransitionStart`, but this is cumbersome and error-prone.

**Proposal**: A `timeout` option on `startTransition`:

```js
startTransition(() => setPage('profile'), {
  name: 'navigate',
  timeout: 3000, // ms
});
```

When the timeout expires, `onTransitionIncomplete` (or a new `onTransitionTimeout`) fires automatically. The transition is marked as timed out but continues tracking (so the actual completion time is still available).

**Benefit**: Built-in SLA monitoring without userland timer management. Particularly valuable for performance budgets.

**Complexity**: Medium — needs a timer registration mechanism tied to the transition lifecycle.

---

## Enhancement 7: Batched Transition Disambiguation

**Problem**: When transitions batch (e.g., clicking Home then Marketplace quickly), the RFC requires users to manually disambiguate by comparing transition names to marker names. This is error-prone.

**Proposal**: Enhance the callback API to indicate when a transition was superseded by batching:

- Add a `supersededBy?: string` field to completion callbacks
- Or add a dedicated `onTransitionSuperseded(transitionName, supersedingTransitionName, startTime)` callback

**Benefit**: Removes the need for users to implement the "is the marker name a substring of the transition name" heuristic from the RFC examples.

**Complexity**: Medium — needs batching detection logic in the commit phase.

---

## Priority Ranking

| Enhancement | Value | Complexity | Recommendation |
|-------------|-------|------------|----------------|
| Richer abort metadata | High | Low | Do first — aligns implementation with RFC spec |
| Transition metadata/tags | High | Low | High value, minimal effort |
| DevTools Timeline | High | High | Important for adoption, can be phased |
| HoldTrigger component | Medium | Medium | Unblocks non-Suspense use cases |
| Per-marker callbacks | Medium | Medium | Quality of life, can coexist with root callbacks |
| Timeout/SLA support | Medium | Medium | Nice to have, userland workaround exists |
| Batched disambiguation | Low | Medium | Edge case, RFC workaround is functional |
