# AGENTS.md

Pong game (1P vs CPU). Vite 5 + React 19 + TypeScript (strict), three.js renderer. The simulation runs in MoonBit-compiled wasm (`sim/`) behind a TS facade; comments and UI text are Japanese — keep new comments/UI strings in Japanese too.

## Commands

- `npm run dev` — dev server
- `npm run build` — bundle to `dist/` (**does not typecheck**)
- `npm run preview` — serve the built app
- `npm run typecheck` — `tsc --noEmit`
- `moon` CLI (not on PATH): `C:\Users\ryo\.moon\bin\moon.exe`. In `sim/`: `moon build --target wasm --release`, `moon test`, housekeeping `moon info` + `moon fmt`.

No linter or formatter is configured. TS verification = `typecheck` + `build`; sim verification = `moon test` in `sim/`, then play manually in a browser.

## Entrypoints & layout

- `index.html` → `src/main.tsx` → `App.tsx` → `components/PongGame.tsx` (all UI and the game loop live there)
- `src/game/wasmSim.ts` — TS facade over compiled wasm: `WasmGame` (`stepSim` / `prepareServe` / `sync`, event bits → beeps), loads `_build/…/sim.wasm` as a `?url` asset (0 imports, 10 exports)
- `src/render/PongScene.ts` — three.js renderer; reads state via structural `SimView` (`player.y`, `ai.y`, `ball.{x,y,vx,vy}`)
- `sim/` — MoonBit module (`internal/sim`): `sim.mbt` is the whole simulation, wasm export list in `moon.pkg`, tests in `sim_test.mbt`, artifacts under `_build/` (gitignored)
- `src/game/{game,ball,paddle}.ts` — legacy TS sim kept for behavior-parity reference only; typechecked but not bundled
- `src/game/constants.ts` (all tunables: W/H = 900×520, speeds, AI difficulty table) and `sound.ts` (WebAudio beeps) are still shared by the facade

## Gotchas

- `npm run build` does not typecheck; it can succeed with broken TS. Run `npm run typecheck` separately.
- Speed constants are px **per frame at 60fps** (`dt` is normalized to 60fps frames, clamped ≤3), not px/second. Don't convert the sim to seconds-based math without converting every constant in `constants.ts`.
- The sim steps only while `screen === PLAYING`, but the rAF loop must keep updating lastTime on non-playing frames (otherwise dt spikes on resume). Preserve this in `PongGame.tsx` `frame()`.
- React StrictMode double-invokes effects; `Game` is created lazily once via `gameRef`, and values the loop reads go through refs (`scoresRef`, `screenRef`, …) because the main effect mounts only once. Keep that pattern when adding state the loop needs. Score authority lives in `scoresRef`, not React state.
- Canvas has a fixed logical size W×H (900×520); CSS scales it. Mouse input is mapped via `getBoundingClientRect` → multiplied by `H / rect.height`.
- `sim/_build/` is gitignored and Vite copies the wasm from there; on a fresh checkout run `moon build --target wasm --release` in `sim/` before `npm run dev`/`build`. When adding/changing pub functions in `sim.mbt`, also update the `exports` list in `sim/moon.pkg` or they won't be visible from JS.
- Simulation code was ported from the legacy script.js with deliberate behavior parity (TS reference kept in `src/game/*.ts`, MoonBit implementation in `sim/sim.mbt`); comments referencing 旧実装 mark those spots — preserve parity when editing sim logic, and verify with `moon test` plus the same-seed replay check.
