# Plan 09: Richer Abort Metadata

## Problem Statement

The current `TransitionAbort` type is minimal: `{reason, name?}`. The RFC specifies richer deletion info including `endTime`, `newName`, `error`, and `componentStack`. Only `'marker'` and `'suspense'` reasons are ever created; `'error'` and `'unknown'` are declared but dead.

---

## Current State

### TransitionAbort Type

**File**: `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js:49-52`

```flow
type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
};
```

### Construction Sites (exactly 2)

1. **Suspense deletion** (`ReactFiberCommitWork.js:5181-5184`): `{reason: 'suspense', name: current.memoizedProps.name || null}`
2. **Marker deletion** (`ReactFiberCommitWork.js:5222-5225`): `{reason: 'marker', name: current.memoizedProps.name}`

### Missing Construction Sites

- `reason: 'error'`: Should fire when error boundary catches inside TracingMarker. No integration with `ReactFiberThrow.js`.
- `reason: 'unknown'`: Should fire for SSR aborts. No construction site exists.

### endTime Issue

The `endTime` in deletion objects is the global paint time from `processTransitionCallbacks`, not a per-abort timestamp. All aborts in the same commit share the same `endTime`.

---

## Proposed Expanded Type

```flow
type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
  newName?: string | null,      // for marker renames
  endTime?: number,             // when abort was detected
  error?: mixed,                // for error boundary cases
  componentStack?: string | null, // for debugging
};
```

---

## Implementation Steps

### Step 1: Expand TransitionAbort type (all new fields optional)

### Step 2: Add `endTime: now()` to existing construction sites

At `ReactFiberCommitWork.js:5181` and `5222`, capture `now()` at abort time.

### Step 3: Update processTransitionCallbacks

Use per-abort `endTime` (with fallback to paint time). Add `'error'` and `'unknown'` cases to the switch statement (`ReactFiberTracingMarkerComponent.js:126-146`).

### Step 4: Update callback type signatures

In `ReactInternalTypes.js:329-356`, add `newName?`, `error?`, `componentStack?` to deletion array elements.

### Step 5: Add error abort integration

In the error boundary processing path (after `throwException` commits), walk up to find TracingMarker ancestors and create `'error'` aborts with the thrown error and component stack from `CapturedValue`.

**Key design decision**: Fire error aborts during passive unmount phase (not render phase) to match existing abort timing and avoid issues with render retries.

### Step 6: Add marker rename support

When TracingMarker name prop changes between renders, create abort with `newName` field. This also relates to fixing skipped test 12.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js` | Expand type; add error/unknown dispatch |
| `packages/react-reconciler/src/ReactFiberCommitWork.js` | Add `endTime` to construction sites; error abort integration |
| `packages/react-reconciler/src/ReactInternalTypes.js` | Update callback signatures |
| `packages/react-reconciler/src/ReactFiberThrow.js` | Add transition tracing error abort |
| `packages/react-reconciler/src/ReactFiberBeginWork.js` | Marker rename with `newName` |

---

## Implementation Order

1. **Phase 1**: Expand type + add `endTime` to existing sites (low risk)
2. **Phase 2**: Add `'error'`/`'unknown'` handling in processTransitionCallbacks (low risk)
3. **Phase 3**: Error boundary abort integration (medium complexity)
4. **Phase 4**: Marker rename `newName` support + unskip test 12
5. **Phase 5**: Wire up `onTransitionIncomplete` dispatch (depends on Plan 02)
