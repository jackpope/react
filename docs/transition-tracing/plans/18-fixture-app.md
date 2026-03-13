# Plan 18: Transition Tracing Fixture App

## Problem Statement

There is no interactive test application for transition tracing. The feature can only be exercised through unit tests using `react-noop-renderer`. A fixture app would provide manual testing in a real DOM environment, visual feedback for transition lifecycle events, and a development aid for iterating on the API.

---

## Structure

Following the `view-transition` fixture pattern (CRA-style with `react-scripts`):

```
fixtures/transition-tracing/
  package.json
  public/
    index.html
  src/
    index.js              # Entry point, createRoot with transitionCallbacks
    App.js                # Router and layout
    components/
      NavBar.js           # Navigation buttons triggering named transitions
      HomePage.js         # Simple page (no Suspense)
      ProfilePage.js      # Page with nested TracingMarkers and Suspense
      PhotoModal.js       # Modal overlay (tests subtree ignore pattern)
      SearchPage.js       # Page with multiple independent loading sections
    hooks/
      useSimulatedDelay.js  # Configurable async resource simulation
    dashboard/
      TracingDashboard.js   # Real-time callback visualization
      EventLog.js           # Scrolling log of all transition events
      TimelineView.js       # Visual timeline of transitions
    data/
      fakeApi.js            # Simulated async data fetching with configurable delays
```

---

## Package Configuration

```json
{
  "name": "transition-tracing-fixture",
  "private": true,
  "dependencies": {
    "react": "experimental",
    "react-dom": "experimental"
  },
  "devDependencies": {
    "react-scripts": "^5.0.0"
  },
  "scripts": {
    "predev": "cp -r ../../build/oss-experimental/* ./node_modules/ && rm -rf node_modules/.cache;",
    "dev": "react-scripts start",
    "prebuild": "cp -r ../../build/oss-experimental/* ./node_modules/ && rm -rf node_modules/.cache;",
    "build": "react-scripts build"
  }
}
```

Requires building React with `enableTransitionTracing = true` in the experimental build.

---

## Entry Point

```jsx
// src/index.js
import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {createTracingCallbacks} from './dashboard/TracingDashboard';

const {callbacks, eventEmitter} = createTracingCallbacks();

const root = createRoot(document.getElementById('root'), {
  unstable_transitionCallbacks: callbacks,
});

root.render(<App eventEmitter={eventEmitter} />);
```

---

## Page Scenarios

### Scenario 1: Basic Navigation (RFC "Navigating to Profile")

**Page**: `ProfilePage.js`

```jsx
function ProfilePage({id}) {
  return (
    <React.unstable_TracingMarker name="profile">
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileHeader id={id} />
        <React.unstable_TracingMarker name="profile:photo-feed">
          <Suspense name="photo-feed" fallback={<FeedSkeleton />}>
            <PhotoFeed id={id} />
          </Suspense>
        </React.unstable_TracingMarker>
        <React.unstable_TracingMarker name="profile:profile-feed">
          <Suspense name="profile-feed" fallback={<FeedSkeleton />}>
            <ProfileFeed id={id} />
          </Suspense>
        </React.unstable_TracingMarker>
      </Suspense>
    </React.unstable_TracingMarker>
  );
}
```

**Exercises**: `onTransitionStart`, `onTransitionProgress`, `onTransitionComplete`, `onMarkerProgress`, `onMarkerComplete`, nested TracingMarkers with independent Suspense boundaries, incremental resolution.

### Scenario 2: Modal Overlay (RFC "Ignoring Subtrees")

**Page**: `PhotoModal.js` rendered via portal from ProfilePage.

**Exercises**: Subtree ignore pattern via Suspense `name` matching, `onMarkerProgress` with `pending` array filtering, portal rendering with TracingMarker.

### Scenario 3: Rapid Navigation (Batched Transitions)

Two navigation buttons clicked in rapid succession.

**Exercises**: Transition batching, transition supersession detection, `onMarkerIncomplete` when markers are deleted by navigation.

### Scenario 4: Error During Loading

**Page**: `SearchPage.js` with a component that can be toggled to throw.

**Exercises**: Error boundary inside TracingMarker, `onMarkerIncomplete` with error deletion type, recovery after error.

### Scenario 5: Activity (Offscreen) Content

ProfilePage with a hidden details section toggled visible/hidden.

**Exercises**: Hidden trees not blocking transition completion, revealing hidden content as a new transition.

---

## Tracing Dashboard

### EventLog Component

Scrolling list of all transition events with:
- Event type (start, progress, complete, incomplete)
- Transition name and marker name
- Timestamps (startTime, currentTime/endTime)
- Pending boundaries list (for progress events)
- Deletion info (for incomplete events)
- Color coding by transition name

### TimelineView Component

Horizontal timeline showing:
- Each transition as a horizontal bar (start -> complete/incomplete)
- Markers as nested bars within their transition
- Suspense boundaries as dots (suspend -> resolve)
- Color coding: green = complete, red = incomplete, yellow = in progress

### Controls

- **Delay sliders**: Configurable delay per simulated async resource (0ms-5000ms)
- **Error toggles**: Force specific components to throw
- **Clear log**: Reset the event log
- **Freeze**: Pause scrolling for inspection

---

## Build Considerations

### Feature Flag

`enableTransitionTracing` is `false` in the default OSS build. Options:

1. **Experimental build** (recommended): If the experimental build includes transition tracing, the `predev` script works as-is
2. **Runtime check**: `index.js` checks if `React.unstable_TracingMarker` is defined and shows "feature not enabled" message if not

### `unstable_` Prefix

The fixture uses `unstable_` prefix APIs as they currently exist. Update if APIs are stabilized later.

---

## Implementation Phases

### Phase 1: Basic Setup
- Package.json, public/index.html, entry point
- NavBar with Home/Profile navigation
- Simple EventLog dashboard
- ProfilePage with nested TracingMarkers and Suspense

### Phase 2: Full Scenarios
- PhotoModal with portal
- SearchPage with error toggle
- Activity hidden content
- Delay controls for simulated resources

### Phase 3: Timeline Visualization
- TimelineView component
- Visual transition bars and marker nesting
- Timestamp accuracy verification

### Phase 4: Polish
- Styling and layout
- Help text explaining each scenario
- Links to the RFC and API docs
