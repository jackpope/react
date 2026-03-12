# Hero Tracing API

The Hero Tracing API is Facebook's solution to interaction tracing. It measures the duration from the moment a user performs an interaction (e.g. initial load, click, navigation) to when the results are shown on the screen.

## How It Works

1. When a user performs a tracked interaction, the resulting update triggers a mount/update and starts the interaction via `InteractionTracing.startInteraction` or `InteractionTracing.trace`. These functions generate an interaction UUID used to track the interaction.
2. The generated UUID is passed to a `<HeroInteraction>` component, which defines the subtree being tracked for that interaction.
3. `<HeroInteraction>` creates an internal React Context that uses ref counting to track all loading states resulting from the interaction. Once all states have loaded (including cascading loading states from waterfalls), the interaction finishes and is logged as complete.

## API Reference

### `InteractionTracing.startInteraction(metadata, trackedFn): interactionID`

Marks the start of an interaction.

- **`metadata`**: `{interactionID?: string, ...}` — Optional interaction ID. If omitted, a random one is generated.
- **`trackedFn`**: `Function` — Allows developers to add their own metadata about the interaction.

### `<HeroInteraction>`

Defines the area of the React tree that will be tracked for an interaction. Creates an internal React Context that uses ref counting to track all loading states in its subtree and logs the interaction when it finishes.

**Props:**

- **`interactionDesc`**: `string?` — A description of the interaction being tracked.
- **`interactionUUID`**: `string` — The interaction ID of the current interaction. When this changes, any new loading states are tracked as part of the new interaction. If the previous interaction is still ongoing, it will be aborted.
- **`pageletName`**: `string?` — For nested `<HeroInteraction>` components, provides a different name for the child.

> **Note:** If nested `<HeroInteraction>` components share the same `interactionUUID` and are nearest ancestors, the child acts as a `<HeroPagelet>`.

### `<HeroPagelet>`

Marks subsections of the page for breaking down interaction performance. Useful for identifying how quickly each section loads and where regressions occur. A Pagelet is a Suspense component, ensuring it doesn't itself suspend into a fallback state.

**Props:**

- **`fallback`**: `Component` — Fallback component if something inside the pagelet suspends.

### `<HeroHoldTrigger>`

Simulates a loading state for cases where Suspense isn't used. Lets `<HeroInteraction>` know that a loading state is active.

**Props:**

- **`hold`**: `boolean` — Indicates whether a loading state is active. Unmounting `<HeroHoldTrigger>` achieves the same effect as setting `hold` to `false`.

### `<HeroInteractionContextPassthrough>`

Wraps subtrees that aren't relevant to the parent interaction and should be ignored. `<HeroInteraction>` will skip subtrees wrapped with this component.
