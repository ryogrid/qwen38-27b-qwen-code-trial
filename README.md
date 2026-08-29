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
4. **レンダラー** — three.js 側は状態を構造的ビューとして読むだけで描画する。ボールのシーム回転・コート全面ウォーターのスラブ・水面流れのセル単位矢じりも描画のみ（さらに水流力矢印と RPM 表示、次項）

### フィジカル量の可視化（表示のみ）

- **水流力矢印**：ボール上に、その点の水がボールに及ぼす力（1フレーム毎 Δv）の向き・強さを表す矢印を描く。長さは |Δv| に比例（上下限あり）。レンダラー側で `sim.mbt` の結合式をミラー計算し**物理には一切影響しない**。Δv が極小（静水での減衰分程度）以下なら非表示
- **RPM 表示**：画面右側にボールの回転を `xxx RPM` で表示する。+ は時計回り（右回り）、− は反時計回り（左回り）。シムの `spin` を表示用の回転率（spin=1 で 0.5 rad/frame、≒286 RPM/単位スピン）で換算し、最大 ±430 RPM 程度

### シミュレーションの特徴

- **決定論**：xorshift32 RNG と固定演算順序で、同じシードなら常に同一軌跡（リプレイ・テスト比較に使える）
- **スピン／マグヌス効果**：動いているパドルがボールにスピンを乗せ（±上限あり）、飛行中に Magnus 力で曲げ、減衰し、壁面でさらに擦り減らす
- **コート全面ウォーター**：テーブル全面が水面（浮力なし）。水滴落下の衝撃が決定論的な流れ場（拡散＋減衰）を攪拌し、球には相対抗力／絶対減衰で作用。RNG は落水瞬間のみ消費するためシードの確定性を損なわない

### ゲーム仕様・チューニング値

速度系の定数は **60fps 基準 px/フレーム**（`dt` は 60fps フレーム換算で ≤3 にクランプ）。TS 側は `src/game/constants.ts`、シム側の同名 `_D` 定数が権威。

| 項目 | 値 |
| --- | --- |
| コート（論理 px） | 900 × 520（W×H） |
| ボール半径 / 初速 / 上限速度 | 8 / 6.5 / 14 px/フレーム |
| ヒット毎の加速 | ×1.05 |
| パドル寸法（厚み×長辺） / 位置 x | 14 × 92 / プレイヤー x=26、AI は右端対称 |
| プレイヤー移動速度 / マウス追従 lerp | 8 px/フレーム / 0.25 |
| サーブ最大角 / バウンド最大角 | ±36°（π/5） / 約 56°（π/3.2） |
| AI 難易度（easy/medium/hard） | 速度 3.4・誤差 52 / 4.6・28 / 6.4・10 |
| 勝利点数（WIN_SCORE、権威は wasm） | 5 ポイント |
| 水面流れグリッド | FLOW_N=30 × FLOW_M=52 セル |
| スピン付与ゲイン / 上限 / 入力源上限 | 0.19 / ±1.5 / パドル速度 12 px/フレームで飽和 |
| マグヌス係数 / スピン減衰 / 壁面残存率 | K=0.005（毎フレーム spin×K rad 回転） / rate=0.004（半減≈2.9秒） / ×0.8 |
| 水結合：相対抗力ゲイン / 速度スケーリング上限 / 絶対減衰率 | 0.011 / ×2.5（\|v\|/6.5 で比例） / rate=0.0006 |
| 静水判定閾値（これ未満の流速の軸には力なし） | 0.1 px/フレーム（FLOW_STILL_EPS_D） |

表示用のミラー定数（`PongScene.ts` の `WF_*`、矢印長・RPM 換算率など）は sim.mbt と同一値を保持するため**両方まとめて変更**すること。

### テスト戦略

- `sim/` で `moon test` — 黒箱テスト（`_test.mbt`：同じシード同軌跡などの振る舞い検証）＋白箱テスト（`_wbtest.mbt`：スピン／マグヌスの付与式を厳密値で検証）
- TS 側は `npm run typecheck` / `npm run build`。最終確認はブラウザでの実プレイ（Node では WasmGC を即時化できないため）

## 実行方法

```sh
npm install
npm run dev   # http://localhost:5173 （初回のみ wasm コンパイルに数秒かかる）
```

その他のコマンドは AGENTS.md を参照のこと。
