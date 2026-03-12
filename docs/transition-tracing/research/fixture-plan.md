# Fixture Plan

Design for a transition tracing fixture app under `/fixtures/transition-tracing/`.

---

## Goals

1. **Manual testing**: Exercise transition tracing in a real DOM environment with visual feedback
2. **Scenario coverage**: Reproduce the key scenarios from the RFC (profile page, photo modal, batched navigations)
3. **Callback visualization**: Real-time dashboard showing transition lifecycle events
4. **Development aid**: Make it easy to experiment with the API during development

---

## Fixture Structure

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

**Note**: Requires building React with `enableTransitionTracing = true` in the experimental build. This may require a feature flag override during build.

---

## Entry Point (`src/index.js`)

```jsx
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

**Exercises**:
- `onTransitionStart`, `onTransitionProgress`, `onTransitionComplete`
- `onMarkerProgress`, `onMarkerComplete`
- Nested TracingMarkers with independent Suspense boundaries
- Incremental resolution (feeds resolve at different times)

### Scenario 2: Modal Overlay (RFC "Ignoring Subtrees")

**Page**: `PhotoModal.js` (rendered from ProfilePage)

```jsx
function PhotoModal({show}) {
  if (!show) return null;
  return ReactDOM.createPortal(
    <React.unstable_TracingMarker name="photo-modal">
      <Suspense name="photo-modal" fallback={<ModalSkeleton />}>
        <FullSizePhoto />
      </Suspense>
    </React.unstable_TracingMarker>,
    document.getElementById('modal-root'),
  );
}
```

**Exercises**:
- Subtree ignore pattern via Suspense `name` matching
- `onMarkerProgress` with `pending` array filtering
- Portal rendering with TracingMarker

### Scenario 3: Rapid Navigation (Batched Transitions)

**Controls**: Two navigation buttons that can be clicked in rapid succession.

**Exercises**:
- Transition batching (clicking Home → Profile → Search quickly)
- Transition supersession detection
- `onMarkerIncomplete` when markers are deleted by navigation

### Scenario 4: Error During Loading

**Page**: `SearchPage.js` with a component that can be toggled to throw.

**Exercises**:
- Error boundary inside TracingMarker
- `onMarkerIncomplete` with error deletion type
- Recovery after error

### Scenario 5: Activity (Offscreen) Content

**Page**: ProfilePage with a hidden details section.

```jsx
<Activity mode={showDetails ? 'visible' : 'hidden'}>
  <React.unstable_TracingMarker name="profile:details">
    <Suspense fallback={<DetailsSkeleton />}>
      <ProfileDetails id={id} />
    </Suspense>
  </React.unstable_TracingMarker>
</Activity>
```

**Exercises**:
- Hidden trees not blocking transition completion
- Revealing hidden content as a new transition

---

## Tracing Dashboard

A persistent UI panel that visualizes callback data in real-time.

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
- Each transition as a horizontal bar (start → complete/incomplete)
- Markers as nested bars within their transition
- Suspense boundaries as dots on the timeline (suspend → resolve)
- Color coding: green = complete, red = incomplete, yellow = in progress

### Controls

- **Delay sliders**: Configurable delay for each simulated async resource (0ms–5000ms)
- **Error toggles**: Force specific components to throw
- **Clear log**: Reset the event log
- **Freeze**: Pause event log scrolling for inspection

---

## Simulated Data Layer

```js
// src/data/fakeApi.js

const delays = {
  profileHeader: 500,
  photoFeed: 1500,
  profileFeed: 2000,
  fullSizePhoto: 800,
  searchResults: 1200,
};

export function setDelay(resource, ms) {
  delays[resource] = ms;
}

export function fetchResource(resource) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(generateFakeData(resource)), delays[resource]);
  });
}
```

Resources use React's cache/Suspense integration to trigger Suspense boundaries naturally.

---

## Build Considerations

### Feature Flag

`enableTransitionTracing` is `false` in the default OSS build. The fixture needs the flag enabled.

**Options**:
1. **Experimental build override**: If the experimental build includes transition tracing, the `predev` script works as-is
2. **Fork feature flags**: Create a fixture-specific feature flag override (similar to how www builds enable it)
3. **Runtime check**: The fixture's `index.js` can check if `React.unstable_TracingMarker` is defined and show a "feature not enabled" message if not

**Recommendation**: Option 1 (experimental build) is simplest. If transition tracing isn't in the experimental build, enable it there as part of the feature work.

### `unstable_` Prefix

The fixture should use the `unstable_` prefix APIs as they currently exist. If the APIs are renamed/stabilized later, the fixture should be updated to match.

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
