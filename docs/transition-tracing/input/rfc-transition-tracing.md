# RFC: React Transition Tracing API

## Overview

We want to create a new React Interaction Tracing API. This will allow developers to use the Profiler API and DevTools Profiler/Timeline to:

- Watch for performance regressions for specific transitions
- Understand why a React transition is slow so they can make performance improvements

## Proposal

A transition starts from an event (e.g. a user action that schedules an update) and ends when the updated state is committed (e.g. showing content on a page), possibly passing through multiple intermediate commits. You can navigate from an event to multiple markers (e.g. clicking the Facebook homepage loads both Stories and Newsfeed). Because updates with the same lanes can be batched together, an update can also start from multiple places (e.g. clicking Home then Marketplace — the updates batch together and Marketplace is shown).

### API Components

#### 1. `startTransition` with Transition Name

Add an optional config object with a `transitionName` field to `startTransition`. Since transitions take a long time to complete, we recommend wrapping them with `startTransition` regardless, making this a natural place to initiate tracing.

#### 2. `<TracingMarker name="...">`

Defines the subtree to be tracked. Decoupled from Suspense because Suspense boundaries are fragile to refactoring. Can be used in two ways:

- **Point marker:** Indicates you've reached a point in the tree (e.g. the top Nav has rendered)
- **Subtree marker:** Indicates when a subtree has finished loading (e.g. Marketplace is complete)

#### 3. Suspense `name` Prop

An optional `name` field on Suspense provides more detailed data about when boundaries resolve. This does **not** define the scope of a transition — it only provides extra data for transition callbacks and tooling like DevTools.

#### 4. Root Transition Callbacks

Added to `createRoot` options:

- **`onTransitionStart(transitionName, startTime)`** — Called when a transition is first initiated. `startTime` is the event time.

- **`onTransitionProgress(transitionName, startTime, currentTime, pending)`** — Same as `onMarkerProgress` but tracked from the root.

- **`onMarkerProgress(transitionName, marker, startTime, currentTime, pending)`** — Called when:
  - A TracingMarker's child Suspense boundary first commits in a fallback state
  - A TracingMarker's child Suspense boundary resolves

  The `pending` array contains the names of Suspense boundaries not yet resolved. It's an array of objects to support future metadata like bounding rect.

- **`onMarkerIncomplete(transitionName, marker, startTime, deletions)`** — Called when a tracing marker's transition is incomplete (something unexpected happened). Deletion types:
  - `{type: 'marker', name, endTime}` — TracingMarker was deleted
  - `{type: 'marker', name, newName, endTime}` — TracingMarker's name changed
  - `{type: 'suspense', name: string | null, endTime}` — Child Suspense boundary was deleted
  - `{type: 'error', boundary, error, componentStack, endTime}` — An error was thrown
  - `{type: 'unknown', endTime}` — Unknown cause (e.g. SSR abort)

  Once called, the transition can no longer complete (`onMarkerComplete` will not fire). Subsequent `onMarkerProgress` callbacks will still trigger. Incomplete calls propagate up to parent markers and `onTransitionIncomplete`.

- **`onTransitionIncomplete(transitionName, startTime, currentTime, deletions)`** — Same as `onMarkerIncomplete` but tracked from the root.

- **`onMarkerComplete(transitionName, marker, startTime, endTime)`** — Called when all Suspense boundaries inside the TracingMarker resolve (or if there are none). `endTime` is the paint time.

- **`onTransitionComplete(transitionName, startTime, endTime)`** — Same as `onMarkerComplete` but tracked from the root.

### Future Goals

- **Non-Suspense loading states:** Most use cases are covered by Suspense. For those that aren't, this can initially be implemented in userland with Suspense and thrown Promises. A first-class API is planned for later.
- **Hydration:** V1 only traces from server start to HTML load. Hydration support is planned.
- **Suspense ignore list on `startTransition`:** For edge cases where callbacks alone aren't sufficient to properly ignore a subtree.
- **Non-transition updates:** Since we expect all suspending updates to be wrapped in a transition, tracing non-transition updates can technically be built in userland. A first-class API may follow.

## Usage Examples

### Sample App

```jsx
const container = document.createElement('div');
const root = React.createRoot(container);

function App() {
  const user = getViewingUser();
  const [pageName, setPageName] = useState('homefeed');
  const onNavigate = (pageName) => {
    startTransition(() => setPageName(pageName));
  };
  return (
    <>
      <NavBar onNavigate={onNavigate} />
      <Page name={pageName} id={user.id} />
    </>
  );
}

function NavBar({onNavigate}) {
  return (
    <>
      <button onClick={() => onNavigate('homefeed')}>Homefeed</button>
      <button onClick={() => onNavigate('profile')}>Profile</button>
    </>
  );
}

function Page({pageName}) {
  switch (pageName) {
    case 'profile':
      return <Profile />;
    case 'homefeed':
      return <Homefeed />;
  }
}

function Profile({id}) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ProfileHeader id={id} />
      <div>Photos</div>
      <Suspense fallback={<LoadingFeed />}>
        <PhotoFeed />
      </Suspense>
      <Suspense fallback={<LoadingFeed />}>
        <ProfileFeed />
      </Suspense>
    </Suspense>
  );
}

function Homefeed({id}) {
  // ...
}
```

