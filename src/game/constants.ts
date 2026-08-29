// ===== ゲームの定数（旧 script.js から移植）=====
export const W = 900; // キャンバス幅
export const H = 520; // キャバスの高さ

export const PADDLE_W = 14;
export const PADDLE_H = 92;
export const BALL_R = 8;
// 勝利点数（WIN_SCORE）はロジック権威が wasm 側（sim/sim.mbt）に移管したため非管理。

export const PX = 26; // プレイヤーパドルの x（左端）
export const AX = W - 26 - PADDLE_W; // AIパドルの x（右端）

// ポイント後のボール待機フレーム数（約0.8秒 / 60fps 基準）
export const SERVE_DELAY_FRAMES = 48;
export const BASE_BALL_SPEED = 6.5;
export const MAX_BALL_SPEED = 14;
export const BALL_SPEEDUP = 1.05; // ヒット毎の加速倍率
export const PLAYER_SPEED = 8; // px / フレーム（60fps 基準）
export const MOUSE_FOLLOW_LERP = 0.25;

// 角度係数（旧実装と同一の挙動を維持）
export const SERVE_ANGLE_MAX = Math.PI / 5; // ±36度以内
export const PADDLE_BOUNCE_MAX = Math.PI / 3.2; // 最大約56度

export const DIFFICULTIES = {
  easy: { aiSpeed: 3.4, error: 52 },
  medium: { aiSpeed: 4.6, error: 28 },
  hard: { aiSpeed: 6.4, error: 10 },
} as const;

export type DifficultyKey = keyof typeof DIFFICULTIES;

// 水面流れの描画用プロブ格子（sim.mbt の FLUID_N_DEFAULT × FLUID_M_DEFAULT と一致させること。各セル中心に1つ）
export const FLOW_N = 30; // H 方向（縦軸）セル数（= sim.mbt の FLUID_N_DEFAULT。dx≈17px）
export const FLOW_M = 52; // W 方向（横軸）セル数（= sim.mbt の FLUID_M_DEFAULT）

export const SCREENS = {
  MENU: "menu",
  PLAYING: "playing",
  PAUSED: "paused",
  GAMEOVER: "gameover",
} as const;

export type ScreenId = (typeof SCREENS)[keyof typeof SCREENS];
