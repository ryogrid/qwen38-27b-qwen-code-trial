// 白箱テスト：モジュール内部（g / bounce_off_paddle / update_ball）に直接触れて、
// A（スピン／マグヌス）の付与式を厳密値で検証する。moon test はネイティブで走る。

///|
test "スピンはパドル速度に比例して付与される" {
  g.ball_y = 260.0 // パドル中心への当たり → 反射角ゼロ（角度項の影響を分離）
  g.speed = BASE_BALL_SPEED_D
  g.player_vel = 4.0
  bounce_off_paddle(260.0, true)
  assert_eq(spin(), 4.0 * SPIN_TRANSFER_D) // クランプ範囲内（|4*0.19|=0.76 < 1.5）

  g.player_vel = -4.0
  bounce_off_paddle(260.0, true)
  assert_eq(spin(), -4.0 * SPIN_TRANSFER_D) // 符号も追従する
}

///|
test "スピンは ±SPIN_MAX_D で飽和する" {
  g.ball_y = 260.0
  g.speed = BASE_BALL_SPEED_D
  g.player_vel = 8.0 // 8*0.19=1.52 > SPIN_MAX_D → 上限で切れる
  bounce_off_paddle(260.0, true)
  assert_eq(spin(), SPIN_MAX_D)

  g.player_vel = -8.0
  bounce_off_paddle(260.0, true)
  assert_eq(spin(), -SPIN_MAX_D) // 負側も同様に飽和

  g.ai_vel = -8.0
  bounce_off_paddle(260.0, false) // AI 側接触は ai_vel を読む（符号規約は共通）
  assert_eq(spin(), -SPIN_MAX_D)
}

///|
test "マグヌス効果は速度の方向だけ回転させ大きさは不変" {
  g.ball_x = -5.0 // キャンバス外（x < 0）に置いて水結合を無効化し、純粋なマグヌス効果だけを分離する
  g.ball_y = 260.0
  g.vx = 10.0
  g.vy = 3.0
  g.spin = 1.5
  let sp_before = (g.vx * g.vx + g.vy * g.vy).sqrt()
  ignore(update_ball(1.0))
  let sp_after = (g.vx * g.vx + g.vy * g.vy).sqrt()
  let diff = sp_after - sp_before
  assert_true(diff >= -0.000000001 && diff <= 0.000000001) // |v| 不変（MAX_BALL_SPEED クランプが効かない領域）
  assert_true(g.vy > 3.0) // +spin は右進ボールを画面下側（+y）へ曲げる
}

///|
test "スピンは飛行中に除算形で減衰する" {
  g.ball_x = -5.0 // キャンバス外（x < 0）に置いて水結合を無効化し、純粋な減衰だけを観測する
  g.ball_y = 260.0
  g.vx = 6.5
  g.vy = 3.0
  g.spin = 1.0
  ignore(update_ball(1.0))
  assert_eq(spin(), 1.0 / (1.0 + SPIN_DECAY_RATE_D * 1.0))
}

///|
test "上下壁のリバウンド時にスピンが減衰係数倍される" {
  g.ball_x = -5.0 // キャンバス外（x < 0）に置いて水結合を無効化
  g.ball_y = BALL_R_D // 上壁ちょうど（フレーム中の落下で判定が成立）
  g.vx = 6.5
  g.vy = -5.0
  g.spin = 1.0
  ignore(update_ball(1.0))
  assert_true(g.vy > 0.0) // 反射した
  // このフレームの飛行減衰と壁面すり減らしの厳密な合成値（実装と同じ演算順序）
  assert_eq(spin(), 1.0 / (1.0 + SPIN_DECAY_RATE_D * 1.0) * WALL_SPIN_KEEP_D)
}

// ===== W: ウォーターバンド／水面流れ（ドロップ着水と格子の白箱検証） =====

///|
// グリッド全体の |v| の総和を返す（決定的なチェックサム代わりの観測量）
fn grid_momentum() -> Double {
  let n = FLUID_N_DEFAULT * FLUID_M_DEFAULT
  let mut s : Double = 0.0
  for idx in 0..<n {
    s += (g.fl_x_a[idx] * g.fl_x_a[idx] + g.fl_y_a[idx] * g.fl_y_a[idx]).sqrt()
  }
  s
}

///|
test "ドロップ着水は有限な衝撃を水面に与える" {
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT) // 無垢な水面（スケジューラもリセット）
  seed(321) // rnd() の状態固定 → 再現可能な単一着水
  spawn_droplet()
  let n = FLUID_N_DEFAULT * FLUID_M_DEFAULT
  let mut max_sp : Double = 0.0
  for idx in 0..<n {
    let xv = g.fl_x_a[idx]
    let yv = g.fl_y_a[idx]
    let sp = (xv * xv + yv * yv).sqrt()
    if sp > max_sp {
      max_sp = sp
    }
  }
  assert_true(max_sp > 0.5) // 着水が格子に届き、ゼロへ縮退していない
  assert_true(max_sp <= FLOW_MAX_D + 0.0000001) // 着水直後のクランプで有界（DROP_IMPULSE < FLOW_MAX）
}

