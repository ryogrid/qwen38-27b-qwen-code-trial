// ベンチマーク：流体格子 N×M の解像度別に step() 1 フレームあたりのコストを測定する。
// moon test はネイティブで走る（wasm と同じ f64 演算）。結果は標準出力に表示のみ。

///|
fn bench_grid(n : Int, m : Int) -> Double {
  // グリッド再初期化（シム状態も整理して各解像度で公平に測る）
  seed(12345)
  prepare_serve(0.0)
  center_paddles()
  init_fluid_grid(n, m)
  let warmup = 60
  let mut i = 0
  while i < warmup {
    let _ = step(2, 1.0, false, false, 260.0, true)
    i += 1
  }
  let iters = 30000
  let t0 = @bench.monotonic_clock_start()
  let mut j = 0
  while j < iters {
    // ポイント後は再サーブ（実プレイと近い負荷にする）
    if (step(2, 1.0, false, false, 260.0, true) & 12) != 0 {
      prepare_serve(0.0)
      center_paddles()
    }
    j += 1
  }
  let us = @bench.monotonic_clock_end(t0)
  us / iters.to_double()
}

///|
fn run_case(n : Int, m : Int) -> Unit {
  let per_frame_us = bench_grid(n, m)
  println(
    "grid N x M = \{n} x \{m} : step 平均 \{per_frame_us.to_string()} us/フレーム",
  )
}

///|
test "ベンチマーク：流体格子解像度別の step コスト（表示のみ）" {
  run_case(15, 5)
  run_case(20, 7)
  run_case(30, 9) // 現行既定（セル≈17×20px でほぼ等方）
  run_case(45, 16)
  run_case(60, 21)
  run_case(90, 32)
}
