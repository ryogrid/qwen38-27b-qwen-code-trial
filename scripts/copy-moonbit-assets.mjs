// ブラウザ側で MoonBit をコンパイルするためのアセットを node_modules から
// public/mb-runtime/ へコピーするワンショットスクリプト。
// npm run dev / npm run build の前置き（predev/prebuild）で実行され、
// Web Worker（src/game/simCompiler.worker.ts）が fetch で読み込むファイル群を整備する。
//
// コピー対象:
// - @moonbit/moonc-worker/moonc-web.cjs        → mb-runtime/moonc-web.cjs
// - tutuca-playground-payload/playground/manifest.json → mb-runtime/manifest.json
//   （std の .mi ファイル一覧を定義。バージョン一致が必須なため同梱物とペアで使う）
// - playground/fs/wasm-gc/std/**               → mb-runtime/fs/wasm-gc/std/**（78ファイル）
// - playground/fs/wasm-gc/cores/{000_abort_abort,001_bundle_core,002_core_core}.core
//   （この3つだけで本シムの linkCore が成立することを検証済み。必要最小限のコアのみコピー）

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(fileURLToPath(new URL("..", import.meta.url)));
const nm = path.join(root, "node_modules");
const outDir = path.join(root, "public", "mb-runtime");

const mooncCjs = path.join(nm, "@moonbit", "moonc-worker", "moonc-web.cjs");
const payloadBase = path.join(
  nm,
  "@marianoguerra",
  "tutuca-playground-payload",
  "playground",
);
const manifestPath = path.join(payloadBase, "manifest.json");

// ツールバージョンは厳密にペアを揃えること（不一致で E4018 になる）
for (const p of [mooncCjs, manifestPath]) {
  if (!existsSync(p)) {
    console.error(`[copy-moonbit-assets] 見つかりません: ${p}`);
    process.exit(1);
  }
}

// 前回の出力を完全に作り直す（古いコアファイルの残骸を防ぐ）
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "fs", "wasm-gc"), { recursive: true });

cpSync(mooncCjs, path.join(outDir, "moonc-web.cjs"));
cpSync(manifestPath, path.join(outDir, "manifest.json"));

// std の .mi 一式（ディレクトリごと再帰コピー）
const stdSrc = path.join(payloadBase, "fs", "wasm-gc", "std");
const stdDst = path.join(outDir, "fs", "wasm-gc", "std");
cpSync(stdSrc, stdDst, { recursive: true });

// linkCore に必要な最小コア群（検証済みサブセット。ファイル名を固定で指定）
const coresSrc = path.join(payloadBase, "fs", "wasm-gc", "cores");
const coresDst = path.join(outDir, "fs", "wasm-gc", "cores");
mkdirSync(coresDst, { recursive: true });
for (const name of [
  "000_abort_abort.core",
  "001_bundle_core.core",
  "002_core_core.core",
]) {
  cpSync(path.join(coresSrc, name), path.join(coresDst, name));
}

// サニティチェック: manifest の std エントリがすべて実在すること
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const stdEntries = manifest.targets["wasm-gc"].std;
let missing = 0;
for (const rel of stdEntries) {
  if (!existsSync(path.join(outDir, "fs", "wasm-gc", rel))) {
    console.error(`[copy-moonbit-assets] コピー漏れ: ${rel}`);
    missing++;
  }
}
if (missing > 0) process.exit(1);

console.log(
  `[copy-moonbit-assets] OK: moonc-web.cjs + manifest.json + std ${stdEntries.length} ファイル + cores 3`,
);
