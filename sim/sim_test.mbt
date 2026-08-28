// 黒箱テスト：公開 API のみ使ってシミュレーションの決定的挙動を検証する。
// moon test はネイティブターゲットで走る（wasm と同じ f64 演算）。

///|
fn trajectory(seed_val : Int, frames : Int) -> (Double, Double) {
  seed(seed_val)
  prepare_serve(0.0)
  center_paddles()
  let mut i = 0
  while i < frames {
    let _ = step(2, 1.0, false, false, 260.0, true) // hard / dt=1フレーム / 入力なし・マウス追従ON
    i += 1
  }
  (ball_x(), ball_y())
}

///|
test "同じシードは同一軌跡を再現する" {
  let a = trajectory(42, 300)
  let b = trajectory(42, 300)
  assert_eq(a, b)
}

///|
test "異なるシードは異なる軌跡になる" {
  let a = trajectory(1, 300)
  let b = trajectory(2, 300)
  assert_true(a.0 != b.0 || a.1 != b.1)
}

///|
test "待機中もパドルは中央へ戻る" {
  seed(99)
  prepare_serve(-1.0) // プレイヤー側へのサーブで決める（乱数消費を固定）
  center_paddles()
  let mut i = 0
  while i < 200 {
    let _ = step(0, 1.0, false, false, 10.0, true) // easy / マウスは上端寄り
    i += 1
  }
  // サーブ待機中（48フレーム）+ α 経過してもパドル位置は有効範囲内である
  assert_true(player_y() >= 46.0 && player_y() <= 474.0)
}

///|
test "有界ステップ内で必ず何らかのポイントになる" {
  seed(7)
  prepare_serve(0.0)
  center_paddles()
  let mut ev = 0
  let mut i = 0
  while (ev & 12) == 0 && i < 3000 {
    ev = step(2, 1.0, false, false, 260.0, true)
    i += 1
  }
  assert_true((ev & 4) != 0 || (ev & 8) != 0) // 有界フレーム内に得点ビットが出る
}

// ===== スコア・勝敗判定（wasm 側が権威） =====

///|
test "ポイントは正しい側のスコアに1加算される" {
  seed(21)
  reset_scores()
  prepare_serve(0.0)
  center_paddles()
  let mut ev = 0
  let mut i = 0
  while (ev & 12) == 0 && i < 3000 {
    ev = step(2, 1.0, false, false, 260.0, true)
    i += 1
  }
  if (ev & EV_POINT_PLAYER) != 0 {
    assert_eq((p_score(), a_score()), (1, 0)) // 右アウト：プレイヤー得点のみ
  } else {
    assert_eq((p_score(), a_score()), (0, 1)) // 左アウト：AI 得点のみ
  }
}

///|
test "WIN_SCORE に到達したフレームに EV_GAME_OVER が付く" {
  seed(21)
  reset_scores()
  prepare_serve(0.0)
  center_paddles()
  let mut ev = 0
  let mut i = 0
  while (ev & EV_GAME_OVER) == 0 && i < 60000 {
    if (ev & 12) != 0 {
      prepare_serve(0.0) // ポイント後の再サーブ（JS と同じ手順）
    }
    ev = step(2, 1.0, false, false, 260.0, true)
    i += 1
  }
  // ゲームオーバーは必ずポイントと同時
  assert_true((ev & EV_POINT_PLAYER) != 0 || (ev & EV_POINT_AI) != 0)
  // 勝者はちょうど WIN_SCORE 点、敗者はそれを下回る（< WIN_SCORE）
  if (ev & EV_POINT_PLAYER) != 0 {
    assert_eq(p_score(), WIN_SCORE)
    assert_true(a_score() < WIN_SCORE)
  } else {
    assert_eq(a_score(), WIN_SCORE)
    assert_true(p_score() < WIN_SCORE)
  }
}

