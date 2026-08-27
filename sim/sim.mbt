// Pong ゲームのシミュレーション本体（旧 script.js から段階移植した MoonBit 版。ビルド対象は wasm）

///|
// ===== 定数（constants.ts と同じ値。Double = f64 で JS number と完全に一致） =====

const W_D : Double = 900.0 // キャンバス幅

///|
const H_D : Double = 520.0 // キャンバス高さ

///|
const PADDLE_W_D : Double = 14.0

///|
const PADDLE_H_D : Double = 92.0

///|
const BALL_R_D : Double = 8.0
// ポイント後ボール発射までの待機フレーム（約0.8秒、60fps基準）

///|
const SERVE_DELAY_FRAMES_D : Double = 48.0

///|
const BASE_BALL_SPEED_D : Double = 6.5

///|
const MAX_BALL_SPEED_D : Double = 14.0
// パドルヒット毎の速度倍率（MAX_BALL_SPEED で上限）

///|
const BALL_SPEEDUP_D : Double = 1.05
// プレイヤーパドル速度 px/フレーム（60fps基準）

///|
const PLAYER_SPEED_D : Double = 8.0

///|
const MOUSE_FOLLOW_LERP_D : Double = 0.25

// パドルの x 座標（constants.ts の PX / AX と同一）

///|
const PX_D : Double = 26.0 // プレイヤーパドル左端

///|
const AX_D : Double = W_D - 26.0 - PADDLE_W_D // AIパドル左端（=860）

// サーブ角度の範囲 ±36度（旧実装と同一挙動）

///|
const SERVE_ANGLE_MAX_D : Double = @math.PI / 5.0

///|
// ===== RNG（決定的 xorshift32。seed() でシード固定可） =====

const DEFAULT_SEED : UInt = 0x1F123BB5

///|
const U32_RANGE_D : Double = 4294967296.0 // 2^32

///|
fn xorshift(s : UInt) -> UInt {
  let mut x = s
  x = x ^ (x << 13)
  x = x ^ (x >> 17)
  x = x ^ (x << 5)
  x
}

// Math.random() 相当の [0,1) 乱数（決定的リプレイ・録画用）

///|
fn rnd() -> Double {
  let s : UInt = xorshift(g.rng_state)
  g.rng_state = s
  s.to_double() / U32_RANGE_D
}

///|
// ===== ゲーム状態（TS の Game インスタンス相当。アプリ全体で g 1つのみ） =====

priv struct Sim {
  mut ball_x : Double // ボール中心 x
  mut ball_y : Double // ボール中心 y
  mut vx : Double // 水平速度
  mut vy : Double // 垂直速度
  mut speed : Double // ボール現在速度（パドル当たりで加速）
  mut player_y : Double // プレイヤーパドル中心 y
  mut ai_y : Double // AI パドル中心 y
  mut serve_timer : Double // ボール発射までの待機フレーム（<=0 で launch）
  mut serve_dir : Double // 次のサーブ方向（-1=プレイヤー側 / +1=AI側）
  mut ai_err_off : Double // AI の追跡誤差（サーブごとに乱数化）
  mut rng_state : UInt // 乱数状態（xorshift32。非ゼロを保証）
  mut p_score : Int // プレイヤー得点（勝敗判定の権威はこのモジュール側）
  mut a_score : Int // AI 得点
}

// 新しいゲーム状態（TS `new Game()` と同一の初期値）。
// ただし TS コンストラクタはここで serveDir を乱数化するが、Module 初期化で
// 乱数を消費しないよう prepare_serve(0.0) の実行時まで先送りする。

///|
fn make_sim() -> Sim {
  Sim::{
    ball_x: W_D / 2,
    ball_y: H_D / 2,
    vx: 0.0,
    vy: 0.0,
    speed: BASE_BALL_SPEED_D,
    player_y: H_D / 2,
    ai_y: H_D / 2,
    serve_timer: 0.0, // TS コンストラクタも 0（実際の待機は prepareServe で開始）
    serve_dir: 1.0,
    ai_err_off: 0.0,
    rng_state: DEFAULT_SEED,
    p_score: 0,
    a_score: 0,
  }
}

///|
let g : Sim = make_sim()

///|
// ===== 公開 API（TS 側 wasm facade から呼ばれる） =====

// 任意のシードを均一に拡散させる（splitmix32 の finalizer）。
// 特に小さな整数シードでは xorshift の初期状態上位ビットが空っぽになるのを防ぐ。
fn mix32(x : UInt) -> UInt {
  let mut z = x + 0x9E3779B9
  z = (z ^ (z >> 16)) * 0x85EBCA6B
  z = (z ^ (z >> 13)) * 0xC2B2AE35
  z ^ (z >> 16)
}

///|
pub fn seed(s : Int) -> Unit {
  // シード固定。xorshift の 0 は無効なためデフォルトに置換する
  g.rng_state = mix32(
    if s == 0 {
      DEFAULT_SEED
    } else {
      s.reinterpret_as_uint()
    },
  )
}

