# Plan 13: Marker Name Change Fix

## Problem Statement

Test 12 is skipped (`it.skip`): "warn and calls marker incomplete if name changes before transition completes." The `TransitionAbort` type lacks a `newName` field. The begin work phase only emits a console warning for name changes but doesn't trigger `onMarkerIncomplete` or create an abort.

---

## Current State

### The Skipped Test (Test 12)

**File**: `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js:1327-1438`

The test:
1. Starts `'transition one'` with `<TracingMarker name="marker one">` wrapping suspended content
2. Changes the marker name to `"marker two"` while Suspense is still pending
3. **Expects `onMarkerIncomplete` to fire** with deletion object:
   ```
   {endTime: 3000, name: marker one, newName: marker two, type: marker}
   ```
4. After resolving the content, expects the transition to still complete

The critical expectation: `newName: marker two` in the abort object. This field does not exist.

### Begin Work: Only a Console Warning

**File**: `packages/react-reconciler/src/ReactFiberBeginWork.js:1312-1320`

On update (the `else` branch of `updateTracingMarkerComponent`):

```js
if (__DEV__) {
  if (current.memoizedProps.name !== nextProps.name) {
    console.error(
      'Changing the name of a tracing marker after mount is not supported. ' +
        'To remount the tracing marker, pass it a new key.',
    );
  }
}
```

**Missing**: No `TransitionAbort` creation, no call to any abort/incomplete function, no `Passive` flag set. The TODO at line 1291 confirms this is unfinished: `// TODO: (luna) Only update the tracing marker if it's newly rendered or it's name changed.`

### TransitionAbort Type

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:49-52`

```flow
export type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
};
```

Missing: `newName` field. Test 12 expects `newName` in the deletion object.

### processTransitionCallbacks Dispatch

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:126-131`

The `'marker'` case in the `onMarkerIncomplete` dispatch only creates `{type: 'marker', name: abort.name, endTime}`. No `newName` field.

### Console Warning Works (Test 18)

Test 18 (`packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js:2181`) passes because it only tests:
- The console error fires
- `onMarkerComplete` is NOT called for the renamed marker
- A new key remounts correctly

It does NOT test `onMarkerIncomplete` with `newName`, which is what Test 12 verifies.

---

## Implementation Steps

### Step 1: Add `newName` to TransitionAbort type

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:49-52`

```flow
export type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
  newName?: string | null,  // NEW: for marker renames
};
```

### Step 2: Handle name changes in updateTracingMarkerComponent

**File**: `packages/react-reconciler/src/ReactFiberBeginWork.js:1312-1320`

After the console warning, add abort logic:

```js
if (current.memoizedProps.name !== nextProps.name) {
  if (__DEV__) {
    console.error(
      'Changing the name of a tracing marker after mount is not supported. ' +
        'To remount the tracing marker, pass it a new key.',
    );
  }

  // Treat name change as marker incomplete
  const markerInstance: TracingMarkerInstance = workInProgress.stateNode;
  if (markerInstance !== null && markerInstance.transitions !== null) {
    const abort: TransitionAbort = {
      reason: 'marker',
      name: current.memoizedProps.name,
      newName: nextProps.name,
    };
    if (markerInstance.aborts === null) {
      markerInstance.aborts = [abort];
    } else {
      markerInstance.aborts.push(abort);
    }

    // Fire onMarkerIncomplete for each transition
    addMarkerIncompleteCallbackToPendingTransition(
      current.memoizedProps.name,
      markerInstance.transitions,
      markerInstance.aborts,
    );

    // Clear marker state -- it's now incomplete
    markerInstance.transitions = null;
    markerInstance.pendingBoundaries = null;

    // Schedule passive effect for commit-phase processing
    workInProgress.flags |= Passive;
  }
}
```

### Step 3: Update processTransitionCallbacks to include newName

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:126-131`

In the `'marker'` case of the `onMarkerIncomplete` dispatch:

```js
case 'marker':
  filteredAborts.push({
    type: 'marker',
    name: abort.name,
    newName: abort.newName || null,  // NEW
    endTime,
  });
  break;
```

### Step 4: Update callback type signature

**File**: `packages/react-reconciler/src/ReactInternalTypes.js:347-357`

Add `newName` to the deletion object type in `onMarkerIncomplete`:

```flow
onMarkerIncomplete?: (
  transitionName: string,
  marker: string,
  startTime: number,
  deletions: Array<{
    type: string,
    name: string | null,
    newName?: string | null,  // NEW
    endTime: number,
  }>,
) => void,
```

### Step 5: Unskip Test 12

**File**: `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js:1327`

Change `it.skip(` to `it(`.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Add `newName` to `TransitionAbort` type; include in `processTransitionCallbacks` |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Handle name change with abort logic in `updateTracingMarkerComponent` |
| `packages/react-reconciler/src/ReactInternalTypes.js` | Add `newName` to deletion object type |
| `packages/react-reconciler/src/__tests__/ReactTransitionTracing-test.js` | Unskip test 12 |

---

## Relationship to Plan 09

Plan 09 (Richer Abort Metadata) mentions marker rename support in Step 6. This plan is more focused -- it addresses only the marker name change issue and unskipping test 12. Plan 09's broader `endTime` and `error` field additions can build on this work.

---

## Test Cases

1. **Unskipped test 12**: Marker name changes during pending transition -> `onMarkerIncomplete` fires with `newName`
2. **Name change with no pending boundaries**: Marker name changes immediately after mount (no Suspense) -> verify behavior
3. **Name change after completion**: Marker completes, then name changes -> verify no spurious callbacks
4. **Multiple name changes**: Marker name changes twice while pending -> verify correct `newName` in each abort

---

## Complexity Assessment

**Estimated effort**: Low-Medium. The core change is adding the abort creation logic to the begin work update path. The type changes and dispatch updates are mechanical. The main risk is ensuring the `Passive` flag and commit-phase processing interact correctly.