### Tracing a Navigation Interaction

#### Step 1: Name the Transition

Add a transition name to `startTransition` to enable tracing:

```jsx
function App() {
  const user = getViewingUser();
  const [pageName, setPageName] = useState('homefeed');
  const onNavigate = (pageName) => {
    startTransition(() => setPageName(pageName), pageName);
  };
  return (
    <>
      <NavBar onNavigate={onNavigate} />
      <Page name={pageName} id={user.id} />
    </>
  );
}
```

#### Step 2: Mark Tracked Areas

Add TracingMarkers around the areas you want to track. Here we track the entire Profile page and its sub-sections:

```jsx
function Profile({id}) {
  return (
    <TracingMarker name="profile">
      <Suspense fallback={<LoadingSpinner />}>
        <ProfileHeader id={id} />
        <TracingMarker name="profile:photo-feed">
          <div>Photos</div>
          <Suspense fallback={<LoadingFeed />}>
            <PhotoFeed />
          </Suspense>
        </TracingMarker>
        <TracingMarker name="profile:profile-feed">
          <div>Profile Feed</div>
          <Suspense fallback={<LoadingFeed />}>
            <ProfileFeed />
          </Suspense>
        </TracingMarker>
      </Suspense>
    </TracingMarker>
  );
}
```

> **Note:** Naming conventions are app-specific. This example uses `parentMarker:childMarker` syntax to link markers during post-processing.

#### Step 3: Add Callback Functions

For the basic case, you only need `onMarkerComplete` and `onMarkerIncomplete`:

```jsx
function onTransitionStart(name, startTime) {
  // Log the start so we can detect transitions that never complete
  logInteraction({name, startTime, status: 'start'});
}

function onMarkerIncomplete(name, marker, startTime, endTime, deletions) {
  let status = 'complete';
  for (const deletion of deletions) {
    if (deletion.type === 'marker' && deletion.name === marker) {
      status = 'cancel';
      break;
    } else if (deletion.type === 'error') {
      status = 'error';
    }
  }

  logInteraction({name, marker, startTime, endTime, status});
}

function onMarkerComplete(name, marker, startTime, endTime) {
  // If the marker doesn't match the transition name, the transition
  // was batched with another and this one was superseded.
  const isCanceled = !marker.includes(name);
  logInteraction({
    name,
    marker: isCanceled ? name : marker,
    startTime,
    endTime,
    status: isCanceled ? 'cancel' : 'complete',
  });
}

const root = React.createRoot(container, {
  onTransitionStart,
  onMarkerIncomplete,
  onMarkerComplete,
});
```

### Scenarios: Navigating to Profile

**Neither feed suspends:**
`onMarkerComplete` is called for all three markers at the same time.

**Photo feed doesn't suspend, Profile feed suspends then resolves:**
1. `onMarkerComplete` fires for `profile:photo-feed`.
2. When Profile feed resolves, `onMarkerComplete` fires for `profile:profile-feed` and `profile` (all children resolved).

**Profile feed errors, Photo feed suspends:**
1. `onMarkerIncomplete` fires for `profile:profile-feed` with an error deletion.
2. When Photo feed resolves, `onMarkerComplete` fires for `profile:photo-feed`. `onMarkerIncomplete` fires for `profile` because a child errored.

**Child Suspense boundary removed before completion:**
1. `onMarkerIncomplete` fires for `profile:profile-feed` (inferred as complete since we only special-case marker deletions and errors).
2. When Photo feed resolves, `onMarkerComplete` fires for `profile:photo-feed`. `onMarkerIncomplete` fires for `profile`.

**Photo feed marker removed or renamed:**
1. `profile:profile-feed` completes normally.
2. `onMarkerIncomplete` fires for `profile:photo-feed` with a canceled status.
3. `onMarkerIncomplete` fires for `profile`, but since `profile` itself isn't in the deletions array, it logs as complete.

**Navigate to Homefeed before Profile completes:**
All markers with suspended boundaries call `onMarkerIncomplete` with canceled status (markers deleted before completing).

**Navigate to Homefeed immediately (Profile never renders):**
Homefeed markers call `onMarkerComplete` but with the wrong transition name (e.g. marker `homefeed` with transition `profile`), detected and marked as canceled.

**Navigate to a page without markers (Profile never renders):**
In post-processing, check that all transitions with `status: start` have a corresponding complete/incomplete status. Those without are marked as incomplete.

## Complex Case: Ignoring Subtrees

