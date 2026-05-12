# RCP: Fragment Event Handler Props

There's a gap in composability with Fragment Ref events (`FragmentInstance#addEventListener`) and the common onX prop handler syntax. With our synthetic event system, composability is a bit unexpected in some cases.

```jsx
function Component() {
  return (
    <div onClick={parentDivHandler}>
      <Fragment ref={
        instance => {
          instance.addEventListener('click', fragmentHandler);
          return () => instance.removeEventListener('click', fragmentHandler);
        }
      }>
        <div onClick={childDivHandler}>
      </Fragment>
    </div>
  )
}
```

When clicking the `div`, the order will be:

- `fragmentHandler`: Native event listener. Fires during DOM-level bubbling before the event reaches React's root delegation point
- `childDivHandler`: Synthetic event. Bubbles as target
- `parentDivHandler`: Synthetic event. Bubbles as parent

This is unexpected for most users as the `<Fragment />` is designed as a psuedo parent/group element but doesn't adhere to event ordering. And there is a real composability miss here because you can't use Fragment events as boundaries.

For example, this doesn't work:

```jsx
function StopPropagationBoundary({children}) {
  return <Fragment ref={instance => instance.addEventListener('click', e => e.stopPropagation)}>{children}</Fragment>
}

function Component() {
  <StopPropagationBoundary>
    <div onClick={doSomething} />
  </StopPropagationBoundary>
}
```
This would be a useful utility, but instead it breaks the child's event handling completely by stopping propagation _before_ `doSomething` is reached.

## Proposal

Add `onX` syntheic event handler props to Fragment.

```jsx
<Fragment onClick={(e) => console.log('clicked', e.currentTarget)}>
  <button>One</button>
  <button>Two</button>
</Fragment>
```

Fragment handlers participate in React's synthetic event dispatch. They fire during the bubble phase, just like a parent `<div>` would. Capture variants fire before children, also like a `<div>`.

```jsx
// stopPropagation at the Fragment level works correctly
<Fragment onClick={(e) => {
  e.stopPropagation(); // prevents bubbling past the Fragment
}}>
  <div onClick={() => console.log('still fires')}>Click me</div>
</Fragment>
```

Defining a `ref` is not required. `<Fragment onClick={handler}>` works on its own. Though we may want to set the event's `currentTarget` to the `FragmentInstance`, so we would have to create the ref instance if a handler prop is present.

### Stacking with child handlers

Our first example would work as expected, refactored to use synthetic event handlers:

```jsx
function Component() {
  return (
    <div onClick={parentDivHandler}>
      <Fragment onClick={fragmentHandler}>
        <div onClick={childDivHandler}>
      </Fragment>
    </div>
  )
}
```

Now the order after clicking the child is:

- `childDivHandler`: Synthetic event. Bubbles as target
- `fragmentHandler`: Synthetic event. Bubbles as parent
- `parentDivHandler`: Synthetic event. Bubbles as parent


Nested Fragments stack the same way:

```jsx
<Fragment onClick={handlerC}>
  <Fragment onClick={handlerB}>
    <div onClick={handlerA} />
  </Fragment>
</Fragment>
// Bubble: handlerA → handlerB → handlerC
// Capture: handlerCCapture → handlerBCapture → handlerACapture
```

### `event.currentTarget`

When a Fragment's handler fires, `event.currentTarget` is the FragmentInstance. Note this is different to how we handle `currentTarget` on native Fragment events. Since we forward the native event handlers to all top-level host children, the children are the `currentTarget` and there is no Fragment layer to bubble through.

Conceptually `fragmentInstance.dispatchEvent()` should probably use itself as the currentTarget too. This would require some wrapping of the incoming event handler function.

### Enter/Leave and Focus Events

The common-ancestor logic in `accumulateEnterLeaveListenersForEvent` handles the "moving between Fragment children" case correctly without special handling:

- Mouse moves from child A to child B within the same Fragment: the Fragment is the common ancestor, so it sits on neither the `from` path nor the `to` path. Enter/leave handlers don't fire.
- Mouse enters from outside into child A: the common ancestor is above the Fragment, so the Fragment is on the `to` path and `onMouseEnter` fires.
- Mouse leaves from child B to outside: symmetric — `onMouseLeave` fires.

This matches wrapper div behavior without a DOM boundary.

## Implementation Design

We can implement this behind an independent feature flag to avoid blocking the release of Fragment Refs. If timing works out they can ship together but let's not add a new dependency this late.

### FragmentInstance Creation

The `Ref` effect flag is scheduled when event handler props are present (even without a ref), so that a `FragmentInstance` is created during commit. We use this to be the `currentTarget` for the event. We can also use the presence of a FragmentInstance as a sentinel to determine when to handle Fragment event props in `accumulateSinglePhaseListeners`.

Even though we'll create a FragmentInstance, we can read the handlers directly from `memoizedProps` to avoid dealing with updates.

### Commit Phase and FragmentInstance Lifecycle

The commit phase work is minimal since handlers are not stored on the FragmentInstance.

**Creation.** When a Fragment has event handler props (with or without a ref), the `Ref` effect flag is scheduled during `beginWork` or `completeWork`. During `commitAttachRef`, the existing Fragment case creates a `FragmentInstance` and assigns it to `fiber.stateNode`. No changes.

**Updates.** When event handler props change between renders, no commit work is needed. The fiber's `memoizedProps` is updated by the reconciler as part of the normal render cycle.

**Removal.** When a Fragment with event handlers unmounts, the existing ref detach path nulls out the `stateNode`. There are no stored handlers to tear down.

## Edge Cases

**Implicit fragments.** This only works with explicit `<Fragment>` syntax.

**Fragments with no host children.** A Fragment rendering only other Fragments or null has no host children for events to originate from. Its handlers simply never fire. No error, no warning.

**Portals.** If a Fragment contains a Portal, events from portal children bubble through the React tree (not the DOM tree). Fragment handlers receive events from portal descendants. This matches existing behavior for `<div>` parents.

**`currentTarget` is not a DOM element.** Code that expects `e.currentTarget.getBoundingClientRect()` or other DOM methods will fail. The FragmentInstance API is more limited.

**SSR.** Event handler props are ignored on the server, same as with host component event handlers.

**DevTools.** React DevTools already displays Fragment fibers. With the full props object as `pendingProps`, DevTools will show event handler props in the props panel.

## Alternatives Considered

Store event handlers on FragmentInstance. Instead of reading from `fiber.memoizedProps` at dispatch time, handlers could be stored on the FragmentInstance during commit. It requires an update mechanism to keep handlers in sync with prop changes, adding commit-phase complexity.

Use `Update` flag instead of `Ref` for FragmentInstance creation. Using the `Ref` flag for a case that doesn't expose a ref is unexpected. But we are creating the instance and that follows a consistent code path. Will have to look into the code paths to see if this would cause any issues or perf regressions.
