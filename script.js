"use strict";

// ===== 基本設定 =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;   // 900
const H = canvas.height;  // 520

const PADDLE_W = 14;
const PADDLE_H = 92;
const BALL_R = 8;
const WIN_SCORE = 5;
const PX = 26;                    // プレイヤーパドルの x（左端）
const AX = W - 26 - PADDLE_W;     // AIパドルの x（右端）

const DIFFICULTIES = {
  easy:   { aiSpeed: 3.4, error: 52 },
  medium: { aiSpeed: 4.6, error: 28 },
  hard:   { aiSpeed: 6.4, error: 10 },
};

// ===== ゲーム状態 =====
let state = "menu"; // menu | playing | paused | gameover
let difficulty = "medium";
let playerScore = 0;
let aiScore = 0;
let soundOn = true;
let serveTimer = 0;      // ポイント後のボール待機フレーム数
let serveDir = Math.random() < 0.5 ? -1 : 1;

const player = { y: H / 2 }; // パドルは中心 y で管理
const ai     = { y: H / 2, targetY: H / 2 };
const ball   = { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: 6.5 };

// ===== サウンド（Web Audio）=====
let audioCtx = null;

function beep(freq, dur = 0.06, vol = 0.18) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) { /* オーディオ不可時は無音で続行 */ }
}

// ===== UI 参照 =====
const elMenu = document.getElementById("menu");
const elPause = document.getElementById("pause-overlay");
const elOver = document.getElementById("gameover");
const elPlayerScore = document.getElementById("player-score");
const elAiScore = document.getElementById("ai-score");
const elResultTitle = document.getElementById("result-title");
const elFinalScore = document.getElementById("final-score");

function showOverlay(el) {
  for (const o of [elMenu, elPause, elOver]) o.classList.remove("visible");
  if (el) el.classList.add("visible");
}

function updateScores() {
  elPlayerScore.textContent = playerScore;
  elAiScore.textContent = aiScore;
}

// ===== 入力 =====
const keys = { up: false, down: false };
let mouseY = H / 2;
let useMouseFollow = true; // マウス追従の可否（移動キーで操作するとキー優先に切り替わる）

window.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowUp": case "w": case "W": keys.up = true; useMouseFollow = false; break;
    case "ArrowDown": case "s": case "S": keys.down = true; useMouseFollow = false; break;
    case "p": case "P": case "Escape": togglePause(); break;
    case "m": case "M": soundOn = !soundOn; break;
    case "Enter":
      if (state === "menu" || state === "gameover") startGame();
      else if (state === "paused") togglePause();
      break;
  }
});

window.addEventListener("keyup", (e) => {
  switch (e.key) {
    case "ArrowUp": case "w": case "W": keys.up = false; break;
    case "ArrowDown": case "s": case "S": keys.down = false; break;
  }
});

// マウス移動（キャンバスの縦方向に追従）
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseY = ((e.clientY - rect.top) / rect.height) * H;
});

document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("restart-btn").addEventListener("click", () => startGame());

// 難易度ボタン
const diffBtns = document.querySelectorAll(".difficulty button");
diffBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    diffBtns.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    difficulty = btn.dataset.level;
  });
});

// ===== ゲーム制御 =====
function startGame() {
  playerScore = 0;
  aiScore = 0;
  updateScores();
  player.y = H / 2;
  ai.y = H / 2;
  useMouseFollow = true; // ゲーム開始時はマウス追従を有効化
  state = "playing";
  showOverlay(null);
  serveDir = Math.random() < 0.5 ? -1 : 1;
  prepareServe();
}

// ポイント後のサーブ準備：ボールを中央に置き、待機後発射
function prepareServe() {
  ball.x = W / 2;
  ball.y = H / 2;
  ball.vx = 0;
  ball.vy = 0;
  ball.speed = 6.5;
  serveTimer = 48; // 約0.8秒の待機
}

function launchBall() {
  const angle = (Math.random() * 2 - 1) * Math.PI / 5; // ±36度以内
  aiErrOff = (Math.random() * 2 - 1) * DIFFICULTIES[difficulty].error;
  ball.vx = Math.cos(angle) * ball.speed * serveDir;
  ball.vy = Math.sin(angle) * ball.speed;
}

function togglePause() {
  if (state === "playing") {
    state = "paused";
    showOverlay(elPause);
  } else if (state === "paused") {
    state = "playing";
    showOverlay(null);
  }
}

