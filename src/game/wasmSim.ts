// ===== wasm シミュレーションブリッジ =====
// sim/sim.mbt を ?raw でインポートし、Web Worker（simCompiler.worker.ts）内で
// ブラウザ実行時に moonc-web が wasm-gc にコンパイル → インスタンス化する。
// JS 側に MoonBit ツールチェーンは不要（アセットは predev/prebuild が配置）。
// スコア・勝敗の権威は wasm 側（p_score/a_score/reset_scores/EV_GAME_OVER）。
// 乱数は wasm 内部の xorshift32（seed() で固定可）。決定的リプレイ用。

import { W, H } from "./constants";
import type { DifficultyKey } from "./constants";
import { beep } from "./sound";
import simSource from "../../sim/sim.mbt?raw";

export type Side = "player" | "ai";

// ゲームループ用：dt は60fpsフレーム相当（最大3をクランプ）に使う参照（Game.stepSim と同一）
export interface LastTimeRef {
  current: number;
}

// ポイント発生時の結果（勝敗は wasm が EV_GAME_OVER で通知。JS では数え上げない）
export interface PointResult {
  side: Side;
  gameOver: boolean;
}

// イベントビット（sim.mbt の EV_* と一致させること）
const EV_PADDLE_HIT = 1; // パドルヒット（600Hz beep）
const EV_WALL = 2; // 上下壁リバウンド（420Hz beep）
const EV_POINT_PLAYER = 4; // プレイヤー得点（ボール右アウト。180Hz beep）
const EV_POINT_AI = 8; // AI 得点（ボール左アウト。180Hz beep）
const EV_GAME_OVER = 16; // 勝敗決着（ポイントビットと同一フレームに付与）

// DifficultyKey → sim.mbt の DIFFICULTIES インデックス（easy/medium/hard の順で一致させること）
const DIFF_IDX: Record<DifficultyKey, number> = { easy: 0, medium: 1, hard: 2 };

// 水面流れの描画用プロブ格子（コート全面 [0, W] × [0, H] の固定レイアウト。sync() で毎フレームサンプリング）
const FLOW_COLS = 10; // x 方向（左右に均等分割、dx=90px）
const FLOW_ROWS = 4; // y 方向（上下壁間を均等分割、dy=130px）

interface SimExports {
  seed(s: number): void;
  prepare_serve(dir: number): void;
  center_paddles(): void;
  reset_scores(): void;
  step(
    idx: number,
    dt: number,
    keyLeft: boolean,
    keyRight: boolean,
    mouseY: number,
    useMouseFollow: boolean,
  ): number;
  ball_x(): number;
  ball_y(): number;
  player_y(): number;
  ai_y(): number;
  vx(): number;
  vy(): number;
  spin(): number;
  flow_sample_x(x: number, y: number): number; // 流場の x 成分（px/フレーム@60fps）
  flow_sample_y(x: number, y: number): number; // 流場の y 成分（px/フレーム@60fps）
  p_score(): number;
  a_score(): number;
  _start?(): void; // moonc が生成する初期化エントリ（あれば必ず呼ぶ）
}

type WorkerCompileResponse =
  | { ok: true; wasmBytes: Uint8Array }
  | { ok: false; error: string };

// アセットは public/mb-runtime/ へ配置済み（scripts/copy-moonbit-assets.mjs）。
// BASE_URL が "/" で終わるため末尾スラッシュを除去してから連結し、二重スラッシュを避ける。
const ASSET_BASE = `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/mb-runtime/`;

function compileViaWorker(): Promise<SimExports> {
  const worker = new Worker(new URL("./simCompiler.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<SimExports>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerCompileResponse>) => {
      const res = e.data;
      worker.terminate();
      if (!res.ok) {
        reject(new Error(`sim.mbt のブラウザ内コンパイルに失敗しました:\n${res.error}`));
        return;
      }
      (async () => {
        // import 0 / export のみ。_start があれば初期化してから使う
        const bytes = new Uint8Array(res.wasmBytes); // 新しい ArrayBuffer へコピー（BufferSource として確実に使える）
        const mod = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(mod, {});
        const ex = instance.exports as unknown as SimExports;
        if (typeof ex._start === "function") ex._start();
        resolve(ex);
      })().catch(reject);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`コンパイラワーカーでエラー: ${e.message}`));
    };
    worker.postMessage({ source: simSource, baseUrl: ASSET_BASE });
  });
}

// wasm はモジュールグローバルな単一シミュレーション状態を持つ（アプリ全体で1つのみ）
let loadPromise: Promise<SimExports> | null = null;

function loadWasm(): Promise<SimExports> {
  if (!loadPromise) {
    loadPromise = compileViaWorker().catch((err) => {
      // 失敗しても再試行できるようにキャッシュしない（コンソールには残す）
      console.error("[wasmSim] シムの読み込みに失敗しました:", err);
      throw err;
    });
  }
  return loadPromise;
}

// PongScene が毎フレーム読むミラー（step 後に wasm から同期する）
class BallView {
  x = W / 2;
  y = H / 2;
  vx = 0;
  vy = 0;
  spin = 0; // ボールの回転（+ は右進ボールを画面下側へ曲げる。演出のみ）
}