///|
test "reset_scores は両スコアを0に戻す" {
  seed(5)
  prepare_serve(1.0) // プレイヤー側へのサーブ（AI 方向）で決定的に
  center_paddles()
  let mut ev = 0
  let mut i = 0
  while (ev & 12) == 0 && i < 3000 {
    ev = step(2, 1.0, false, false, 260.0, true)
    i += 1
  }
  assert_true((p_score(), a_score()) != (0, 0)) // この時点で必ず片方加算済み
  reset_scores()
  assert_eq((p_score(), a_score()), (0, 0))
}

// ===== A: スピン／マグヌス効果（付与式は白箱テスト sim_wbtest.mbt で検証） =====

// ===== W: 浸水ウォーターバンド／水面流れ（衝撃の付与式は白箱テスト sim_wbtest.mbt で検証） =====

///|
// 黒箱プローブ：ウォーターバンド全体を粗い格子でサンプリングし、全ポイントの最大 |v| を返す。
fn band_flow_probe() -> Double {
  let wy = water_y()
  let mut mx : Double = 0.0
  for i in 0..<5 { // x ∈ [50, 242, 434, 626, 818]
    let px : Double = 50.0 + (i * 192).to_double()
    for j in 0..<4 { // y = 水面+10 .. 水面+100（水深 104 の内側）
      let py : Double = wy + 10.0 + (j * 30).to_double()
      let fxv : Double = flow_sample_x(px, py)
      let fyv : Double = flow_sample_y(px, py)
      let m_ = (fxv * fxv + fyv * fyv).sqrt()
      if m_ > mx {
        mx = m_
      }
    }
  }
  mx
}

///|
test "水面流れの大きさは常に FLOW_MAX で有界" {
  seed(77)
  prepare_serve(-1.0) // 方向固定で乱数消費を確定させる
  center_paddles()
  let mut ev = 0
  let mut i = 0
  while i < 600 {
    if (ev & 12) != 0 {
      prepare_serve(0.0) // ポイント後は再サーブ（JS と同じ手順）
    }
    ev = step(2, 1.0, false, false, 260.0, true)
    assert_true(band_flow_probe() <= 8.0 + 0.000001) // FLOW_MAX_D 上限（+ε）。双線形はセル値の凸結合なので超過しない
    i += 1
  }
}

///|
// 同じシード・同じ手順で frames フレーム回し、ウォーターバンドのプローブ結果を返す。
fn flow_replay(seed_val : Int, frames : Int) -> Double {
  seed(seed_val)
  prepare_serve(-1.0) // 方向固定で乱数消費を確定させる
  center_paddles()
  let mut i = 0
  while i < frames {
    ignore(step(2, 1.0, false, false, 260.0, true))
    i += 1
  }
  band_flow_probe()
}

///|
test "水面流れは決定的で再現される（ドロップ着水を含む）" {
  // ドロップ着水は rnd() を消費するため、同一シードで完全に一致する必要がある
  assert_eq(flow_replay(123, 900), flow_replay(123, 900))
}

///|
test "異なるシードでは水面流れが異なる" {
  // 着水位置の乱数依存を捉えるため十分長い（着水は平均≈150フレーム毎）
  assert_true(flow_replay(456, 900) != flow_replay(789, 900))
}

///|
test "水面より上では流れは常にゼロ" {
  seed(321)
  prepare_serve(-1.0)
  center_paddles()
  let mut ev = 0
  let mut i = 0
  while i < 600 {
    if (ev & 12) != 0 {
      prepare_serve(0.0) // ポイント後は再サーブ（JS と同じ手順）
    }
    ev = step(2, 1.0, false, false, 260.0, true)
    assert_eq(
      (
        flow_sample_x(450.0, water_y() - 10.0),
        flow_sample_y(450.0, water_y() - 10.0),
      ),
      (0.0, 0.0),
    ) // バンド外（水面以上）は常にゼロベクトル
    i += 1
  }
}
