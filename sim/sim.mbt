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

///|
const MIN_BALL_SPEED_D : Double = 3.0 // ボール合成速度 |v| の下限 px/フレーム（BASE の半減。水流で大幅減速しても動き続ける）
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

// ===== A: スピン／マグヌス効果の調整値（px/フレーム@60fps 基準。既存速度定数と同一単位） =====

///|
const SPIN_TRANSFER_D : Double = 0.19 // パドル接触時の「パドル速度→スピン」換算ゲイン

///|
const SPIN_MAX_D : Double = 1.5 // |spin| の上限（付与時にクランプ）

///|
const SPIN_SOURCE_MAX_D : Double = 12.0 // スピンの入力源として扱うパドル速度の上限（px/フレーム、マウス急動を飽和させる）

///|
const MAGNUS_K_D : Double = 0.005 // マグヌス回転率係数：毎フレーム velocity 方向をこれ*spin ラジアンだけ回転

///|
const SPIN_DECAY_RATE_D : Double = 0.004 // 飛行中のスピン減衰率（除算形で dt 大でも安定。半減≈2.9秒）

///|
const WALL_SPIN_KEEP_D : Double = 0.8 // 上下壁リバウンド時のスピン残存率

// ===== W: コート全面ウォーター・水面流れの調整値（px/フレーム@60fps 基準。既存速度定数と同一単位！）=====

///|
const FLUID_N_DEFAULT : Int = 30 // 水面流れ格子の H 方向（縦軸）セル数（step() コストベンチで最終確定）

///|
const FLUID_M_DEFAULT : Int = 52 // W 方向（パドル間 x 軸）セル数（1 セル≈17px、N 方向とほぼ等方）

///|
const FLOW_DIFF_K_D : Double = 0.24 // ジャコビ拡散係数：v ← v + K*(近傍平均 - v)。K ≤ 0.5 で安定

///|
const FLOW_DECAY_RATE_D : Double = 0.010 // 流れの毎フレーム減衰率（除算形、dt 大でも安定。半減≈69フレーム≈1.2秒）

///|
const FLOW_MAX_D : Double = 8.0 // |flow| の上限 px/フレーム@60fps（有界性保証。MAX_BALL_SPEED_D より小さい）

///|
const DRAG_REL_K_D : Double = 0.0072 // コート全面ウォーター用：相対抗力ゲイン（次元なし）。流れ追従の均衡速度≈局所流速の 92%（=K/(K+ABS)）で、ボールは明確に水流に運ばれる。DRAG_ABS_RATE_D と併せ全減衰 λ≈0.0078/フレーム（τ≈128f）、初レターンショット（BASE×SPEEDUP≈6.83px/f）の到達距離≈875px でパドル間≈812px を横断可能

///|
const DRAG_ABS_RATE_D : Double = 0.0006 // 水中での純減衰率（除数形式、半減≈1155フレーム。減速の主役は相対項のため小さめ。球のリバウンド・再開行を妨げない）

///|
const FLOW_STILL_EPS_D : Double = 0.1 // 「水が動いていない」と判定する流速の閾値 px/フレーム（この軸の |flow| がこれ未満ならその軸に抵抗を発生させない＝静水では球は減速しない。減衰は乗算形のため完全なゼロにはならず、厳密比較では静止を検出できない）

///|
const DROP_INTERVAL_MIN_D : Double = 40.0 // ドロップ間隔の下限 フレーム（≈0.7秒。平均≈1.3秒で頻繁に着水する）

///|
const DROP_INTERVAL_VAR_D : Double = 80.0 // ドロップ間隔の乱数幅（次回 = min + rnd()*var、xorshift32 で決定的）

///|
const DROP_RADIUS_D : Double = 96.0 // ドロップ着水の影響半径 px（旧 64 の 1.5 倍で広域攪拌）

