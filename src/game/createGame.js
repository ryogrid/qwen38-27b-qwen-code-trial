// ===== ゲームのシミュレーション状態と毎フレーム更新ロジック（旧 script.js から移植）=====
import { beep } from "./sound.js";
import {
  W,
  H,
  PADDLE_W,
  PADDLE_H,
  BALL_R,
  PX,
  AX,
  SERVE_DELAY_FRAMES,
  BASE_BALL_SPEED,
  MAX_BALL_SPEED,
  BALL_SPEEDUP,
  PLAYER_SPEED,
  MOUSE_FOLLOW_LERP,
  SERVE_ANGLE_MAX,
  DIFFICULTIES,
} from "./constants.js";

// 新しいゲーム状態を作成（canvas 1つにつき1つのインスタンス）
export function createGame() {
  return {
    player: { y: H / 2 }, // パドルは中心 y で管理
    ai: { y: H / 2, targetY: H / 2 },
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: BASE_BALL_SPEED },
    serveTimer: 0, // ボール発射までの待機フレーム数（<=0 で launchBall）
    serveDir: Math.random() < 0.5 ? -1 : 1, // 次のサーブ方向（-1=プレイヤー側 / +1=AI側）
    aiErrOff: 0, // AI の追跡誤差（サーブごとに乱数化）
    keys: { up: false, down: false },
    mouseY: H / 2, // 直近のマウス y（キャンバス座標）
    useMouseFollow: true, // 移動キーで操作するとキー優先に切り替わる
  };
}

function clampPaddle(p) {
  p.y = Math.max(PADDLE_H / 2, Math.min(H - PADDLE_H / 2, p.y));
}

// ポイント後のサーブ準備：ボールを中央に置き、待機後発射
export function prepareServe(g, dir) {
  g.ball.x = W / 2;
  g.ball.y = H / 2;
  g.ball.vx = 0;
  g.ball.vy = 0;
  g.ball.speed = BASE_BALL_SPEED;
  g.serveTimer = SERVE_DELAY_FRAMES; // 約0.8秒の待機
  g.serveDir = dir || (Math.random() < 0.5 ? -1 : 1);
}

function launchBall(g, d) {
  const angle = (Math.random() * 2 - 1) * SERVE_ANGLE_MAX; // ±36度以内
  g.aiErrOff = (Math.random() * 2 - 1) * d.error;
  g.ball.vx = Math.cos(angle) * g.ball.speed * g.serveDir;
  g.ball.vy = Math.sin(angle) * g.ball.speed;
}

function updatePlayer(g, dt) {
  const speed = PLAYER_SPEED * dt;
  if (g.keys.up) g.player.y -= speed;
  if (g.keys.down) g.player.y += speed;
  if (!g.keys.up && !g.keys.down && g.useMouseFollow) {
    // キー操作がない間はマウス位置へ追従（キーで操作した後は無効）
    g.player.y += (g.mouseY - g.player.y) * Math.min(1, MOUSE_FOLLOW_LERP * dt);
  }
  clampPaddle(g.player);
}

function updateAI(g, d, dt) {
  // ボールが AI 側へ来ている間だけ追跡、そうでなければ中央に戻る
  let targetY = H / 2;
  if (g.serveTimer <= 0 && g.ball.vx > 0) targetY = g.ball.y + g.aiErrOff;

  const dy = targetY - g.ai.y;
  const maxStep = d.aiSpeed * dt;
  if (Math.abs(dy) <= maxStep) {
    g.ai.y = targetY; // 追いついたら瞬時捕捉（旧実装仕様）
  } else {
    g.ai.y += Math.sign(dy) * maxStep;
  }
  clampPaddle(g.ai);
}

// パドル反発：当たった位置で反射角を決め、やや加速（上限あり）
function bounceOffPaddle(g, paddle, isPlayerSide) {
  const rel = (g.ball.y - paddle.y) / (PADDLE_H / 2 + BALL_R); // -1..1 付近
  const angle = (rel * Math.PI) / 3.2; // 最大約56度（旧実装と同じ式）
  g.ball.speed = Math.min(g.ball.speed * BALL_SPEEDUP, MAX_BALL_SPEED); // ヒット毎に加速（上限あり）
  const dir = isPlayerSide ? 1 : -1;
  g.ball.vx = Math.cos(angle) * g.ball.speed * dir;
  g.ball.vy = Math.sin(angle) * g.ball.speed;
  beep(600, 0.05);
}

// ===== canvas 描画（旧 draw() を移植）=====
export function drawGame(ctx, g) {
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
  ctx.fillRect(PX, g.player.y - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  ctx.fillRect(AX, g.ai.y - PADDLE_H / 2, PADDLE_W, PADDLE_H);

  // ボール（待機中は中央に静止表示）
  ctx.beginPath();
  ctx.arc(g.ball.x, g.ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
}

// ===== ゲーム進行（旧 update() / updateBall() を移植）=====
function updateBall(g, dt) {
  const b = g.ball;
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
      b.y >= g.player.y - PADDLE_H / 2 - BALL_R &&
      b.y <= g.player.y + PADDLE_H / 2 + BALL_R) {
    bounceOffPaddle(g, g.player, true);
  }

  // AIパドル（右）との衝突判定
  if (b.vx > 0 &&
      b.x + BALL_R >= AX && b.x < AX + PADDLE_W &&
      b.y >= g.ai.y - PADDLE_H / 2 - BALL_R &&
      b.y <= g.ai.y + PADDLE_H / 2 + BALL_R) {
    bounceOffPaddle(g, g.ai, false);
  }

  // 左右アウト → ポイント
  if (b.x < -BALL_R * 2) return "ai"; // 左アウト：AI の得点
  else if (b.x > W + BALL_R * 2) return "player"; // 右アウト：プレイヤーの得点
  return null;
}

export function stepGame(g, difficultyKey, dt) {
  const d = DIFFICULTIES[difficultyKey] || DIFFICULTIES.medium;

  updatePlayer(g, dt);
  updateAI(g, d, dt);

  if (g.serveTimer > 0) {
    g.serveTimer -= dt;
    if (g.serveTimer <= 0) launchBall(g, d);
  } else {
    const side = updateBall(g, dt);
    if (side) beep(180, 0.25, 0.22); // ポイント効果音（旧 pointScored）
    return side;
  }
  return null;
}

// ゲームループ用：dt は60fpsフレーム相当（最大3をクランプ）
export function stepSim(g, difficultyKey, now, lastTimeRef) {
  const dt = Math.min((now - (lastTimeRef.current || now)) / (1000 / 60), 3);
  lastTimeRef.current = now;
  return stepGame(g, difficultyKey, dt);
}
