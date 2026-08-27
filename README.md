# qwen38-27b-qwen-code-trial

[Xでのpost](https://x.com/ryo_grid/status/2091679529576374707)

Pong（1P vs CPU）。ゲームのシミュレーションは MoonBit で記述し WebAssembly にコンパイルして走らせ、その wasm は **ブラウザ内で実行時にコンパイル**（Web Worker 内の `moonc-web`）するため、JS 側に MoonBit ツールチェインは不要です。

## ソフトウェアスタック

| レイヤ | 技術 |
| --- | --- |
| UI / ゲームループ | React 19 + TypeScript (strict)、Vite 5 |
| レンダリング | three.js（`src/render/PongScene.ts`） |
| シミュレーション本体 | MoonBit → WebAssembly（WasmGC） |
| ブラウザ内コンパイラ | `@moonbit/moonc-worker`（moonc-web、Web Worker 内で eval 実行） |
| 効果音 | WebAudio（ビープ音のみ） |

- `sim/` の std `.mi` ファイル群とコアサブセットは `@marianoguerra/tutuca-playground-payload` に由来し、predev / prebuild で `public/mb-runtime/` にコピーされる
- 事前ビルド済み wasm は存在せず、初回ロード時にブラウザが数秒かけてコンパイルする

## 設計（簡略）

### 権威の分離

1. **シミュレーション層（権威）** — `sim/sim.mbt`（MoonBit）。物理・ロジック・スコア管理は全てこちら。TS 側は一切計算せず、入力を渡し `step` を呼んで結果（イベントビット群）を受け取るだけ
2. **TS ファサード** — `src/game/wasmSim.ts`。wasm の export を React から使いやすい形に包み、イベントビットをビープ音等に翻訳する
3. **ブラウザ内コンパイル** — `simCompiler.worker.ts` が `moonc-web.cjs` を CJS シム越しに eval し、`buildPackage` → `linkCore` で wasm バイト列を生成してメインスレッドへ返す
4. **レンダラー（非権威）** — three.js 側は状態を構造的ビューとして読むだけで描画する。ボールのシーム回転や乱流の風矢印も演出のみ

### シミュレーションの特徴

- **決定論**：xorshift32 RNG と固定演算順序で、同じシードなら常に同一軌跡（リプレイ・テスト比較に使える）
- **スピン／マグヌス効果**：動いているパドルがボールにスピンを乗せ（±上限あり）、飛行中に Magnus 力で曲げ、減衰し、壁面でさらに擦り減らす
- **重力乱流**：嵐ウィンドウで緩慢に変調される有界な加速度場。位相のみで決まるため RNG を消費せず、シードの決定論を壊さない

### テスト戦略

- `sim/` で `moon test` — 黒箱テスト（`_test.mbt`：同じシード同軌跡などの振る舞い検証）＋白箱テスト（`_wbtest.mbt`：スピン／マグヌスの付与式を厳密値で検証）
- TS 側は `npm run typecheck` / `npm run build`。最終確認はブラウザでの実プレイ（Node では WasmGC を即時化できないため）

## 実行方法

```sh
npm install
npm run dev   # http://localhost:5173 （初回のみ wasm コンパイルに数秒かかる）
```

その他のコマンドは AGENTS.md を参照のこと。

## 実装環境（ローカル LLM）

本プロジェクトのコードは、**OpenCode** で **Qwen3.8 27B** をローカル GPU 上で動作させて実装しました。

- **モデル**: [jrell/Qwen3.8-27B-i1-IQ4_XS-GGUF-Smaller](https://huggingface.co/jrell/Qwen3.8-27B-i1-IQ4_XS-GGUF-Smaller)
- **OS / ハードウェア**: Windows 11（非 WSL 環境）/ Radeon RX 9060 XT 16GB、ROCm エンジン
- **ランナー**: LM Studio
  - KV Cache: Q4_0
  - MTP 有効（Max draft token 数 3）
  - Physical Batch Size / Evaluation Batch Size: 1024
  - コンテキスト長: 64k
  - Thinking Budget: 2048