///|
pub fn prepare_serve(dir : Double) -> Unit {
  // TS Game.prepareServe と同一: dir が 0 の場合はランダム方向（JS `dir ||` 相当）
  g.ball_x = W_D / 2
  g.ball_y = H_D / 2
  g.vx = 0.0
  g.vy = 0.0
  g.speed = BASE_BALL_SPEED_D // resetToCenter() は speed も BASE に戻す（旧実装と同一）
  g.serve_timer = SERVE_DELAY_FRAMES_D
  g.serve_dir = if dir == 0.0 {
    if rnd() < 0.5 {
      -1.0
    } else {
      1.0
    }
  } else {
    dir
  }
}

///|
pub fn center_paddles() -> Unit {
  // TS startGame と同一: 両パドルを中央に戻す
  g.player_y = H_D / 2
  g.ai_y = H_D / 2
}

// イベントビット（step の戻り値。TS 側で効果音・スコア処理に使用）

///|
pub const EV_PADDLE_HIT : Int = 1 // パドルヒット（600Hz beep）

///|
pub const EV_WALL : Int = 2 // 上下壁リバウンド（420Hz beep）

///|
pub const EV_POINT_PLAYER : Int = 4 // プレイヤー得点（ボール右アウト。180Hz beep）

///|
pub const EV_POINT_AI : Int = 8 // AI 得点（ボール左アウト。180Hz beep）

///|
pub const EV_GAME_OVER : Int = 16 // 勝敗決着（片方が WIN_SCORE に到達した同一フレームにポイントビットと同時返却）

///|
// 勝利に必要なポイント数（constants.ts の WIN_SCORE と同値。ロジック権威はここ側）
pub const WIN_SCORE : Int = 5

// 1フレームのシミュレーション。旧実装（script.js）の step() と同一ロジック・同一順序。
// dt は呼び出し側が (now - lastTime) / (1000/60) を上限3でクランプした値を渡す（stepSim 相当）。

///|
pub fn step(
  idx : Int,
  dt : Double,
  key_left : Bool,
  key_right : Bool,
  mouse_y : Double,
  use_mouse_follow : Bool,
) -> Int {
  // DIFFICULTIES の参照。未知の idx は medium にフォールバック（TS `|| DIFFICULTIES.medium` と同一）
  let ai_speed_ = if idx == 0 { 3.4 } else if idx == 2 { 6.4 } else { 4.6 }
  let ai_error_ = if idx == 0 { 52.0 } else if idx == 2 { 10.0 } else { 28.0 }

  update_player(dt, key_left, key_right, mouse_y, use_mouse_follow)
  update_ai(ai_speed_, dt)

  let mut ev : Int = 0
  if g.serve_timer > 0 {
    g.serve_timer -= dt
    if g.serve_timer <= 0 {
      launch_ball(ai_error_)
    }
  } else {
    ev = update_ball(dt)
  }
  ev
}

///|
pub fn ball_x() -> Double {
  g.ball_x
}

///|
pub fn ball_y() -> Double {
  g.ball_y
}

///|
pub fn player_y() -> Double {
  g.player_y
}

///|
pub fn ai_y() -> Double {
  g.ai_y
}

///|
pub fn vx() -> Double {
  g.vx
}

///|
pub fn vy() -> Double {
  g.vy
}

// スコア読み取り（JS 側は表示のみ。権威はこのモジュール側）

///|
pub fn p_score() -> Int {
  g.p_score
}

///|
pub fn a_score() -> Int {
  g.a_score
}

// Game start/restart (TS's `scores = [0,0]` equivalent): zero out both sides' scores

///|
pub fn reset_scores() -> Unit {
  g.p_score = 0
  g.a_score = 0
}

///|
// ===== 内部処理（旧実装 script.js の private メソッド相当） =====

fn clamp_paddle_y(y : Double) -> Double {
  // Paddle.clamp() と同一の式: max(PADDLE_H/2, min(H - PADDLE_H/2, y))
  let lo = PADDLE_H_D / 2
  let hi = H_D - PADDLE_H_D / 2
  if y < lo {
    lo
  } else if y > hi {
    hi
  } else {
    y
  }
}

///|
fn update_player(
  dt : Double,
  key_left : Bool,
  key_right : Bool,
  mouse_y : Double,
  use_mouse_follow : Bool,
) -> Unit {
  let speed = PLAYER_SPEED_D * dt
  // left = sim.y 減少側、right = 増加側（3D では左右 X）
  if key_left {
    g.player_y -= speed
  }
  if key_right {
    g.player_y += speed
  }
  if !key_left && !key_right && use_mouse_follow {
    // キー操作がない間はマウス位置へ追従（キーで操作した後は無効）
    let k = MOUSE_FOLLOW_LERP_D * dt
    g.player_y += (mouse_y - g.player_y) * (if k < 1.0 { k } else { 1.0 })
  }
  g.player_y = clamp_paddle_y(g.player_y)
}

