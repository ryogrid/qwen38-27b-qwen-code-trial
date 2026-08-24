import { W, H, BASE_BALL_SPEED } from "./constants";

// ボール状態（位置・速度・進行方向）
export class Ball {
  x: number; // ボールの中心 x
  y: number; // ボールの中心 y
  vx: number; // 毎フレーム移動量相当の水平速度
  vy: number; // 毎フレーム移動量相当の垂直速度
  speed: number; // パドル当たりごとに BALL_SPEEDUP で加速

  constructor(x = W / 2, y = H / 2) {
    this.x = x; // 旧初期状態 {x:W/2,y:H/2,vx:0,vy:0,speed:BASE_BALL_SPEED} と一致
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = BASE_BALL_SPEED;
  }

  // ポイント後のサーブ準備：ボールを中央にリセット（旧 prepareServe のボール側処理）
  resetToCenter(): void {
    this.x = W / 2;
    this.y = H / 2;
    this.vx = 0;
    this.vy = 0;
    this.speed = BASE_BALL_SPEED;
  }
}
