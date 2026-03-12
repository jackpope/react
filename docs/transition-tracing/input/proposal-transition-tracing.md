# Proposal: React DevTools Interaction Tracing

## Overview

React has two existing profiling tools:

- **The Profiler** shows an overview of all commits in a profiling session. For each commit, it shows all components that rendered and how long they took.
- **The Scheduling Profiler** shows when components schedule updates and when React works on those updates.

Both help developers identify performance problems, but they share a key limitation: developers don't find knowing about individual slow commits or components out of context that useful. They want to know what *causes* slow commits. They want to track specific interactions (e.g. a button click, initial load, or page navigation) to watch for performance regressions and understand why an interaction was slow.

There is currently no way to answer these questions in open source. Facebook created an internal interaction tracing API (Hero Tracing) and associated visualization tools, but because they are separate from the React ecosystem, open source can't benefit from them. Additionally, Facebook developers have to choose between the internal API or React DevTools, creating a poor experience.

### Previous Attempt

We previously tried to solve this with an Interaction Tracing API, but it had fundamental design flaws. Interactions were tracked at the root, so when React batched updates, their interactions became entangled. Follow-up work or async requests (e.g. prefetching pages) would continue the interaction indefinitely. Cascading updates carried entangled interactions even after they had completed, resulting in never-ending interactions. The API was removed because of these issues.

## Goals

1. Release an interaction tracing API to OSS and integrate it with React Profiler so developers can understand why their code is slow.
2. Work with the Web Speed team to migrate the internal Hero Tracing API to use the React API under the hood, unifying interaction tracing for OSS and Facebook.

## Requirements

The API needs:

- A way to start an interaction
- A way to define the area of the React tree tracked as a result of an interaction
- Support for multiple concurrent interactions with the ability to cancel
- A way to mark subsections of the page with interaction performance data
- A way to ignore a subtree
- Support for both server and client rendering (server for initial load)
- Support for navigation vs regular interactions
- A way to mark a loading state without Suspense

## Proposed API

### `startTransition(callback, transitionName?)`

Passing a `transitionName` to `startTransition` starts a traced interaction.

### Suspense Boundary Integration

Interaction data is stored on Suspense boundary fibers rather than at the root. This avoids the entanglement problems from the previous API. Transitions are propagated only on Suspense retries.

Key behaviors:

- All transitions in a single event are batched together.
- **Entanglement:** One lane cannot finish without another when two different lanes render at the same time or there are parallel transitions. For example, toggling tabs should only show the last tab.
- **Interleaving:** A render starts, yields, and an event fires. If the event is lower priority, React keeps working on the current render. If higher priority, the current work is discarded.

### Example

```jsx
function ProfileAboutYou({id}) {
  const data = fetchAboutYouData(id);
  return (
    <TracingMarker name="profile-load:profile:about-you">
      ...
    </TracingMarker>
  );
}

function Profile({id}) {
  return (
    <TracingMarker name="profile-load:profile">
      <Suspense fallback={<div>Loading...</div>}>
        <ProfileAboutYou id={123} />
        <ProfileFeed id={123} />
      </Suspense>
    </TracingMarker>
  );
}

startTransition(() => {
  root.render(<Profile id="123" />);
}, 'profile-load');
```

## Open Questions

- What's the difference between `startInteraction` and `trace` APIs? Why are both necessary?
- What's the difference between `HeroPagelet` and `HeroPlaceholder`?
- What are the constraints that Hero Tracing needs to operate under?
- Are there any pain points with the current Hero Tracing API?
- What parts of the current Hero Tracing API can be dropped?
- What do we need to cancel an interaction? Use cases include:
  - User navigates away
  - Timeout
  - Hero tracing root is unmounted
- How should stale data be handled while loading new data?