export class WasmGame {
  player: { y: number } = { y: H / 2 }; // パドルは中心 y で管理
  ai: { y: number } = { y: H / 2 };
  ball = new BallView();
  keys = { left: false, right: false };
  mouseY = H / 2; // 直近のマウス位置（パドル移動軸のシム座標）
  useMouseFollow = true; // 移動キーで操作するとキー優先に切り替わる
  flowArrows: { x: number; y: number; fx: number; fy: number }[] = []; // コート全面の水流描画用プロブ点（init で一度だけ配置）

  private ex: SimExports | null = null;
  private pendingServeDir: number | null = null; // wasm 読み込み完了前の prepareServe を保持

  constructor() {
    void this.init();
  }

  private init(): Promise<void> {
    return (
      loadWasm()
        .then((ex) => {
          this.ex = ex;
          // コート全面 [0, W] × [0, H] を FLOW_COLS×FLOW_ROWS の固定プロブで均等分割（一度だけ）
          for (let i = 0; i < FLOW_COLS; i++) {
            for (let j = 0; j < FLOW_ROWS; j++) {
              this.flowArrows.push({
                x: ((i + 0.5) * W) / FLOW_COLS,
                y: ((j + 0.5) * H) / FLOW_ROWS,
                fx: 0,
                fy: 0,
              });
            }
          }
          if (this.pendingServeDir !== null) {
            ex.prepare_serve(this.pendingServeDir); // 読み込み待ちのサーブをここに適用
            this.pendingServeDir = null;
          }
          this.sync();
        })
        .catch((err) => {
          // 失敗は loadWasm が既にログ出力済み。ここで握りつぶさないと未処理リジェクションになる
          console.error("[wasmSim] シムの読み込みに失敗したためゲームを開始できません:", err);
        })
    );
  }

  // 決定的リプレイ用のシード固定（0 は sim.mbt 側でデフォルトに置換される）
  seed(s: number): void {
    const ex = this.ex;
    if (ex) ex.seed(s);
  }

  centerPaddles(): void {
    // startGame と同一: 両パドルを中央に戻す
    const ex = this.ex;
    if (ex) {
      ex.center_paddles();
      this.sync();
    } else {
      // wasm 読み込み前は TS 側ミラーのみ初期値に（init の sync が上書きする）
      this.player.y = H / 2;
      this.ai.y = H / 2;
    }
  }

  prepareServe(dir?: number): void {
    const d = dir ?? 0; // 0 = ランダム方向（Game.prepareServe の `dir ||` 相当）
    const ex = this.ex;
    if (ex) {
      ex.prepare_serve(d);
    } else {
      this.pendingServeDir = d; // wasm 読み込み後に適用する
    }
    // ボールは中央待機中：シーンが即座に正しい位置を描けるようミラーも同期
    this.ball.x = W / 2;
    this.ball.y = H / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.spin = 0; // prepare_serve がスピンをリセットするのと同一
  }

  // ---- スコア（権威は wasm。JS は表示用に読取・リセットのみ）----
  pScore(): number {
    return this.ex ? this.ex.p_score() : 0;
  }

  aScore(): number {
    return this.ex ? this.ex.a_score() : 0;
  }

  resetScores(): void {
    const ex = this.ex;
    if (ex) ex.reset_scores();
  }

  stepSim(difficultyKey: DifficultyKey, now: number, lastTimeRef: LastTimeRef): PointResult | null {
    // dt は Game.stepSim と同一（60fps フレーム換算、最大3をクランプ）
    const dt = Math.min((now - (lastTimeRef.current || now)) / (1000 / 60), 3);
    lastTimeRef.current = now;

    const ex = this.ex;
    if (!ex) return null; // 読み込み前はステップしない（時刻は最新化済み）

    const ev = ex.step(
      DIFF_IDX[difficultyKey],
      dt,
      this.keys.left,
      this.keys.right,
      this.mouseY,
      this.useMouseFollow,
    );
    if (ev & EV_PADDLE_HIT) beep(600, 0.05); // パドルヒット（game.ts と同一）
    if (ev & EV_WALL) beep(420, 0.05); // 壁リバウンド

    let result: PointResult | null = null;
    if (ev & EV_POINT_PLAYER) {
      result = { side: "player", gameOver: !!(ev & EV_GAME_OVER) };
    } else if (ev & EV_POINT_AI) {
      result = { side: "ai", gameOver: !!(ev & EV_GAME_OVER) };
    }
    if (result) beep(180, 0.25, 0.22); // ポイント効果音（旧 pointScored）

    this.sync();
    return result;
  }

  private sync(): void {
    const ex = this.ex!;
    this.ball.x = ex.ball_x();
    this.ball.y = ex.ball_y();
    this.ball.vx = ex.vx();
    this.ball.vy = ex.vy();
    this.ball.spin = ex.spin();
    for (const a of this.flowArrows) {
      a.fx = ex.flow_sample_x(a.x, a.y);
      a.fy = ex.flow_sample_y(a.x, a.y);
    }
    this.player.y = ex.player_y();
    this.ai.y = ex.ai_y();
  }
}
