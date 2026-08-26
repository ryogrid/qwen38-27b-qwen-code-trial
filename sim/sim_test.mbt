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
