// ===== wasm シミュレーションブリッジ =====
// MoonBit で書き直したシム本体（sim/sim.mbt → sim.wasm）を読み込み、
// game.ts の Game と同じインターフェースを模して提供する。
// 乱数は wasm 内部の xorshift32（seed() で固定可）。決定的リプレイ用。

import { W, H } from "./constants";
import type { DifficultyKey } from "./constants";
import { beep } from "./sound";
import simWasmUrl from "../../sim/_build/wasm/release/build/sim.wasm?url";

export type Side = "player" | "ai";

// ゲームループ用：dt は60fpsフレーム相当（最大3をクランプ）に使う参照（Game.stepSim と同一）
export interface LastTimeRef {
  current: number;
}

// イベントビット（sim.mbt の EV_* と一致させること）
const EV_PADDLE_HIT = 1; // パドルヒット（600Hz beep）
const EV_WALL = 2; // 上下壁リバウンド（420Hz beep）
const EV_POINT_PLAYER = 4; // プレイヤー得点（ボール右アウト。180Hz beep）
const EV_POINT_AI = 8; // AI 得点（ボール左アウト。180Hz beep）

// DifficultyKey → sim.mbt の DIFFICULTIES インデックス（easy/medium/hard の順で一致させること）
const DIFF_IDX: Record<DifficultyKey, number> = { easy: 0, medium: 1, hard: 2 };

interface SimExports {
  seed(s: number): void;
  prepare_serve(dir: number): void;
  center_paddles(): void;
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
}

// wasm はモジュールグローバルな単一シミュレーション状態を持つ（アプリ全体で1つのみ）
let loadPromise: Promise<SimExports> | null = null;

function loadWasm(): Promise<SimExports> {
  if (!loadPromise) {
    loadPromise = fetch(simWasmUrl)
      .then((r) => r.arrayBuffer())
      .then(async (buf) => {
        const instance = new WebAssembly.Instance(new WebAssembly.Module(buf), {});
        return instance.exports as unknown as SimExports;
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
}

export class WasmGame {
  player: { y: number } = { y: H / 2 }; // パドルは中心 y で管理
  ai: { y: number } = { y: H / 2 };
  ball = new BallView();
  keys = { left: false, right: false };
  mouseY = H / 2; // 直近のマウス位置（パドル移動軸のシム座標）
  useMouseFollow = true; // 移動キーで操作するとキー優先に切り替わる

  private ex: SimExports | null = null;
  private pendingServeDir: number | null = null; // wasm 読み込み完了前の prepareServe を保持

  constructor() {
    void this.init();
  }

  private init(): Promise<void> {
    return loadWasm().then((ex) => {
      this.ex = ex;
      if (this.pendingServeDir !== null) {
        ex.prepare_serve(this.pendingServeDir); // 読み込み待ちのサーブをここに適用
        this.pendingServeDir = null;
      }
      this.sync();
    });
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
  }

  stepSim(difficultyKey: DifficultyKey, now: number, lastTimeRef: LastTimeRef): Side | null {
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

    let side: Side | null = null;
    if (ev & EV_POINT_PLAYER) side = "player";
    else if (ev & EV_POINT_AI) side = "ai";
    if (side) beep(180, 0.25, 0.22); // ポイント効果音（旧 pointScored）

    this.sync();
    return side;
  }

  private sync(): void {
    const ex = this.ex!;
    this.ball.x = ex.ball_x();
    this.ball.y = ex.ball_y();
    this.ball.vx = ex.vx();
    this.ball.vy = ex.vy();
    this.player.y = ex.player_y();
    this.ai.y = ex.ai_y();
  }
}
