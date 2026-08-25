# AGENTS.md

React monorepo. Two main areas (see `CLAUDE.md`):
- **React core (runtime)** — everything outside `compiler/` (root yarn workspace).
- **React Compiler** — `compiler/` (its own yarn workspace; see `compiler/CLAUDE.md` and `compiler/docs/DEVELOPMENT_GUIDE.md`). Includes an in-progress Rust port under `compiler/crates/`.

## Cursor Cloud specific instructions

### Toolchains (already provisioned in the base environment)
- **Node** is pinned to `v20.19.0` (`.nvmrc`). The VM's default `node` on `PATH` is a newer `/exec-daemon/node` (v22), so `~/.bashrc` prepends the nvm `v20.19.0` bin dir to `PATH` — this makes login shells use node 20 + `yarn@1.22.22`. Interactive/login shells (the default for terminals) get the right node automatically; if you spawn a bare non-login `sh`, `node` may resolve to v22. Dependency installs work under either node, but run tests/build/Flow under node 20 for parity with CI.
- **Rust** (for `compiler/crates/`) must be **≥ 1.85**: the workspace uses `edition = "2024"` and `resolver = "3"`. The base image's original `rustc` was 1.83, so stable (1.98) was installed via `rustup` and set as default. Verify with `rustc --version` before working on the Rust port.

### Dependency layout gotcha (important)
The compiler Playground at `compiler/apps/playground` is **not** part of the compiler's `packages/*` yarn workspaces, so `yarn --cwd compiler install` does **not** install it. It has its own `node_modules` and must be installed separately with `yarn --cwd compiler/apps/playground install`. The update script already does this. Symptom if missing: `next: not found` when running `yarn dev`.

### Running things
- **React core** (from repo root): tests `yarn test --no-watchman <pattern>` (always pass a pattern — no pattern runs everything), lint `yarn linc` (changed) / `yarn lint` (all), Flow `yarn flow <renderer>` (e.g. `yarn flow dom-node`), build `yarn build`. See the skills in `.claude/skills/` (`test`, `flow`, `verify`, `fix`).
- **React Compiler** (from `compiler/`): primary test suite is the custom snapshot runner — `yarn snap:build` once, then `yarn snap` (add `-p <pattern>`, `-u` to update, `-d` for debug). Lint `yarn workspace babel-plugin-react-compiler lint`. See `compiler/CLAUDE.md`.
- **Rust port** (from `compiler/`): `cargo test` / `cargo build`.
- **Playground app** (the runnable GUI): from `compiler/`, `yarn dev` builds the compiler + runtime in watch mode and starts Next.js on `http://localhost:3000`. First readiness takes ~10–15s after the compiler watch build. Editing the left editor recompiles the right (compiled-output) pane live. Requires playground deps installed (see gotcha above).

### Build CLI notes
- `yarn build` builds **all** channels (stable + experimental) for every package — it's slow (~9 min single-worker) and needs Java (present). Narrow it: `yarn build --r=experimental` (or `--r=stable`) builds one channel into `build/oss-experimental` (or `build/oss-stable`); `yarn build <bundles> --type=NODE --release-channel=experimental` builds specific packages. CI sharding uses `--index=N --total=25 --ci`.
- `yarn build` overwrites `packages/shared/ReactVersion.js` with a placeholder version (expected). Restore it (`git checkout -- packages/shared/ReactVersion.js`) and do not commit it.
- Validate build output with `yarn lint-build`; regenerate error codes with `yarn extract-errors`.

### Fixtures (browser dev harnesses under `fixtures/`)
- Fixtures depend on a **local React build**: run `yarn build --r=experimental` at the repo root first (produces `build/oss-experimental`).
- **DOM fixture** (`fixtures/dom`): `yarn --cwd fixtures/dom install`, then `yarn predev` (copies `build/oss-experimental/.` into its `node_modules` — this is what wires in the freshly built React), then `yarn dev` (Create React App dev server, defaults to port 3000; set `PORT` to avoid clashing with the compiler playground).
  - Gotcha: it pins the ancient `react-scripts@1.1.5`, whose webpack needs `NODE_OPTIONS=--openssl-legacy-provider` under node 20 (OpenSSL 3) to boot. Its bundled `eslint-loader` also emits a non-fatal `Parsing error: Unexpected token` on JSX fragment shorthand (`<>`); the app still compiles ("Compiled with warnings"). Use `BROWSER=none CI=false` to keep the dev server foregrounded without opening a browser or treating warnings as errors.
  - CI validates this fixture with `yarn predev && yarn test` (`react-scripts test --env=jsdom`), not the dev server.