Consider a Profile Photo Modal that should not influence the profile interaction, even though it's a child of the profile TracingMarker:

#### Step 1: Name the Transition and Mark Tracked Areas

```jsx
function Profile({id}) {
  const [showProfilePhotoModal, setShowProfilePhotoModal] = useState(false);
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ProfileHeader id={id} />
      <button
        onClick={() => {
          startTransition(() => {
            setShowProfilePhotoModal(!showProfilePhotoModal);
          }, 'profile-photo-modal');
        }}>
        Show Photo Modal
      </button>
      {showProfilePhotoModal
        ? ReactDOM.createPortal(
            <TracingMarker name="profile-photo-modal">
              <Suspense
                name="profile-photo-modal"
                fallback={<LoadingModal />}>
                <ProfilePhotoModal />
              </Suspense>
            </TracingMarker>,
            portalContainer,
          )
        : null}
      <div>Photos</div>
      <Suspense fallback={<LoadingFeed />}>
        <PhotoFeed />
      </Suspense>
      <Suspense fallback={<LoadingFeed />}>
        <ProfileFeed />
      </Suspense>
    </Suspense>
  );
}
```

Give the Suspense boundary the same name as the transition name (`profile-photo-modal`) to tie them together for processing.

#### Step 2: Add Callback Functions

Use `onMarkerProgress` instead of `onMarkerComplete` for more fine-grained control. `onMarkerProgress` fires every time a Suspense boundary resolves, allowing you to check whether the only remaining pending boundaries belong to a different interaction:

```jsx
const completedTransitions = new Set();

function onTransitionStart(name, startTime) {
  logInteraction({name, startTime, status: 'start'});
}

function onMarkerProgress(name, marker, startTime, currentTime, pending) {
  // Check if the only pending boundaries belong to a different interaction
  const transitionFinished = !pending.some(
    (boundary) => boundary.name === null || boundary.name === name,
  );

  if (transitionFinished) {
    completedTransitions.add(name);
    const isCanceled = !marker.split(':').includes(name);
    logInteraction({
      name,
      marker,
      startTime,
      endTime: currentTime,
      status: isCanceled ? 'cancel' : 'complete',
    });
  }
}

function onMarkerIncomplete(name, marker, startTime, endTime, deletions) {
  // Ignore incomplete signals from unrelated subtrees
  if (completedTransitions.has(name) || !marker.split(':').includes(name)) {
    return;
  }

  let status = 'complete';
  for (const deletion of deletions) {
    if (deletion.type === 'marker') {
      status = 'cancel';
      break;
    } else if (deletion.type === 'error') {
      status = 'error';
    }
  }

  logInteraction({name, marker, startTime, endTime, status});
}

const root = React.createRoot(container, {
  onMarkerComplete,
  onMarkerIncomplete,
  onMarkerProgress,
});
```

### Scenarios: Profile with Modal

**Profile completes, modal never renders:**
`onMarkerProgress` fires with complete status for all three profile markers. The modal marker is never rendered.

**Profile completes, then modal is clicked:**
Profile markers complete first. Then `onMarkerProgress` fires with complete status for `profile-photo-modal`.

**Profile rendering, modal clicked during, Profile feed completes first:**
1. `profile:photo-feed` completes.
2. Modal starts rendering.
3. `profile:profile-feed` completes. `onMarkerProgress` fires for `profile` — the only pending boundary is `profile-photo-modal` (a different interaction), so `profile` completes.
4. Modal resolves, `onMarkerProgress` fires with complete for `profile-photo-modal`.

**Profile rendering, modal clicked during, modal completes first:**
1. `profile:photo-feed` completes.
2. Modal starts rendering.
3. Modal completes. `onMarkerProgress` fires for `profile-photo-modal`. Profile markers still have pending unnamed boundaries, so they don't complete.
4. `profile:profile-feed` completes. `onMarkerProgress` fires with complete for `profile:profile-feed` and `profile`.

**Modal's child TracingMarker gets removed:**
`onMarkerIncomplete` fires for the modal marker. Profile page markers complete normally.

## FAQ

**How do we implement a timeout?**
Add a timeout in `onTransitionStart` and mark the transition as aborted if it doesn't complete within the time limit.

**How do we ignore a Suspense boundary?**
Use `onTransitionProgress` with the Suspense boundary `name` prop. If the only pending boundaries are ones you want to ignore, the transition is complete.

**Why does every callback take `startTime`?**
Each transition's `startTime` is likely unique, so it can serve as an identifier. Comparing `startTime` and `endTime` also reveals batched transitions (different start times, same end time).

**How do we know which batched transition actually completed?**
Check whether the transition name matches the tracing marker name. If they don't match, the event is likely an abort. The transition with the most recent `startTime` is typically the one that completed.

**Why don't we automatically mark earlier batched transitions as aborted?**
Different apps interpret batched transitions differently. We provide all the information so developers can make the correct decision for their use case.
