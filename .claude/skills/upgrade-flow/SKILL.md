---
name: upgrade-flow
description: Use when upgrading Flow to the next version - checks for next release, installs it, researches breaking changes, runs flow type checking, and fixes all errors.
---

# Upgrade Flow

Arguments:
- $ARGUMENTS: Target version (e.g. `0.310.0`). If omitted, automatically detects the next minor version.

## Instructions

Follow these phases in order. Stop and report if any phase fails unrecoverably.

### Phase 1: Determine Target Version

1. Read current version: `grep 'flow-bin' package.json`
2. If `$ARGUMENTS` was provided, use that as target. Otherwise, compute next minor version (e.g. `0.309.0` → `0.310.0`).
3. Verify the target release exists: `gh api repos/facebook/flow/releases/tags/v{TARGET}`
4. If the release doesn't exist, report that no newer version is available and stop.

### Phase 2: Research Breaking Changes

Spawn a background research agent to fetch release notes for all versions between current and target (inclusive of target, exclusive of current):

```
gh api repos/facebook/flow/releases --paginate --jq '.[].tag_name'
```

Then for each release in range, fetch body with:
```
gh api repos/facebook/flow/releases/tags/v{VERSION} --jq '.body'
```

Focus the summary on:
- Removed or renamed types
- New error codes or error code consolidation
- Changes to suppression syntax (`$FlowFixMe`)
- Stricter type checking behavior
- Config option changes
- React-specific type changes

### Phase 3: Install New Version

1. Update `package.json`: change `flow-bin` version to `^{TARGET}`
2. Run `yarn install`
3. Verify: `node_modules/.bin/flow version` should show target version

### Phase 4: Run Flow and Assess Errors

1. Run `yarn flow dom-fb` to get initial error state
2. Parse errors using JSON output: `node_modules/.bin/flow status --json`
3. Categorize errors by code and file, report summary to user

### Phase 5: Fix Errors

Apply fixes in this priority order:

#### 5a. Fix Removed/Renamed Types
Check for `cannot-resolve-name` errors. Common renames across Flow versions:
- `React$ElementProps` → `React$ElementConfig`
- `React$Context` → `React.Context`
- `React$RefSetter` → `React.RefSetter`
- `React$ElementRef` → `React.ElementRef`

Fix in: `scripts/flow/environment.js`, `packages/react/index.js`, `packages/react/index.development.js`

Verify what types exist in the new Flow version:
```
find /private/tmp/flow -name "react.js" -path "*/flowlib*" | head -1 | xargs grep 'declare.*React\$'
```

#### 5b. Fix Variance Errors
For `incompatible-variance` in `flow-typed/environments/`:
- Make properties read-only with `+` prefix
- Make indexers read-only with `+[...]`

#### 5c. Update Stale $FlowFixMe Codes
When Flow consolidates error codes (e.g. `incompatible-return` → `incompatible-type`), existing `$FlowFixMe[old-code]` suppressions stop working. Find these by checking errors where the previous line has a `$FlowFixMe` with a different code than the current error.

#### 5d. Add Missing $FlowFixMe Codes
For bare `$FlowFixMe` comments (without `[code]`), pair each with the actual error on the next line and add the code.

#### 5e. Add New Suppressions
For new error categories that are false positives in this codebase:
- `constant-condition` — feature flags like `supportsMutation`, `isPrimaryRenderer`, `enableProfiling`
- `invalid-compare` — defensive null checks where Flow proves non-null
- `missing-this-annot` — callback functions using `this` via `.apply()`

Add `// $FlowFixMe[error-code]` above the error line, matching indentation.

#### 5f. Handle Multi-Code Lines
When a single line has multiple different error codes, stack multiple `$FlowFixMe` comments:
```javascript
// $FlowFixMe[incompatible-type]
// $FlowFixMe[invalid-computed-prop]
return bind.apply(console[methodName], newArgs);
```

### Phase 6: Iterate Until Clean

After each fix pass, re-run `yarn flow dom-fb`. Repeat Phase 5 until zero errors.

**Watch for oscillation**: If the fix script keeps changing the same `$FlowFixMe` code back and forth, it means the line has multiple errors needing different codes — use multi-code stacking (5f).

### Phase 7: Verify

Run `yarn flow dom-fb` one final time and confirm `No errors!`.

## Automated Fix Script

For bulk fixes (Phases 5c-5e), use this approach:

1. Get structured errors: `node_modules/.bin/flow status --json`
2. Parse JSON to extract file, line, error code for each error
3. For each error, check if prev line has `$FlowFixMe`:
   - If yes with wrong code → update the code
   - If yes without code → add the code
   - If no → insert new `$FlowFixMe[code]` comment matching indentation
4. Write modified files
5. Re-run flow, repeat until no new fixes needed

## Key Files

| File | Role |
|------|------|
| `package.json` | `flow-bin` version |
| `scripts/flow/config/flowconfig` | Flow config template |
| `scripts/flow/createFlowConfigs.js` | Generates per-renderer configs, reads version from package.json |
| `scripts/flow/environment.js` | Custom type declarations (React$Element override, console, etc.) |
| `flow-typed/environments/` | DOM, Node, BOM type declarations |
| `packages/react/index.js` | React type re-exports |
| `packages/react/index.development.js` | React type re-exports (dev) |

## Common Mistakes

- **Not checking release exists** — Flow may skip version numbers; always verify with `gh api`
- **Forgetting multi-code lines** — A single line can have 2+ different error codes requiring stacked `$FlowFixMe` comments
- **Changing $FlowFixMe codes that are correct** — When updating a stale code, ensure the *new* code matches the actual error, not just the first error on nearby lines
- **Missing config option removals** — Flow versions may remove config options (e.g. `casting_syntax`, `suppress_type`); check `scripts/flow/config/flowconfig` for invalid options
