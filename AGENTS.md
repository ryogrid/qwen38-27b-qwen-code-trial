# AGENTS.md

Pong game (1P vs CPU). Vite 5 + React 19 + TypeScript (strict), three.js renderer. The simulation runs in MoonBit-compiled wasm (`sim/`) behind a TS facade; the wasm is compiled **in the browser at runtime** (`moonc-web` inside a Web Worker) — no MoonBit toolchain needed on the JS side. Comments and UI text are Japanese — keep new comments/UI strings in Japanese too.

---

## 1. Persistent Task State

For any task that is more than a small change, maintain persistent task state in the repository.

Before substantial implementation work begins:

1. Understand the task and inspect the relevant code.
2. Create or identify a suitable task directory under:

   `docs/design/`

3. Maintain at minimum:

   - `DESIGN.md` — problem, goals, design, constraints, decisions, and verification strategy.
   - `TODO.md` — concrete implementation and verification checklist.

If the task already has an appropriate design document or task directory, reuse it.

Do not create unnecessary documentation for trivial changes.

### Persistent state must contain

Record important information that would otherwise exist only in conversation:

- Problem statement
- Requirements
- Constraints
- Relevant files and components
- Important discoveries
- Design decisions and their rationale
- Alternatives considered
- Known risks
- Tests performed
- Test results
- Remaining problems
- Current implementation status

The repository documentation is the source of truth for long-running work.

---

## 2. Work in Small, Recoverable Steps

Break large tasks into small phases.

Prefer this general loop:

1. Inspect
2. Form a hypothesis
3. Record the plan
4. Make a small change
5. Build/test
6. Inspect the result
7. Update persistent state
8. Continue

Avoid making a large number of unrelated changes before validation.

After each meaningful milestone, update `TODO.md` and, when appropriate, `DESIGN.md`.

A task should always be recoverable from the repository after losing the conversation context.

---

## 3. Context Budget Awareness

The model has a limited context window.

Optimize for information density rather than reading everything.

### Do

- Search for relevant symbols before reading large files.
- Read only the relevant portions of large files when possible.
- Use repository search extensively.
- Prefer summaries of already-understood code.
- Re-read persistent task state instead of relying on conversation memory.
- Keep temporary reasoning out of persistent documents.
- Record only durable, decision-relevant information.

### Do not

- Repeatedly read the same large files without a reason.
- Dump entire large files into context when a small section is sufficient.
- Reconstruct the entire repository unnecessarily.
- Spend context on irrelevant implementation details.
- Assume that because something was discussed earlier, it is still available.

When a large amount of information must be inspected, summarize the important conclusions into the task documentation before moving on.

---

## 4. Context Compaction Recovery

Context compaction is expected during long tasks.

When context has been compacted, do not continue blindly.

First recover the task state:

1. Read `docs/design/.../TODO.md`.
2. Read the corresponding `DESIGN.md`.
3. Inspect the current git diff/status.
4. Inspect relevant recent changes.
5. Determine what has actually been completed.
6. Run appropriate tests if the state is uncertain.
7. Continue from the documented current state.

Never rely on reconstructed memories of the previous conversation when the repository can provide the answer.

If the previous plan and the current repository state disagree, trust the actual repository state and update the documentation.

---

## 5. Before Starting Implementation

Before modifying code, establish:

### Problem

What exactly is broken, missing, or being improved?

### Expected behavior

What should happen after the change?

### Constraints

Identify relevant constraints such as:

- API compatibility
- Performance
- Memory usage
- Concurrency
- Error handling
- Backward compatibility
- Existing architectural conventions
- Platform restrictions

### Scope

Identify:

- What must change
- What should not change
- What can be deferred

Record important conclusions in `DESIGN.md`.

Do not start implementation based solely on an ambiguous interpretation of the task.

---

## 6. Repository Exploration

Understand the existing architecture before introducing new abstractions.

Start from:

1. Repository structure
2. Relevant package/module
3. Entry points
4. Callers
5. Data structures
6. Existing tests
7. Existing similar implementations

Prefer finding existing patterns over inventing new ones.

When modifying behavior, inspect both:

- the implementation
- the code that consumes the implementation

Do not assume that a function's name completely describes its semantics.

---

## 7. Design Before Complex Changes

For non-trivial changes, explicitly establish:

- Data flow
- Control flow
- Ownership/lifetime
- Error propagation
- Concurrency behavior
- Performance implications
- Compatibility implications

For performance-sensitive work, identify:

- Current bottleneck
- Measurement method
- Baseline
- Expected improvement
- Regression risks

Do not optimize based solely on intuition when measurement is practical.

---

## 8. Implementation Discipline

Make changes that fit the existing architecture.

Prefer:

- Small, understandable functions
- Existing abstractions
- Existing error-handling conventions
- Existing naming conventions
- Minimal changes to unrelated code

Avoid:

- Unnecessary refactoring
- Large speculative redesigns
- Introducing dependencies without need
- Duplicating existing functionality
- Changing public behavior unintentionally

Do not rewrite working code merely because a different implementation looks cleaner.

---

## 9. Validation

Never consider an implementation complete merely because it compiles.

Validation should be proportional to the change.

At minimum, perform the most relevant available checks:

- Formatting
- Build/compile
- Unit tests
- Integration tests
- Relevant benchmarks
- Static analysis
- Existing regression tests

For bug fixes, ideally demonstrate:

1. The old behavior or failure.
2. The new behavior.
3. Regression coverage preventing recurrence.

For performance changes, compare against a baseline whenever practical.

Record meaningful test results in `TODO.md` or `DESIGN.md`.

---

## 10. Debugging

When something fails:

