# AGENTS.md

Pong game (1P vs CPU). Vite 5 + React 19 + TypeScript (strict), three.js renderer. The simulation runs in MoonBit-compiled wasm (`sim/`) behind a TS facade; the wasm is compiled **in the browser at runtime** (`moonc-web` inside a Web Worker) — no MoonBit toolchain needed on the JS side. Comments and UI text are Japanese — keep new comments/UI strings in Japanese too.

## Working principles

### Workflow

- **Plan first.** Enter plan mode for any non-trivial task (3+ steps or an architectural decision). Write detailed specs upfront to reduce ambiguity, and use plan mode for verification steps too, not just building. If something goes sideways, stop and re-plan immediately — don't keep pushing.
- **Use subagents liberally** to keep the main context window clean: offload research, exploration, and parallel analysis. For complex problems, throw more compute at it — one focused tack per subagent.
- **Verify before declaring done.** Never mark a task complete without proving it works: run tests, check logs, demonstrate correctness. When relevant, diff behavior between the baseline (vanilla / upstream) and your change. Ask: "Would a staff engineer approve this?"
- **Demand elegance, balanced.** For non-trivial changes, pause and ask whether there's a more elegant way; if a fix feels hacky, redo it as the clean solution. Skip this for simple, obvious fixes — don't over-engineer.
- **Fix bugs autonomously.** Given a bug report, failing test, or error log, just resolve it — point at the evidence and fix the root cause without hand-holding.

### Task management

1. **Plan first** — write the plan with checkable items.
2. **Verify the plan** — check in before starting implementation.
3. **Track progress** — mark items complete as you go.
4. **Explain changes** — give a high-level summary at each step.
5. **Document results** — add a review section when the task closes.
6. **Capture lessons** — after any correction from the user, record the pattern and write a rule for yourself that prevents the same mistake. Review relevant lessons at session start.

### Core principles

- **Simplicity first** — make every change as simple as possible; impact minimal code.
- **No laziness** — find root causes; no temporary fixes; hold to senior-developer standards.
- **Minimal impact** — changes should touch only what's necessary; avoid introducing bugs.

## Commands

- `npm run dev` — dev server
- `npm run build` — bundle to `dist/` (**does not typecheck**)
- `npm run preview` — serve the built app
- `npm run typecheck` — `tsc --noEmit`
- `moon` CLI (not on PATH): `C:\Users\ryo\.moon\bin\moon.exe`. In `sim/`: `moon test`, housekeeping `moon info` + `moon fmt`. (`moon build` is no longer needed — the app compiles wasm in-browser; it only matters if you want native artifacts.)

No linter or formatter is configured. TS verification = `typecheck` + `build`; sim verification = `moon test` in `sim/`, then play manually in a browser.

## Entrypoints & layout

- `index.html` → `src/main.tsx` → `App.tsx` → `components/PongGame.tsx` (all UI and the game loop live there)
- `src/game/wasmSim.ts` — TS facade over compiled wasm: `WasmGame` (`stepSim` / `prepareServe` / `sync`, event bits → beeps), imports `sim/sim.mbt?raw` and compiles it in-browser via the worker (0 imports, 16 exports + `_start`). Score authority lives in wasm — read back with `pScore()` / `aScore()`, reset with `resetScores()`; `stepSim` returns a `PointResult` whose `gameOver` comes from the sim's `EV_GAME_OVER` bit
- `src/game/simCompiler.worker.ts` — Web Worker that evals `moonc-web.cjs` (CJS shim) and runs `buildPackage` + `linkCore` against assets under `{BASE_URL}mb-runtime/`; posts back wasm bytes (transferable). Must stay in lockstep with the payload package versions
- `scripts/copy-moonbit-assets.mjs` — predev/prebuild step: copies `moonc-web.cjs`, `manifest.json`, 78 std `.mi` files and the minimal 3-core subset from `@marianoguerra/tutuca-playground-payload` into `public/mb-runtime/` (gitignored)
- `src/render/PongScene.ts` — three.js renderer; reads state via structural `SimView` (`player.y`, `ai.y`, `ball.{x,y,vx,vy}`)
- `sim/` — MoonBit module (`internal/sim`): `sim.mbt` is the whole simulation, wasm export list in `moon.pkg`, tests in `sim_test.mbt`. Native build artifacts under `_build/` (gitignored) are only for `moon test`; the app itself never consumes them
- `src/game/constants.ts` (all tunables: W/H = 900×520, speeds, AI difficulty table) and `sound.ts` (WebAudio beeps) are still shared by the facade

## Gotchas

- `npm run build` does not typecheck; it can succeed with broken TS. Run `npm run typecheck` separately.
- Speed constants are px **per frame at 60fps** (`dt` is normalized to 60fps frames, clamped ≤3), not px/second. Don't convert the sim to seconds-based math without converting every constant in `constants.ts`.
- The sim steps only while `screen === PLAYING`, but the rAF loop must keep updating lastTime on non-playing frames (otherwise dt spikes on resume). Preserve this in `PongGame.tsx` `frame()`.
- React StrictMode double-invokes effects; `Game` is created lazily once via `gameRef`, and values the loop reads go through refs (`scoresRef`, `screenRef`, …) because the main effect mounts only once. Keep that pattern when adding state the loop needs. The **authoritative** score lives in wasm (read via `pScore()`/`aScore()`, reset with `resetScores()`); `scoresRef` is only a display mirror synced from wasm, not React state.
- Canvas has a fixed logical size W×H (900×520); CSS scales it. Mouse input is mapped via `getBoundingClientRect` → multiplied by `H / rect.height`.
- The wasm is compiled **in-browser at runtime**: `wasmSim.ts` sends `sim.mbt` source + asset base URL to `simCompiler.worker.ts`, which evals `moonc-web.cjs` behind a CJS shim and runs `buildPackage` → `linkCore`. No prebuilt wasm exists; first load pays a few seconds of compile time.
- `public/mb-runtime/` is **generated** (gitignored) by `scripts/copy-moonbit-assets.mjs` on `predev`/`prebuild`, from `@marianoguerra/tutuca-playground-payload`. If runtime fetches 404, that script didn't run.
- Version lockstep: `@moonbit/moonc-worker` and the payload package are version-paired (compiler + std `.mi` set). Bumping one without the other breaks linking (E4018-style errors). Keep both at their current paired versions until a verified pair is found.
- `linkCore` needs: the **minimal 3-core subset** (`000_abort_abort`, `001_bundle_core`, `002_core_core` — the full linkOrder set also works but is slower), `pkgSources: ["internal/sim:."]`, a `_boot.mbt` with an empty `main`, and `exportedFunctions` matching `sim/moon.pkg` exactly (plus auto-added `_start`). When adding/changing pub functions in `sim.mbt`, update **both** `moon.pkg` and the worker's export list.
- WasmGC needs a modern browser (Chrome ~109+, Safari 16.4+). Node <21 cannot instantiate these modules, so local acceptance = play manually in a real browser after `npm run dev`.
- Simulation code was ported from the legacy script.js with deliberate behavior parity (MoonBit implementation in `sim/sim.mbt`; the old TS reference has been removed). Comments referencing 旧実装 mark those spots — verify sim changes with `moon test` (deterministic same-seed black-box tests), then play manually.
