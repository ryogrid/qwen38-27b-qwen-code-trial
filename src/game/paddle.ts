import { H, PADDLE_H } from "./constants";

// プレイヤー側・AI 側共通のパドル（中心 y で管理）
export class Paddle {
  y: number; // パドルは中心 y で管理

  constructor(y = H / 2) {
    this.y = y;
  }

  clamp(): void {
    this.y = Math.max(PADDLE_H / 2, Math.min(H - PADDLE_H / 2, this.y)); // 旧 clampPaddle と同一の式
  }
}

// AI パドル（レガシーフィールド targetY は旧実装 API のため保持）
export class AIPaddle extends Paddle {
  targetY: number; // レガシーフィールド（旧実装 API のため保持）

  constructor(y = H / 2) {
    super(y);
    this.targetY = y; // 旧初期状態 {y:H/2, targetY:H/2} と一致
  }
}
