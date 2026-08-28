# qwen38-27b-<del>qwen-code</del>open-code-trial

[Xでのpost](https://x.com/ryo_grid/status/2092849827814257130)

Pong（1P vs CPU）。ゲームのシミュレーションは MoonBit で記述し WebAssembly にコンパイルして走らせ、その wasm は **ブラウザ内で実行時にコンパイル**（Web Worker 内の `moonc-web`）するため、ビルド環境に MoonBit ツールチェインは不要です。
## 実装環境（ローカル LLM）

本プロジェクトのコードは、**LMStudio（llama.cpp）** で **Qwen3.8 27B** を動作させることでローカルLLM環境を構築し、**OpenCode（≠ Qwen Code CLI)** を同LLMに接続させて動作させることで実装しました。

- **LLMモデル**: [jrell/Qwen3.8-27B-i1-IQ4_XS-GGUF-Smaller](https://huggingface.co/jrell/Qwen3.8-27B-i1-IQ4_XS-GGUF-Smaller)
- **OS / ハードウェア**: Windows 11（非 WSL 環境）/ Ryzen 7 5700X 物理8コア（論理16コア）/ 主記憶 64GB（8-16GBあれば十分な気がします） / Radeon RX 9060 XT 16GB
  - LMStudio も OpenCode もネイティブのWindows11上 で動作
  - Windows11 は Pro 25H2 OSビルド 26200.9168
    - WSL2を使ったりもしていないので、Windows11のエディションはHomeなどでも問題ないはずです
- **LLMランナー/サーバ**: LM Studio v0.4.21
  - ROCm （llama.cpp）Windows ランタイム v2.29.1
    - Vulkanランタイムでもおそらく動作し、ほぼ同等のパフォーマンスになる気がします
  - KV Cache: Q4_0
  - MTP 有効（Max draft token 数 3）
  - Physical Batch Size / Evaluation Batch Size: 1024
  - コンテキスト長: 64k
  - Reasoning Budget: 2048
  - Reasoning Budget Message: Use your reasoning budget for careful multi-step reasoning. Before making changes, inspect the relevant code and understand the existing design. After making changes, verify the result with appropriate tests or commands. Avoid unnecessary reasoning for simple tasks.
    - と入れてみている。もっと短くてよいという噂もある

- **コーディングエージェント**: OpenCode v1.18.23
  - 利用するLLMモデルに関する設定はリポジトリ内の [opencode.json](./opencode.json) を参照
  - OpenCodeはPowerShell内で作業をしました（しています）
    - PowerShellのシェル芸もできるのはすごいですね^^

### LMStudioの設定補足

<img width="339" height="793" alt="image" src="https://github.com/user-attachments/assets/2de4f3ac-d90f-49b5-b9eb-5d77a1074dfb" />
<img width="334" height="712" alt="image" src="https://github.com/user-attachments/assets/7dbef7bf-83a7-45ac-9708-b8fbbe94552b" />



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

## 設計

### 階層的な役割分担

1. **シミュレーション層（ゲームのコア）** — `sim/sim.mbt`（MoonBit）。物理・ロジック・スコア管理は全てこちら。TS 側は一切計算せず、入力を渡し `step` を呼んで結果（イベントビット群）を受け取るだけ
2. **TS ファサード** — `src/game/wasmSim.ts`。wasm の export を React から使いやすい形に包み、イベントビットをビープ音等に翻訳する
3. **ブラウザ内コンパイル** — `simCompiler.worker.ts` が `moonc-web.cjs` を CJS シム越しに eval し、`buildPackage` → `linkCore` で wasm バイト列を生成してメインスレッドへ返す
4. **レンダラー** — three.js 側は状態を構造的ビューとして読むだけで描画する。ボールのシーム回転・コート全面ウォーターのスラブ・水面流れのセル単位矢じりも描画のみ

### シミュレーションの特徴

- **決定論**：xorshift32 RNG と固定演算順序で、同じシードなら常に同一軌跡（リプレイ・テスト比較に使える）
- **スピン／マグヌス効果**：動いているパドルがボールにスピンを乗せ（±上限あり）、飛行中に Magnus 力で曲げ、減衰し、壁面でさらに擦り減らす
- **コート全面ウォーター**：テーブル全面が水面（浮力なし）。水滴落下の衝撃が決定論的な流れ場（拡散＋減衰）を攪拌し、球には相対抗力／絶対減衰で作用。RNG は落水瞬間のみ消費するためシードの確定性を損なわない

### テスト戦略

- `sim/` で `moon test` — 黒箱テスト（`_test.mbt`：同じシード同軌跡などの振る舞い検証）＋白箱テスト（`_wbtest.mbt`：スピン／マグヌスの付与式を厳密値で検証）
- TS 側は `npm run typecheck` / `npm run build`。最終確認はブラウザでの実プレイ（Node では WasmGC を即時化できないため）

## 実行方法

```sh
npm install
npm run dev   # http://localhost:5173 （初回のみ wasm コンパイルに数秒かかる）
```

その他のコマンドは AGENTS.md を参照のこと。