///|
const DROP_IMPULSE_D : Double = 5.0 // 着水中心のピーク衝撃 px/フレーム@60fps（直線減衰、FLOW_MAX_D でクランプ）

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
  mut spin : Double // ボールの回転（マグヌス効果。+ は右進ボールを下画面側へ曲げる）
  mut player_vel : Double // プレイヤーパドルの直前フレーム速度 px/フレーム@60fps（スピン付与用）
  mut ai_vel : Double // AI パドルの直前フレーム速度 px/フレーム@60fps（スピン付与用）
  mut fl_n : Int // 水面流れ格子の H 方向（縦軸）セル数（ベンチで最終確定する値）
  mut fl_m : Int // ウォーターバンド内 x 方向奥行き行数
  mut fl_x_a : Array[Double] // 流れ場 x 成分 px/フレーム@60fps。idx = j*fl_n+i
  mut fl_y_a : Array[Double] // 流れ場 y 成分（同上レイアウト）
  mut tmp_x_a : Array[Double] // ジャコビ法スクリッチ（x 成分）
  mut tmp_y_a : Array[Double] // スクリッチ（y 成分）
  mut drop_timer : Double // 次のドロップ着水までのフレーム数（<=0 で発生し再スケジュール）
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
    spin: 0.0,
    player_vel: 0.0,
    ai_vel: 0.0,
    fl_n: FLUID_N_DEFAULT,
    fl_m: FLUID_M_DEFAULT,
    fl_x_a: Array::make(FLUID_N_DEFAULT * FLUID_M_DEFAULT, 0.0),
    fl_y_a: Array::make(FLUID_N_DEFAULT * FLUID_M_DEFAULT, 0.0),
    tmp_x_a: Array::make(FLUID_N_DEFAULT * FLUID_M_DEFAULT, 0.0),
    tmp_y_a: Array::make(FLUID_N_DEFAULT * FLUID_M_DEFAULT, 0.0),
    drop_timer: DROP_INTERVAL_MIN_D + DROP_INTERVAL_VAR_D / 2, // ≈1.3秒後に最初の着水（決定的）
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
  // A: 同じシードから同じ「スピン」の状態を再現するため、
  // 前回実行の残り（リプレイ再開・テスト間の分離）を初期値に戻す
  g.spin = 0.0
  g.player_vel = 0.0
  g.ai_vel = 0.0
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT) // 水面を無垢に（+ ドロップスケジューラも決定的にリセット）
}

