# RCP: Fragment Event Handler Props

## Problem

Fragment refs let you get a handle on a group of DOM elements without adding a wrapper div. But there's an awkward gap: once you have that handle, the only way to listen for events is `fragmentInstance.addEventListener()`, which adds native DOM listeners. That creates a fundamental mismatch with React's synthetic event system.

The immediate, concrete problem: native `stopPropagation()` kills React's delegated event dispatch. If a Fragment's native listener calls `stopPropagation()`, the event never reaches React's root-level listener, so _all_ synthetic handlers — including the Fragment's own children — stop working.

```jsx
function Toolbar({onAction}) {
  const ref = useRef(null);

  useEffect(() => {
    // Native listener on the Fragment
    ref.current.addEventListener('click', (e) => {
      logAnalytics('toolbar-click');
      e.stopPropagation(); // Prevent clicks from bubbling past the toolbar
    });
  });

  return (
    <Fragment ref={ref}>
      {/* This onClick will NEVER fire — stopPropagation blocked it
          from reaching React's root-level delegated listener */}
      <button onClick={onAction}>Do thing</button>
    </Fragment>
  );
}
```

This is surprising. On a `<div>`, calling `stopPropagation` in a native listener doesn't block the div's own children's React handlers — because the event already passed through React's delegation point. But Fragment listeners sit _on_ the child DOM nodes, so stopPropagation blocks everything downstream.

## Beyond stopPropagation

The stopPropagation bug is the sharp edge, but the broader issue is that there's no way to declaratively handle events at the Fragment level. This matters for several patterns:

**Layout-sensitive grouping.** The most common workaround for "handle events on a group of children" is to wrap in a `<div>`. But that changes the DOM structure, which breaks flexbox/grid layout, table structure, and CSS selectors that depend on parent-child relationships.

```jsx
// Breaks grid layout — the div becomes a single grid item
// instead of each child being its own grid item
<div className="grid">
  <div onClick={handleGroupClick}> {/* extra wrapper */}
    <GridItem />
    <GridItem />
    <GridItem />
  </div>
</div>

// With Fragment event handlers, layout is preserved
<div className="grid">
  <Fragment onClick={handleGroupClick}>
    <GridItem />
    <GridItem />
    <GridItem />
  </Fragment>
</div>
```

**Keyboard navigation groups.** Patterns like toolbars and menubars need keyboard event handling at the group level (for arrow key navigation between items). Today this requires a wrapper element, which adds noise to the accessibility tree.

**Consistent mental model.** Fragments already accept `ref` and `key`. If you can get a ref to a Fragment, it's natural to also put `onClick` on it — the same way you would on a `<div>`. The gap between "I can get a ref" and "I can't put event handlers on it" is confusing.

**Composition.** `cloneElement` can inject handlers into each child, but it's fragile, doesn't compose well, and doesn't work with children that don't forward event handler props.

## Proposal

Let Fragments accept synthetic event handler props — `onClick`, `onMouseDown`, `onKeyDown`, etc. — the same ones you'd put on a DOM element.

```jsx
<Fragment onClick={(e) => console.log('clicked', e.currentTarget)}>
  <button>One</button>
  <button>Two</button>
</Fragment>
```

Fragment handlers participate in React's synthetic event dispatch. They fire during the bubble phase (after children), just like a parent `<div>` would. Capture variants (`onClickCapture`) fire before children, also like a `<div>`.

```jsx
// stopPropagation at the Fragment level works correctly
<Fragment onClick={(e) => {
  e.stopPropagation(); // prevents bubbling past the Fragment
}}>
  <button onClick={() => console.log('still fires')}>Click me</button>
</Fragment>
```

A ref is not required — `<Fragment onClick={handler}>` works on its own. Under the hood, React creates a FragmentInstance when event handler props are present (same mechanism as Fragment refs).

### `event.currentTarget`

When a Fragment's handler fires, `event.currentTarget` is the FragmentInstance, not a DOM element. This is a departure from the usual DOM convention, but it's consistent with how Fragment refs already work — if you have a ref to a Fragment, you get a FragmentInstance, not a DOM node.

### Coexistence with addEventListener

Both `fragmentInstance.addEventListener()` and declarative `on*` props work independently. Native listeners fire before synthetic ones, same as on a `<div>`. No warnings for using both.

## Alternatives Considered

**Fix addEventListener to use synthetic events.** We could make `fragmentInstance.addEventListener` dispatch through React's synthetic system instead of adding native listeners. This would fix the stopPropagation problem, but `addEventListener` is a well-known DOM API — people expect it to add native listeners. Changing that semantic would be more surprising than the original bug.

**New wrapper component (e.g. `<Group>`).**  Instead of extending Fragment, create a new component specifically for "group with events." But Fragment already has grouping semantics and refs. Adding another component for the same concept but with events would be confusing — which one do you reach for?

**Do nothing — just use a wrapper div.** This is the current workaround and it's fine for many cases. But it doesn't work when the wrapper div breaks layout, and the stopPropagation problem with addEventListener is a real bug that catches people.

## Edge Cases

**Implicit fragments.** A component returning an array (`return [<A />, <B />]`) creates an implicit Fragment with no element, so there's no place to put event handler props. This only works with explicit `<Fragment>` syntax.

**Portals.** If a Fragment contains a Portal, events from portal children don't bubble through the Fragment in the DOM tree. React's synthetic event system already handles this correctly for regular components (synthetic bubbling follows the React tree, not the DOM tree), so Fragment handlers will receive events from portal children — matching the existing behavior for `<div>` parents.

**Nested Fragments.** `<Fragment onClick={outer}><Fragment onClick={inner}>...</Fragment></Fragment>` — inner fires first during bubble, outer fires second. This is correct and matches what would happen with nested divs, though it's novel since there are no actual DOM boundaries between them.

**`currentTarget` is not a DOM element.** Code that expects `e.currentTarget.getBoundingClientRect()` or other DOM methods will fail. The FragmentInstance API is more limited — it provides methods for managing the group of children, not DOM layout queries. This is the same situation as Fragment refs today.

## Feature Flag

`enableFragmentEventHandlers`, independent of `enableFragmentRefs`. The plumbing involves passing the full props object through Fragment fiber creation (today only `children` is passed) and adding a Fragment branch to the synthetic event dispatch path.