function pointScored(side) { // side: "player" | "ai"
  if (side === "player") playerScore++; else aiScore++;
  updateScores();
  beep(180, 0.25, 0.22);

  if (playerScore >= WIN_SCORE || aiScore >= WIN_SCORE) {
    state = "gameover";
    elResultTitle.textContent = playerScore > aiScore ? "YOU WIN!" : "CPU WINS!";
    elFinalScore.textContent = `${playerScore} - ${aiScore}`;
    showOverlay(elOver);
  } else {
    // 失点した側へサーブ（ボールは失点側に飛び出す）
    serveDir = side === "player" ? 1 : -1;
    prepareServe();
  }
}

// ===== 更新処理 =====
let aiErrOff = 0; // AI の追跡誤差（サーブごとに乱数化）

function clampPaddle(p) {
  p.y = Math.max(PADDLE_H / 2, Math.min(H - PADDLE_H / 2, p.y));
}

function updatePlayer(dt) {
  const speed = 8 * dt;
  if (keys.up) player.y -= speed;
  if (keys.down) player.y += speed;
  if (!keys.up && !keys.down && useMouseFollow) {
    // キー操作がない間はマウス位置へ追従（キーで操作した後は無効）
    player.y += (mouseY - player.y) * Math.min(1, 0.25 * dt);
  }
  clampPaddle(player);
}

function updateAI(dt) {
  const d = DIFFICULTIES[difficulty];
  // ボールが AI 側へ来ている間だけ追跡、そうでなければ中央に戻る
  let targetY = H / 2;
  if (serveTimer <= 0 && ball.vx > 0) targetY = ball.y + aiErrOff;

  const dy = targetY - ai.y;
  const maxStep = d.aiSpeed * dt;
  if (Math.abs(dy) <= maxStep) ai.y = targetY;
  else ai.y += Math.sign(dy) * maxStep;
  clampPaddle(ai);
}

function bounceOffPaddle(paddle, isPlayerSide) {
  const rel = (ball.y - paddle.y) / (PADDLE_H / 2 + BALL_R); // -1..1 付近
  const angle = rel * Math.PI / 3.2;                         // 最大約56度
  ball.speed = Math.min(ball.speed * 1.05, 14);              // ヒット毎に加速（上限あり）
  const dir = isPlayerSide ? 1 : -1;
  ball.vx = Math.cos(angle) * ball.speed * dir;
  ball.vy = Math.sin(angle) * ball.speed;
  beep(600, 0.05);
}

function updateBall(dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // 上下壁のリバウンド
  if (ball.y - BALL_R <= 0 && ball.vy < 0) {
    ball.y = BALL_R; ball.vy *= -1; beep(420, 0.05);
  } else if (ball.y + BALL_R >= H && ball.vy > 0) {
    ball.y = H - BALL_R; ball.vy *= -1; beep(420, 0.05);
  }

  // プレイヤーパドル（左）との衝突判定
  if (ball.vx < 0 &&
      ball.x - BALL_R <= PX + PADDLE_W && ball.x > PX &&
      ball.y >= player.y - PADDLE_H / 2 - BALL_R &&
      ball.y <= player.y + PADDLE_H / 2 + BALL_R) {
    bounceOffPaddle(player, true);
  }

  // AIパドル（右）との衝突判定
  if (ball.vx > 0 &&
      ball.x + BALL_R >= AX && ball.x < AX + PADDLE_W &&
      ball.y >= ai.y - PADDLE_H / 2 - BALL_R &&
      ball.y <= ai.y + PADDLE_H / 2 + BALL_R) {
    bounceOffPaddle(ai, false);
  }

  // 左右アウト → ポイント
  if (ball.x < -BALL_R * 2) pointScored("ai");             // 左アウト：AI の得点
  else if (ball.x > W + BALL_R * 2) pointScored("player"); // 右アウト：プレイヤーの得点
}

function update(dt) {
  updatePlayer(dt);
  updateAI(dt);

  if (serveTimer > 0) {
    serveTimer -= dt;
    if (serveTimer <= 0) launchBall();
  } else {
    updateBall(dt);
  }
}

// ===== 描画 =====
function draw() {
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
  ctx.fillRect(PX, player.y - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  ctx.fillRect(AX, ai.y - PADDLE_H / 2, PADDLE_W, PADDLE_H);

  // ボール（待機中は中央に静止表示）
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
}

// ===== メインループ =====
let lastTime = performance.now();

function frame(now) {
  const dt = Math.min((now - lastTime) / (1000 / 60), 3); // 60fps 基準のdt（最大で3倍まで補正）
  lastTime = now;

  if (state === "playing") update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ===== 起動 =====
updateScores();
showOverlay(elMenu);
requestAnimationFrame((t) => { lastTime = t; frame(t); });
