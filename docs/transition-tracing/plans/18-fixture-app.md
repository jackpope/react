# Plan 18: Transition Tracing Fixture App

## Problem Statement

There is no interactive test application for transition tracing. The feature can only be exercised through unit tests using `react-noop-renderer`. A fixture app would provide manual testing in a real DOM environment, visual feedback for transition lifecycle events, and a development aid for iterating on the API.

---

## Phase 0: Build Script

### Problem

`enableTransitionTracing` is `false` in `packages/shared/ReactFeatureFlags.js` (the default OSS flags file). Unlike `enableViewTransition` (which is `true` by default, letting the VT fixture work with a plain `build-for-vt-dev`), transition tracing code paths are dead-code eliminated during the rollup build. The fixture needs a build with the flag enabled.

### Approach

Add a `build-for-tt-dev` script to the root `package.json` that temporarily patches `ReactFeatureFlags.js` to enable the flag, runs the build, then restores the file via `git checkout`. This avoids any changes to the build system itself.

### Implementation

#### 1. Add script to root `package.json`

Add next to the existing `build-for-vt-dev`:

```json
"build-for-tt-dev": "sed -i '' 's/enableTransitionTracing: boolean = false/enableTransitionTracing: boolean = true/' packages/shared/ReactFeatureFlags.js && cross-env RELEASE_CHANNEL=experimental node ./scripts/rollup/build.js react/index,react/jsx,react-dom/index,react-dom/client,scheduler --type=NODE_DEV; git checkout packages/shared/ReactFeatureFlags.js; mv ./build/node_modules ./build/oss-experimental"
```

Key details:
- **`sed -i ''`**: In-place edit (macOS syntax; Linux would be `sed -i`). Flips the flag from `false` to `true` in the source before rollup resolves it
- **`;` before `git checkout`**: Uses `;` (not `&&`) so the file is restored even if the build fails
- **`;` before `mv`**: The `mv` runs regardless of whether `git checkout` succeeds (it always should)
- **Same package list as `build-for-vt-dev`**: Builds `react`, `react-dom`, and `scheduler` — the minimum needed for a DOM fixture
- **`RELEASE_CHANNEL=experimental`**: Ensures `__EXPERIMENTAL__` is true so `unstable_` APIs are exported

#### 2. Verify the build

```bash
yarn build-for-tt-dev

# Confirm the flag file was restored (no git changes)
git diff packages/shared/ReactFeatureFlags.js
# (should be empty)

# Confirm TracingMarker is in the build output
grep -l "TracingMarker" build/oss-experimental/react-dom/cjs/react-dom.development.js
# (should match)

# Confirm the flag was inlined as true (transition tracing code paths are live)
grep "enableTransitionTracing" build/oss-experimental/react-dom/cjs/react-dom.development.js
# (should NOT match — the flag is inlined and the identifier is gone)
```

#### 3. Fixture workflow

```bash
# From repo root:
yarn build-for-tt-dev

# Then in the fixture directory:
cd fixtures/transition-tracing
yarn install
yarn dev
# The predev script copies build/oss-experimental/* into node_modules
```

### Why this approach

- **No build system changes**: Nothing in `scripts/rollup/` is modified
- **No new fork files**: No new `ReactFeatureFlags.*.js` variants
- **Self-restoring**: `git checkout` guarantees the source file is never left dirty, even on build failure
- **Follows precedent**: Same shape as `build-for-vt-dev`, just with a sed prefix and git checkout suffix

### Limitation

The `sed -i ''` syntax is macOS-specific. On Linux it would be `sed -i` (no empty string argument). This is acceptable since fixture development is a local workflow, but a cross-platform alternative would be to use a small node script:

```bash
"build-for-tt-dev": "node -e \"const fs=require('fs');const f='packages/shared/ReactFeatureFlags.js';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('enableTransitionTracing: boolean = false','enableTransitionTracing: boolean = true'))\" && cross-env RELEASE_CHANNEL=experimental node ./scripts/rollup/build.js react/index,react/jsx,react-dom/index,react-dom/client,scheduler --type=NODE_DEV; git checkout packages/shared/ReactFeatureFlags.js; mv ./build/node_modules ./build/oss-experimental"
```

---

## Structure

```
fixtures/transition-tracing/
  package.json
  vite.config.js
  index.html              # Vite entry HTML (project root, not public/)
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
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0"
  },
  "scripts": {
    "predev": "cp -r ../../build/oss-experimental/* ./node_modules/ && rm -rf node_modules/.cache;",
    "dev": "vite",
    "prebuild": "cp -r ../../build/oss-experimental/* ./node_modules/ && rm -rf node_modules/.cache;",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

## Vite Configuration

```js
// vite.config.js
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

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

### Runtime Check

`index.js` checks if `React.unstable_TracingMarker` is defined and shows a "feature not enabled -- run `yarn build-for-tt-dev` first" message if not.

### `unstable_` Prefix

The fixture uses `unstable_` prefix APIs as they currently exist. Update if APIs are stabilized later.

---

## Implementation Phases

### Phase 0: Build Script
- Add `build-for-tt-dev` script to root `package.json`
- Verify build produces working output with transition tracing enabled
- Verify flag file is restored after build

### Phase 1: Basic Setup
- Package.json, vite.config.js, index.html (with `<script type="module" src="/src/index.js">`), entry point
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
