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
