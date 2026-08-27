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
  assert_eq(spin(), (-4.0 * SPIN_TRANSFER_D)) // 符号も追従する
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
  assert_eq(spin(), (-SPIN_MAX_D)) // 負側も同様に飽和

  g.ai_vel = -8.0
  bounce_off_paddle(260.0, false) // AI 側接触は ai_vel を読む（符号規約は共通）
  assert_eq(spin(), (-SPIN_MAX_D))
}

///|
test "マグヌス効果は速度の方向だけ回転させ大きさは不変" {
  g.turb_phase = 0.0 // 嵐包絡が 0 の位相 → 乱流重力は厳密にゼロで式を汚さない
  g.ball_x = 450.0 // 壁・パドルから十分離れた中央
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
  g.turb_phase = 0.0
  g.ball_x = 450.0 // 壁・パドルから十分離れた中央で純粋な減衰だけを観測
  g.ball_y = 260.0
  g.vx = 6.5
  g.vy = 3.0
  g.spin = 1.0
  ignore(update_ball(1.0))
  assert_eq(spin(), (1.0 / (1.0 + SPIN_DECAY_RATE_D * 1.0)))
}

///|
test "上下壁のリバウンド時にスピンが減衰係数倍される" {
  g.turb_phase = 0.0
  g.ball_x = 450.0
  g.ball_y = BALL_R_D // 上壁ちょうど（フレーム中の落下で判定が成立）
  g.vx = 6.5
  g.vy = -5.0
  g.spin = 1.0
  ignore(update_ball(1.0))
  assert_true(g.vy > 0.0) // 反射した
  // このフレームの飛行減衰と壁面すり減らしの厳密な合成値（実装と同じ演算順序）
  assert_eq(spin(), ((1.0 / (1.0 + SPIN_DECAY_RATE_D * 1.0)) * WALL_SPIN_KEEP_D))
}