///|
test "同一シードのドロップ着水は完全に再現される" {
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT)
  seed(321)
  spawn_droplet()
  let first = grid_momentum()
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT)
  seed(321)
  spawn_droplet()
  assert_eq(grid_momentum(), first) // 同一シード → 同一の着水位置・衝撃
}

///|
test "ジャコビ拡散はエネルギーを無中生に増やさない" {
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT)
  seed(987)
  spawn_droplet() // 有限な初期条件
  let before = grid_momentum()
  for i in 0..<120 { // 約2秒間、拡散＋減衰のみ（再着水を避けるためスケジューラは進めない）
    update_fluid_no_droplet()
  }
  assert_true(grid_momentum() <= before + 0.000001) // 拡散・減衰で総量は増えない（べき収縮）
}

///|
test "静水では水抵抗が発生しない（流れがゼロの軸は減速させない）" {
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT) // 無垢な水面（着水なし → 全セルの flow = 0）
  g.ball_x = W_D / 2.0
  g.ball_y = H_D / 2.0
  g.vx = 6.5
  g.vy = -3.0
  g.spin = 0.0 // マグヌスを無効化して水結合の効果を分離する
  ignore(update_ball(1.0))
  assert_eq(g.vx, 6.5) // 相対粘性も絶対減衰も一切掛からない
  assert_eq(g.vy, -3.0)
}

///|
test "合成速度は MIN_BALL_SPEED_D で下限制御される（方向は保持）" {
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT)
  g.ball_x = W_D / 2.0
  g.ball_y = H_D / 2.0
  g.vx = 1.0 // 水流で大きく減速した状態を模擬
  g.vy = 0.5
  g.spin = 0.0
  ignore(update_ball(1.0))
  let sp_after : Double = (g.vx * g.vx + g.vy * g.vy).sqrt()
  let diff_ = sp_after - MIN_BALL_SPEED_D
  assert_true(diff_ >= -0.000001 && diff_ <= 0.000001) // ちょうど下限まで引き上げられる
  assert_true(g.vx > 0.0 && g.vy > 0.0) // 進行方向は反転しない
}

///|
test "速度ゼロのボールは serve_dir へ決定的に再開される" {
  init_fluid_grid(FLUID_N_DEFAULT, FLUID_M_DEFAULT)
  g.ball_x = W_D / 2.0
  g.ball_y = H_D / 2.0
  g.vx = 0.0 // 方向が不定の完全停止状態
  g.vy = 0.0
  g.spin = 0.0
  g.serve_dir = -1.0
  ignore(update_ball(1.0))
  assert_eq((g.vx, g.vy), (-MIN_BALL_SPEED_D, 0.0)) // 直前サーブ方向へ復旧
}

///|
// ドロップスケジューラを動かさず拡散・減衰だけを行う補助（update_fluid の本体と同じ処理）
fn update_fluid_no_droplet() -> Unit {
  let n = g.fl_n
  let m = g.fl_m
  let len = n * m
  let fx : Array[Double] = g.fl_x_a
  let fy : Array[Double] = g.fl_y_a
  let tx : Array[Double] = g.tmp_x_a
  let ty : Array[Double] = g.tmp_y_a
  let k = FLOW_DIFF_K_D
  for j in 0..<m {
    let row = j * n
    for i in 0..<n {
      let idx = row + i
      tx[idx] = fx[idx] +
        k *
        (
          (if i > 0 { fx[idx - 1] } else { 0.0 }) +
          (if i < n - 1 { fx[idx + 1] } else { 0.0 }) +
          (if j > 0 { fx[idx - n] } else { 0.0 }) +
          (if j < m - 1 { fx[idx + n] } else { 0.0 })
        ) /
        4.0 -
        k * fx[idx]
      ty[idx] = fy[idx] +
        k *
        (
          (if i > 0 { fy[idx - 1] } else { 0.0 }) +
          (if i < n - 1 { fy[idx + 1] } else { 0.0 }) +
          (if j > 0 { fy[idx - n] } else { 0.0 }) +
          (if j < m - 1 { fy[idx + n] } else { 0.0 })
        ) /
        4.0 -
        k * fy[idx]
    }
  }
  g.fl_x_a = tx
  g.fl_y_a = ty
  g.tmp_x_a = fx
  g.tmp_y_a = fy
}
