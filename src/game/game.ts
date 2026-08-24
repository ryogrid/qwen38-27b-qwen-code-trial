// ===== ゲームのシミュレーション状態と毎フレーム更新ロジック（旧 script.js から移植）=====
import { beep } from "./sound";
import type { DifficultyKey } from "./constants";
import {
  W,
  H,
  PADDLE_W,
  PADDLE_H,
  BALL_R,
  PX,
  AX,
  SERVE_DELAY_FRAMES,
  MAX_BALL_SPEED,
  BALL_SPEEDUP,
  PLAYER_SPEED,
  MOUSE_FOLLOW_LERP,
  SERVE_ANGLE_MAX,
  DIFFICULTIES,
} from "./constants";
import { Paddle, AIPaddle } from "./paddle";
import { Ball } from "./ball";

export type Side = "player" | "ai";

// ゲームループ用：dt は60fpsフレーム相当（最大3をクランプ）に使う参照
export interface LastTimeRef {
  current: number;
}

type DifficultyDef = (typeof DIFFICULTIES)[DifficultyKey];

export class Game {
  player: Paddle; // パドルは中心 y で管理
  ai: AIPaddle;
  ball: Ball;
  serveTimer: number; // ボール発射までの待機フレーム数（<=0 で launchBall）
  serveDir: number; // 次のサーブ方向（-1=プレイヤー側 / +1=AI側）
  aiErrOff: number; // AI の追跡誤差（サーブごとに乱数化）
  keys = { up: false, down: false };
  mouseY = H / 2; // 直近のマウス y（キャンバス座標）
  useMouseFollow = true; // 移動キーで操作するとキー優先に切り替わる

  constructor() {
    // 新しいゲーム状態を作成（canvas 1つにつき1つのインスタンス）
    this.player = new Paddle();
    this.ai = new AIPaddle();
    this.ball = new Ball();
    this.serveTimer = 0; // ボール発射までの待機フレーム数（<=0 で launchBall）
    this.serveDir = Math.random() < 0.5 ? -1 : 1; // 次のサーブ方向（-1=プレイヤー側 / +1=AI側）
    this.aiErrOff = 0; // AI の追跡誤差（サーブごとに乱数化）
  }

  // ポイント後のサーブ準備：ボールを中央に置き、待機後発射
  prepareServe(dir?: number): void {
    this.ball.resetToCenter();
    this.serveTimer = SERVE_DELAY_FRAMES; // 約0.8秒の待機
    this.serveDir = dir || (Math.random() < 0.5 ? -1 : 1);
  }

  step(difficultyKey: DifficultyKey, dt: number): Side | null {
    const d = DIFFICULTIES[difficultyKey] || DIFFICULTIES.medium;

    this.updatePlayer(dt);
    this.updateAI(d, dt);

    if (this.serveTimer > 0) {
      this.serveTimer -= dt;
      if (this.serveTimer <= 0) this.launchBall(d);
    } else {
      const side = this.updateBall(dt);
      if (side) beep(180, 0.25, 0.22); // ポイント効果音（旧 pointScored）
      return side;
    }
    return null;
  }

  stepSim(difficultyKey: DifficultyKey, now: number, lastTimeRef: LastTimeRef): Side | null {
    const dt = Math.min((now - (lastTimeRef.current || now)) / (1000 / 60), 3);
    lastTimeRef.current = now;
    return this.step(difficultyKey, dt);
  }

  // ===== canvas 描画（旧 draw() を移植）=====
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // 中央の点線
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 16]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // パドル
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(PX, this.player.y - PADDLE_H / 2, PADDLE_W, PADDLE_H);
    ctx.fillRect(AX, this.ai.y - PADDLE_H / 2, PADDLE_W, PADDLE_H);

    // ボール（待機中は中央に静止表示）
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  }

  private launchBall(d: DifficultyDef): void {
    const angle = (Math.random() * 2 - 1) * SERVE_ANGLE_MAX; // ±36度以内
    this.aiErrOff = (Math.random() * 2 - 1) * d.error;
    this.ball.vx = Math.cos(angle) * this.ball.speed * this.serveDir;
    this.ball.vy = Math.sin(angle) * this.ball.speed;
  }

  private updatePlayer(dt: number): void {
    const speed = PLAYER_SPEED * dt;
    if (this.keys.up) this.player.y -= speed;
    if (this.keys.down) this.player.y += speed;
    if (!this.keys.up && !this.keys.down && this.useMouseFollow) {
      // キー操作がない間はマウス位置へ追従（キーで操作した後は無効）
      this.player.y += (this.mouseY - this.player.y) * Math.min(1, MOUSE_FOLLOW_LERP * dt);
    }
    this.player.clamp();
  }

  private updateAI(d: DifficultyDef, dt: number): void {
    // ボールが AI 側へ来ている間だけ追跡、そうでなければ中央に戻る
    let targetY = H / 2;
    if (this.serveTimer <= 0 && this.ball.vx > 0) targetY = this.ball.y + this.aiErrOff;

    const dy = targetY - this.ai.y;
    const maxStep = d.aiSpeed * dt;
    if (Math.abs(dy) <= maxStep) {
      this.ai.y = targetY; // 追いついたら瞬時捕捉（旧実装仕様）
    } else {
      this.ai.y += Math.sign(dy) * maxStep;
    }
    this.ai.clamp();
  }

  // パドル反発：当たった位置で反射角を決め、やや加速（上限あり）
  private bounceOffPaddle(paddle: Paddle, isPlayerSide: boolean): void {
    const rel = (this.ball.y - paddle.y) / (PADDLE_H / 2 + BALL_R); // -1..1 付近
    const angle = (rel * Math.PI) / 3.2; // 最大約56度（旧実装と同じ式）
    this.ball.speed = Math.min(this.ball.speed * BALL_SPEEDUP, MAX_BALL_SPEED); // ヒット毎に加速（上限あり）
    const dir = isPlayerSide ? 1 : -1;
    this.ball.vx = Math.cos(angle) * this.ball.speed * dir;
    this.ball.vy = Math.sin(angle) * this.ball.speed;
    beep(600, 0.05);
  }

  private updateBall(dt: number): Side | null {
    const b = this.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // 上下壁のリバウンド
    if (b.y - BALL_R <= 0 && b.vy < 0) {
      b.y = BALL_R;
      b.vy *= -1;
      beep(420, 0.05);
    } else if (b.y + BALL_R >= H && b.vy > 0) {
      b.y = H - BALL_R;
      b.vy *= -1;
      beep(420, 0.05);
    }

    // プレイヤーパドル（左）との衝突判定
    if (b.vx < 0 &&
        b.x - BALL_R <= PX + PADDLE_W && b.x > PX &&
        b.y >= this.player.y - PADDLE_H / 2 - BALL_R &&
        b.y <= this.player.y + PADDLE_H / 2 + BALL_R) {
      this.bounceOffPaddle(this.player, true);
    }

    // AIパドル（右）との衝突判定
    if (b.vx > 0 &&
        b.x + BALL_R >= AX && b.x < AX + PADDLE_W &&
        b.y >= this.ai.y - PADDLE_H / 2 - BALL_R &&
        b.y <= this.ai.y + PADDLE_H / 2 + BALL_R) {
      this.bounceOffPaddle(this.ai, false);
    }

    // 左右アウト → ポイント
    if (b.x < -BALL_R * 2) return "ai"; // 左アウト：AI の得点
    else if (b.x > W + BALL_R * 2) return "player"; // 右アウト：プレイヤーの得点
    return null;
  }
}