///|
fn update_ai(ai_speed_ : Double, dt : Double) -> Unit {
  // ボールが AI 側へ来ている間だけ追跡、そうでなければ中央に戻る
  let mut target_y : Double = H_D / 2
  if g.serve_timer <= 0 && g.vx > 0 {
    target_y = g.ball_y + g.ai_err_off
  }

  let dy = target_y - g.ai_y
  let max_step = ai_speed_ * dt
  if abs_d(dy) <= max_step {
    g.ai_y = target_y // 追いついたら瞬時捕捉（旧実装仕様）
  } else {
    g.ai_y += (if dy > 0.0 { 1.0 } else { -1.0 }) * max_step
  }
  g.ai_y = clamp_paddle_y(g.ai_y)
}

///|
fn abs_d(x : Double) -> Double {
  if x < 0.0 {
    -x
  } else {
    x
  }
}

// パドル反発：当たった位置で反射角を決め、やや加速（上限あり）

///|
fn bounce_off_paddle(pad_y : Double, is_player_side : Bool) -> Unit {
  let rel = (g.ball_y - pad_y) / (PADDLE_H_D / 2 + BALL_R_D) // -1..1 付近
  let angle = rel * @math.PI / 3.2 // 最大約56度（旧実装と同じ式）
  let sp = g.speed * BALL_SPEEDUP_D
  g.speed = if sp > MAX_BALL_SPEED_D { MAX_BALL_SPEED_D } else { sp } // ヒット毎に加速（上限あり）
  let dir : Double = if is_player_side { 1.0 } else { -1.0 }
  g.vx = @math.cos(angle) * g.speed * dir
  g.vy = @math.sin(angle) * g.speed
}

// ポイント後のサーブ発射（launchBall）。ai_err_off はここで乱数化する

///|
fn launch_ball(ai_error_ : Double) -> Unit {
  let angle = (rnd() * 2.0 - 1.0) * SERVE_ANGLE_MAX_D // ±36度以内
  g.ai_err_off = (rnd() * 2.0 - 1.0) * ai_error_
  g.vx = @math.cos(angle) * g.speed * g.serve_dir
  g.vy = @math.sin(angle) * g.speed
}

///|
fn update_ball(dt : Double) -> Int {
  let mut ev : Int = 0
  g.ball_x += g.vx * dt
  g.ball_y += g.vy * dt

  // 上下壁のリバウンド（旧実装と同じ if / else-if 構造で、1フレームの二重リバウンドを防ぐ）
  if g.ball_y - BALL_R_D <= 0.0 && g.vy < 0.0 {
    g.ball_y = BALL_R_D
    g.vy = -g.vy
    ev = ev | EV_WALL
  } else if g.ball_y + BALL_R_D >= H_D && g.vy > 0.0 {
    g.ball_y = H_D - BALL_R_D
    g.vy = -g.vy
    ev = ev | EV_WALL
  }

  // プレイヤーパドル（左）との衝突判定
  if g.vx < 0.0 &&
    g.ball_x - BALL_R_D <= PX_D + PADDLE_W_D &&
    g.ball_x > PX_D &&
    g.ball_y >= g.player_y - PADDLE_H_D / 2 - BALL_R_D &&
    g.ball_y <= g.player_y + PADDLE_H_D / 2 + BALL_R_D {
    bounce_off_paddle(g.player_y, true)
    ev = ev | EV_PADDLE_HIT
  }

  // AIパドル（右）との衝突判定
  if g.vx > 0.0 &&
    g.ball_x + BALL_R_D >= AX_D &&
    g.ball_x < AX_D + PADDLE_W_D &&
    g.ball_y >= g.ai_y - PADDLE_H_D / 2 - BALL_R_D &&
    g.ball_y <= g.ai_y + PADDLE_H_D / 2 + BALL_R_D {
    bounce_off_paddle(g.ai_y, false)
    ev = ev | EV_PADDLE_HIT
  }

  // 左右アウト → ポイント（得点側はビットで区別。勝敗判定もここで行う）
  if g.ball_x < -BALL_R_D * 2 {
    return add_point(false, EV_POINT_AI) // 左アウト：AI の得点
  } else if g.ball_x > W_D + BALL_R_D * 2 {
    return add_point(true, EV_POINT_PLAYER) // 右アウト：プレイヤーの得点
  }

  ev
}

// ポイント加算と勝敗判定（勝敗が決まったら EV_GAME_OVER を併せて返す）

///|
fn add_point(player_side : Bool, bit : Int) -> Int {
  if player_side {
    g.p_score += 1
  } else {
    g.a_score += 1
  }
  let mut ev = bit
  if g.p_score >= WIN_SCORE || g.a_score >= WIN_SCORE {
    ev = ev | EV_GAME_OVER
  }
  ev
}
