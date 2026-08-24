# AGENTS.md

Pong game (1P vs CPU). Vite 5 + React 19 + TypeScript (strict), single-page canvas app. Ported from a legacy vanilla JS script; comments and UI text are Japanese — keep new comments/UI strings in Japanese too.

## Commands

- `npm run dev` — dev server
- `npm run build` — bundle to `dist/` (**does not typecheck**)
- `npm run preview` — serve the built app
- `npm run typecheck` — `tsc --noEmit`

No test runner, linter, or formatter is configured. Verification = `typecheck` + `build`, then play manually in a browser.

## Entrypoints & layout

- `index.html` → `src/main.tsx` → `App.tsx` → `components/PongGame.tsx` (all UI and the game loop live there)
- `src/game/` — framework-free simulation: `game.ts` (`Game`: `stepSim` / `draw` / `prepareServe`), `ball.ts`, `paddle.ts` (+ `AIPaddle`), `sound.ts` (WebAudio beeps), `constants.ts` (all tunables: W/H = 900×520, speeds, AI difficulty table)

## Gotchas

- `npm run build` does not typecheck; it can succeed with broken TS. Run `npm run typecheck` separately.
- Speed constants are px **per frame at 60fps** (`dt` is normalized to 60fps frames, clamped ≤3), not px/second. Don't convert the sim to seconds-based math without converting every constant in `constants.ts`.
- The sim steps only while `screen === PLAYING`, but the rAF loop must keep updating lastTime on non-playing frames (otherwise dt spikes on resume). Preserve this in `PongGame.tsx` `frame()`.
- React StrictMode double-invokes effects; `Game` is created lazily once via `gameRef`, and values the loop reads go through refs (`scoresRef`, `screenRef`, …) because the main effect mounts only once. Keep that pattern when adding state the loop needs. Score authority lives in `scoresRef`, not React state.
- Canvas has a fixed logical size W×H (900×520); CSS scales it. Mouse input is mapped via `getBoundingClientRect` → multiplied by `H / rect.height`.
- Simulation code was ported from the legacy script.js with deliberate behavior parity; comments referencing 旧実装 mark those spots — preserve parity when editing sim logic in `src/game/`.