///|
pub fn prepare_serve(dir : Double) -> Unit {
  // TS Game.prepareServe と同一: dir が 0 の場合はランダム方向（JS `dir ||` 相当）
  g.ball_x = W_D / 2
  g.ball_y = H_D / 2
  g.vx = 0.0
  g.vy = 0.0
  g.speed = BASE_BALL_SPEED_D // resetToCenter() は speed も BASE に戻す（旧実装と同一）
  g.spin = 0.0 // ポイント毎にスピンは持ち越さない
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

  update_fluid(dt) // W: サーブ待機中も水面は進む（ポイント間の間欠でも連続する）
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

// 現在の球のスピン（+ は右進ボールを画面下側へ曲げる）。レンダリング演出用。

///|
pub fn spin() -> Double {
  g.spin
}

// ===== W: コート全面ウォーター・水面流れ（決定的。乱数の消費は rng のみ） =====
// 水面流れ格子をゼロに初期化・再構築し、ドロップスケジューラもリセットする。
// ベンチマークが解像度を切り替えるため直接呼ぶ（白箱アクセス）

///|
fn init_fluid_grid(n : Int, m : Int) -> Unit {
  g.fl_n = n
  g.fl_m = m
  let len = n * m
  g.fl_x_a = Array::make(len, 0.0)
  g.fl_y_a = Array::make(len, 0.0)
  g.tmp_x_a = Array::make(len, 0.0)
  g.tmp_y_a = Array::make(len, 0.0)
  g.drop_timer = DROP_INTERVAL_MIN_D + DROP_INTERVAL_VAR_D / 2 // 最初の着水は ≈(min+var/2) フレーム後
}

// 毎フレームの水更新（step から呼ぶ）。固定順序：ドロップスケジューラ → ジャコビ拡散スイープ → 減衰・クランプ

///|
fn update_fluid(dt : Double) -> Unit {
  g.drop_timer -= dt
  if g.drop_timer <= 0.0 {
    spawn_droplet() // 着水は rng を消費する（xorshift32 で決定的）
    g.drop_timer = DROP_INTERVAL_MIN_D + rnd() * DROP_INTERVAL_VAR_D
  }

  let n = g.fl_n
  let m = g.fl_m
  let len = n * m
  let fx : Array[Double] = g.fl_x_a
  let fy : Array[Double] = g.fl_y_a
  let tx : Array[Double] = g.tmp_x_a
  let ty : Array[Double] = g.tmp_y_a

  // ジャコビ拡散スイープ：v ← v + K*(4近傍平均 - v)。バンド端は静止（ゼロ）扱いで流れが縁へ漏れ失う。
  // K ≤ 0.5 で非条件安定、1 フレーム 1 スイープ
  let k = FLOW_DIFF_K_D
  for j in 0..<m {
    let row = j * n
    for i in 0..<n {
      let idx = row + i
      let lft_x : Double = if i > 0 { fx[idx - 1] } else { 0.0 }
      let rgt_x : Double = if i < n - 1 { fx[idx + 1] } else { 0.0 }
      let up_x : Double = if j > 0 { fx[idx - n] } else { 0.0 }
      let dn_x : Double = if j < m - 1 { fx[idx + n] } else { 0.0 }
      tx[idx] = fx[idx] + k * ((lft_x + rgt_x + up_x + dn_x) / 4.0 - fx[idx])
      let lft_y : Double = if i > 0 { fy[idx - 1] } else { 0.0 }
      let rgt_y : Double = if i < n - 1 { fy[idx + 1] } else { 0.0 }
      let up_y : Double = if j > 0 { fy[idx - n] } else { 0.0 }
      let dn_y : Double = if j < m - 1 { fy[idx + n] } else { 0.0 }
      ty[idx] = fy[idx] + k * ((lft_y + rgt_y + up_y + dn_y) / 4.0 - fy[idx])
    }
  }
  let old_x : Array[Double] = fx
  let old_y : Array[Double] = fy
  g.fl_x_a = tx
  g.fl_y_a = ty
  g.tmp_x_a = old_x // 旧フィールドバッファが次ラウンドのスクリッチになる
  g.tmp_y_a = old_y

  // 減衰（除数形式なので dt が大きくても安定）と |v| 上限
  let damp = 1.0 / (1.0 + FLOW_DECAY_RATE_D * dt)
  for idx in 0..<len {
    let xv : Double = g.fl_x_a[idx] * damp
    let yv : Double = g.fl_y_a[idx] * damp
    let sp = (xv * xv + yv * yv).sqrt()
    if sp > FLOW_MAX_D {
      let s_ = FLOW_MAX_D / sp
      g.fl_x_a[idx] = xv * s_
      g.fl_y_a[idx] = yv * s_
    } else {
      g.fl_x_a[idx] = xv
      g.fl_y_a[idx] = yv
    }
  }
}

// ドロップ着水：コート内の一様ランダムな点に、距離で減衰する衝撃を近傍セルへ加算。
// y 成分（パドル間 x 軸に垂直な方向）のみを与える — スコアリング軸（x 方向）の流れは
// ボールの横断を止めかねないため与えない。
// fx グリッドは常にゼロのまま（flow_sample_x は契約のために残す）。

///|
fn spawn_droplet() -> Unit {
  let n = g.fl_n
  let m = g.fl_m
  let cx : Double = rnd() * W_D // x ∈ [0, W]（全面）
  let cy : Double = rnd() * H_D // y ∈ [0, H]

  // 影響セル範囲（半径 R を格子座標に変換、外側 1 セル余白）
  let dy_cell = H_D / n.to_double()
  let dx_cell = W_D / m.to_double()
  let ci0 : Int = ((cy - DROP_RADIUS_D) / dy_cell).floor().to_int()
  let ci1 : Int = ((cy + DROP_RADIUS_D) / dy_cell).ceil().to_int()
  let cj0 : Int = ((cx - DROP_RADIUS_D) / dx_cell).floor().to_int()
  let cj1 : Int = ((cx + DROP_RADIUS_D) / dx_cell).ceil().to_int()

  let j_lo : Int = if cj0 < 0 { 0 } else { cj0 }
  let j_hi : Int = if cj1 > m { m } else { cj1 }
  for j in j_lo..<j_hi {
    let row = j * n
    let i_lo : Int = if ci0 < 0 { 0 } else { ci0 }
    let i_hi : Int = if ci1 > n { n } else { ci1 }
    for i in i_lo..<i_hi {
      // セル中心からの距離と方向（セル中心座標）
      let sx_ : Double = (j.to_double() + 0.5) * dx_cell - cx
      let sy_ : Double = (i.to_double() + 0.5) * dy_cell - cy
      let dist = (sx_ * sx_ + sy_ * sy_).sqrt()
      if dist < DROP_RADIUS_D {
        let wgt : Double = 1.0 - dist / DROP_RADIUS_D // 中心で最大、縁でゼロ
        let imp = DROP_IMPULSE_D * wgt
        if dist > 0.0001 {
          // y 成分だけ加算（スコアリング軸 x への攪拌は意図的に与えない）
          g.fl_y_a[row + i] += imp * (sy_ / dist)
        } else {
          // 完全一致時は固定方向（-y）へ抜ける（決定的性のため）
          g.fl_y_a[row + i] -= imp
        }
      }
    }
  }

  // 衝撃直後に FLOW_MAX_D でクランプ（有界性保証）
  let len = n * m
  for idx in 0..<len {
    let xv : Double = g.fl_x_a[idx]
    let yv : Double = g.fl_y_a[idx]
    let sp = (xv * xv + yv * yv).sqrt()
    if sp > FLOW_MAX_D {
      let s_ = FLOW_MAX_D / sp
      g.fl_x_a[idx] = xv * s_
      g.fl_y_a[idx] = yv * s_
    }
  }
}

// (x, y) の水面流れの双線形サンプリング。キャンバスの外はゼロベクトル

///|
fn bilinear_flow_at(x : Double, y : Double) -> (Double, Double) {
  let n = g.fl_n.to_double()
  let m = g.fl_m.to_double()
  if x < 0.0 || x > W_D || y < 0.0 || y > H_D {
    return (0.0, 0.0) // キャンバス外は流れなし
  }

  let u : Double = clamp_d(y / H_D * n - 0.5, 0.0, n - 1.0)
  let v : Double = clamp_d(x / W_D * m - 0.5, 0.0, m - 1.0)

  let ni : Int = g.fl_n
  let nj : Int = g.fl_m
  let i0 : Int = u.floor().to_int()
  let j0 : Int = v.floor().to_int()
  let i1 : Int = if i0 < ni - 1 { i0 + 1 } else { ni - 1 } // 端セルでは隣を自分自身へ（fu=0 で安全）
  let j1 : Int = if j0 < nj - 1 { j0 + 1 } else { nj - 1 }
  let fu : Double = u - i0.to_double()
  let fv : Double = v - j0.to_double()

  let fx = g.fl_x_a
  let fy = g.fl_y_a
  let x00 = fx[j0 * g.fl_n + i0]
  let x10 = fx[j0 * g.fl_n + i1]
  let x01 = fx[j1 * g.fl_n + i0]
  let x11 = fx[j1 * g.fl_n + i1]
  let y00 = fy[j0 * g.fl_n + i0]
  let y10 = fy[j0 * g.fl_n + i1]
  let y01 = fy[j1 * g.fl_n + i0]
  let y11 = fy[j1 * g.fl_n + i1]

  let top : Double = x00 + (x10 - x00) * fu
  let bot : Double = x01 + (x11 - x01) * fu
  let out_x : Double = top + (bot - top) * fv
  let ty_ : Double = y00 + (y10 - y00) * fu
  let by_ : Double = y01 + (y11 - y01) * fu
  let out_y : Double = ty_ + (by_ - ty_) * fv

  (out_x, out_y)
}

///|
pub fn flow_sample_x(x : Double, y : Double) -> Double {
  bilinear_flow_at(x, y).0 // レンダリング（疎矢印）用に x 成分を公開
}

///|
pub fn flow_sample_y(x : Double, y : Double) -> Double {
  bilinear_flow_at(x, y).1 // レンダリング（疎矢印）用に y 成分を公開
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
  let old_y = g.player_y
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
  // スピン付与用の速度（px/フレーム@60fps 基準。dt=0 の初回は静止扱い）
  if dt > 0.0 {
    g.player_vel = (g.player_y - old_y) / dt
  } else {
    g.player_vel = 0.0
  }
}

///|
fn update_ai(ai_speed_ : Double, dt : Double) -> Unit {
  // ボールが AI 側へ来ている間だけ追跡、そうでなければ中央に戻る
  let old_y = g.ai_y
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
  // スピン付与用の速度（px/フレーム@60fps 基準。dt=0 の初回は静止扱い）
  if dt > 0.0 {
    g.ai_vel = (g.ai_y - old_y) / dt
  } else {
    g.ai_vel = 0.0
  }
}

///|
fn abs_d(x : Double) -> Double {
  if x < 0.0 {
    -x
  } else {
    x
  }
}

// 数値クランプ（スピン等の有界化に使う）

///|
fn clamp_d(x : Double, lo : Double, hi : Double) -> Double {
  if x < lo {
    lo
  } else if x > hi {
    hi
  } else {
    x
  }
}

///|
fn bounce_off_paddle(pad_y : Double, is_player_side : Bool) -> Unit {
  // パドル反発：当たった位置で反射角を決め、やや加速（上限あり）
  let rel = (g.ball_y - pad_y) / (PADDLE_H_D / 2 + BALL_R_D) // -1..1 付近
  let angle = rel * @math.PI / 3.2 // 最大約56度（旧実装と同じ式）
  let sp = g.speed * BALL_SPEEDUP_D
  g.speed = if sp > MAX_BALL_SPEED_D { MAX_BALL_SPEED_D } else { sp } // ヒット毎に加速（上限あり）
  let dir : Double = if is_player_side { 1.0 } else { -1.0 }
  g.vx = @math.cos(angle) * g.speed * dir
  g.vy = @math.sin(angle) * g.speed
  // A: スピン付与 — その場で動いているパドルがボールを「こする」ほどスピンが増す。
  // マウス急動（1フレームで数百px跳ぶ場合がある）は SPIN_SOURCE_MAX_D で飽和させ、
  // 結果を ±SPIN_MAX_D にクランプして有界にする。
  let pad_v : Double = if is_player_side { g.player_vel } else { g.ai_vel }
  let src = clamp_d(pad_v, -SPIN_SOURCE_MAX_D, SPIN_SOURCE_MAX_D)
  g.spin = clamp_d(src * SPIN_TRANSFER_D, -SPIN_MAX_D, SPIN_MAX_D)
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

  // A: マグヌス効果 — 速度の「方向」だけ回転させる（大きさは不変なので MAX_BALL_SPEED_D はそのまま有効）。
  // スピンの符号は付与側と同一規約：+spin は右進ボールを画面下側へ曲げる。
  if g.spin != 0.0 {
    let theta = MAGNUS_K_D * g.spin * dt
    let c = @math.cos(theta)
    let s_ = @math.sin(theta)
    let nvx = g.vx * c - g.vy * s_
    let nvy = g.vx * s_ + g.vy * c
    g.vx = nvx
    g.vy = nvy
  }
  // スピンは飛行中に減衰（除数形式なので dt が大きくても安定。半減≈2.9秒）
  if g.spin != 0.0 {
    g.spin /= 1.0 + SPIN_DECAY_RATE_D * dt
  }

  // W: コート全面ウォーター結合 — 球は常時水面（浮力廃止）。キャンバス外（得点フレーム等）は結合なし。
  if g.ball_x >= 0.0 && g.ball_x <= W_D {
    let fl : (Double, Double) = bilinear_flow_at(g.ball_x, g.ball_y)
    let rel_k : Double = clamp_d(DRAG_REL_K_D * dt, 0.0, 0.95) // 係数 < 1 なので無条件安定
    // 絶対減衰（除数形式、dt が大きくても安定）：相対粘性とマグヌスの過剰エネルギーを放出する
    let damp : Double = 1.0 / (1.0 + DRAG_ABS_RATE_D * dt)
    // 抵抗は水が実際に動いている軸にだけ作用 — その軸の flow ≒ 0 では抵抗なし（静水で球が止まらない）
    if fl.0.abs() > FLOW_STILL_EPS_D {
      g.vx += rel_k * (fl.0 - g.vx) // 相対粘性：球の速度をその点の水の流れへ引き寄せる
      g.vx *= damp
    }
    if fl.1.abs() > FLOW_STILL_EPS_D {
      g.vy += rel_k * (fl.1 - g.vy)
      g.vy *= damp
    }
  }
  // 水結合後も合成速度でクランプ（トンネリング・暴発防止）
  let sp_now = (g.vx * g.vx + g.vy * g.vy).sqrt()
  if sp_now > MAX_BALL_SPEED_D {
    let k = MAX_BALL_SPEED_D / sp_now
    g.vx *= k
    g.vy *= k
  } else if sp_now < MIN_BALL_SPEED_D {
    // 合成速度の下限：水流で大きく減速しても動き続ける（|v| ≒ 0 のときは serve_dir へ決定的に再開）
    if sp_now > 0.000001 {
      let k_ = MIN_BALL_SPEED_D / sp_now
      g.vx *= k_
      g.vy *= k_
    } else {
      g.vx = MIN_BALL_SPEED_D * g.serve_dir
      g.vy = 0.0
    }
  }

  g.ball_x += g.vx * dt
  g.ball_y += g.vy * dt

  // 上下壁のリバウンド（旧実装と同じ if / else-if 構造で、1フレームの二重リバウンドを防ぐ）
  if g.ball_y - BALL_R_D <= 0.0 && g.vy < 0.0 {
    g.ball_y = BALL_R_D
    g.vy = -g.vy
    g.spin *= WALL_SPIN_KEEP_D // 壁面ですり減らす（有界化）
    ev = ev | EV_WALL
  } else if g.ball_y + BALL_R_D >= H_D && g.vy > 0.0 {
    g.ball_y = H_D - BALL_R_D
    g.vy = -g.vy
    g.spin *= WALL_SPIN_KEEP_D // 壁面ですり減らす（有界化）
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