1. Reproduce it.
2. Identify the failure boundary.
3. Inspect evidence.
4. Form a hypothesis.
5. Make the smallest useful experiment.
6. Verify or reject the hypothesis.
7. Record important findings.
8. Apply the fix.
9. Re-run the relevant tests.

Do not repeatedly make speculative changes without establishing why the previous attempt failed.

Clearly distinguish:

- Confirmed facts
- Strong hypotheses
- Unverified assumptions

---

## 11. TODO Management

`TODO.md` is an active execution plan, not a static document.

Use concrete items such as:

- `[ ] Inspect executor path`
- `[x] Identify allocation hotspot`
- `[ ] Implement buffer reuse`
- `[ ] Add regression test`
- `[ ] Run benchmark`
- `[ ] Review error path`

Keep it updated throughout the task.

When discovering new work, add it.

When work becomes irrelevant, remove or explicitly defer it.

At every major milestone, ensure `TODO.md` accurately reflects reality.

---

## 12. Decision Log

Important architectural or behavioral decisions should be recorded.

For each significant decision, record:

- Decision
- Reason
- Alternatives considered
- Consequences

Do not repeatedly reconsider settled decisions unless new evidence justifies doing so.

This prevents context compaction from causing the same design discussion to happen again.

---

## 13. Tests Are Part of the Implementation

When behavior changes, update or add tests unless there is a concrete reason not to.

Tests should verify behavior rather than implementation details whenever practical.

Include edge cases relevant to the change.

Do not weaken or remove tests simply to make the implementation pass.

If an existing test appears incorrect, investigate before changing it.

---

## 14. Performance Work

When the task involves performance:

1. Establish a baseline.
2. Identify the hot path.
3. Measure before changing.
4. Make one or a small number of targeted changes.
5. Measure again.
6. Compare results.
7. Investigate regressions.

Do not claim performance improvements without evidence.

When profiling is available, prefer profiler evidence over intuition.

Document benchmark conditions sufficiently to make results interpretable.

---

## 15. Final Review

Before declaring the task complete, perform a final review.

Check:

### Correctness

- Does the implementation actually solve the original problem?
- Are edge cases handled?
- Are errors handled correctly?

### Scope

- Are unrelated changes avoided?
- Is the implementation consistent with the repository architecture?

### Tests

- Are relevant tests present?
- Do all relevant tests pass?

### Documentation

- Is `TODO.md` up to date?
- Is `DESIGN.md` accurate?
- Are important discoveries and decisions recorded?

### Code quality

- Is the code understandable?
- Are there unnecessary abstractions?
- Are there obvious regressions?

### Repository state

Inspect the final diff and status.

Do not declare success based solely on a successful build.

---

## 16. Communication and Uncertainty

When reporting progress or conclusions:

- Be concise.
- State what was actually verified.
- Distinguish facts from assumptions.
- Mention important remaining risks.
- Do not claim tests were run if they were not.
- Do not claim a bug is fixed without verification.

If blocked, document:

- What is blocking progress
- What was attempted
- What was learned
- What information or action is required

---

## 17. Long-Running Task Rule

For long-running tasks, periodically ask:

> "If my context disappeared right now, could another agent continue this task from the repository alone?"

If the answer is no, update the persistent task documentation before continuing.

The repository should progressively become a better representation of the task state.

Do not optimize for finishing the conversation quickly.

Optimize for producing a correct, tested, maintainable result that can survive context loss.

---

## 18. Commands

- `npm run dev` — dev server
- `npm run build` — bundle to `dist/` (**does not typecheck**)
- `npm run preview` — serve the built app
- `npm run typecheck` — `tsc --noEmit`
- `moon` CLI (not on PATH): `C:\Users\ryo\.moon\bin\moon.exe`. In `sim/`: `moon test`, housekeeping `moon info` + `moon fmt`. (`moon build` is no longer needed — the app compiles wasm in-browser; it only matters if you want native artifacts.)

No linter or formatter is configured. TS verification = `typecheck` + `build`; sim verification = `moon test` in `sim/`, then play manually in a browser.

---

## 19. Entrypoints & layout

- `index.html` → `src/main.tsx` → `App.tsx` → `components/PongGame.tsx` (all UI and the game loop live there)
- `src/game/wasmSim.ts` — TS facade over compiled wasm: `WasmGame` (`stepSim` / `prepareServe` / `sync`, event bits → beeps), imports `sim/sim.mbt?raw` and compiles it in-browser via the worker (0 imports, 16 exports + `_start`). Score authority lives in wasm — read back with `pScore()` / `aScore()`, reset with `resetScores()`; `stepSim` returns a `PointResult` whose `gameOver` comes from the sim's `EV_GAME_OVER` bit
- `src/game/simCompiler.worker.ts` — Web Worker that evals `moonc-web.cjs` (CJS shim) and runs `buildPackage` + `linkCore` against assets under `{BASE_URL}mb-runtime/`; posts back wasm bytes (transferable). Must stay in lockstep with the payload package versions
- `scripts/copy-moonbit-assets.mjs` — predev/prebuild step: copies `moonc-web.cjs`, `manifest.json`, 78 std `.mi` files and the minimal 3-core subset from `@marianoguerra/tutuca-playground-payload` into `public/mb-runtime/` (gitignored)
- `src/render/PongScene.ts` — three.js renderer; reads state via structural `SimView` (`player.y`, `ai.y`, `ball.{x,y,vx,vy}`)
- `sim/` — MoonBit module (`internal/sim`): `sim.mbt` is the whole simulation, wasm export list in `moon.pkg`, tests in `sim_test.mbt`. Native build artifacts under `_build/` (gitignored) are only for `moon test`; the app itself never consumes them
- `src/game/constants.ts` (all tunables: W/H = 900×520, speeds, AI difficulty table) and `sound.ts` (WebAudio beeps) are still shared by the facade

---

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
