// ===== three.js シーン構築と毎フレーム更新（3D 描画層）=====
import * as THREE from "three";
import type { Game } from "../game/game";
import { W, H, PADDLE_W, PADDLE_H, BALL_R, PX, AX } from "../game/constants";

// シミュレーション座標 → ワールド座標のマッピング
// worldX = sim.y - H/2（左右）、worldZ = W/2 - sim.x（奥行き）
// プレイヤーは手前（+Z / カメラ側）、AI は奥（-Z）。パドルは X 軸にスライドする。
function toWorldX(simY: number): number {
  return simY - H / 2;
}
function toWorldZ(simX: number): number {
  return W / 2 - simX;
}

// Y バウンド演出（見た目専用：シミュレーションには一切影響しない）
const BOUNCE_AMP = 26; // バウンド高さ（ワールド単位）
const HOP_PERIOD_FRAMES = 18; // ホップ周期（約0.3秒 / 60fps 基準）

// パドルメッシュの高さ（装飾用。シムの PADDLE_W/H は X/Z 方向の寸法に使う）
const PADDLE_MESH_H = 18;

export class PongScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ballMesh: THREE.Mesh;
  private readonly playerMesh: THREE.Mesh;
  private readonly aiMesh: THREE.Mesh;
  private hopPhase = 0; // Y バウンド演出の位相（0..1）
  private prevInFlight = false; // サーブ開始時に位相をリセットするための前フレーム状態
  private lastNow = 0;

  constructor(container: HTMLElement) {
    const width = container.clientWidth || W;
    const height = container.clientHeight || H;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0a);

    // 斜め上から俯瞰するカメラ（手前=プレイヤー側）
    // フレームは両パドル・テーブル端が画面内に入るよう数値で検証済み
    this.camera = new THREE.PerspectiveCamera(50, width / height, 1, 5000);
    this.camera.position.set(0, 430, 920);
    this.camera.lookAt(0, 0, -120);

    // ライト（影で立体感を出す）
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(300, 500, 250);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const sc = dir.shadow.camera;
    sc.left = -600;
    sc.right = 600;
    sc.top = 600;
    sc.bottom = -600;
    sc.near = 50;
    sc.far = 2000;
    this.scene.add(dir);
    this.scene.add(dir.target);

    // テーブル（上面が y=0。X 幅 = シムの H、奥行き = シムの W）
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(H, 8, W),
      new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.9 }),
    );
    table.position.set(0, -4, 0);
    table.receiveShadow = true;
    this.scene.add(table);

    // 左右の低壁（ボールが反射する x=±H/2 の位置に装飾）
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x39465c, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 16, W), wallMat);
      wall.position.set(side * (H / 2 + 6), 8, 0);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }

    // 中央の床ライン（旧 draw() の点線に相当）
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(H, 1.5, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }),
    );
    line.position.set(0, 0.75, 0);
    this.scene.add(line);

    // 中央ネット（装飾のみ：衝突判定はしない）
    const netH = 36;
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(H, netH, 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.6 }),
    );
    net.position.set(0, netH / 2, 0);
    this.scene.add(net);
    const netBar = new THREE.Mesh(
      new THREE.BoxGeometry(H, 2, 4),
      new THREE.MeshStandardMaterial({ color: 0xf4f4f4 }),
    );
    netBar.position.set(0, netH + 1, 0);
    this.scene.add(netBar);

    // ボール（テーブル面上を転がる。y は update() で BOUNCE_AMP の演出分だけ加算）
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }),
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    // パドル（X 方向に長さ PADDLE_H、奥行き PADDLE_W。z はシムの PX/AX から固定）
    const paddleGeo = new THREE.BoxGeometry(PADDLE_H, PADDLE_MESH_H, PADDLE_W);
    this.playerMesh = new THREE.Mesh(
      paddleGeo,
      new THREE.MeshStandardMaterial({ color: 0x9fd6ff, roughness: 0.5 }),
    );
    this.aiMesh = new THREE.Mesh(
      paddleGeo,
      new THREE.MeshStandardMaterial({ color: 0xffb27d, roughness: 0.5 }),
    );
    for (const m of [this.playerMesh, this.aiMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    // パドル中心の z：シムではパドルは [PX, PX+PADDLE_W] / [AX, AX+PADDLE_W] に固定
    const playerZ = toWorldZ(PX + PADDLE_W / 2);
    const aiZ = toWorldZ(AX + PADDLE_W / 2);
    this.playerMesh.position.set(0, PADDLE_MESH_H / 2, playerZ);
    this.aiMesh.position.set(0, PADDLE_MESH_H / 2, aiZ);
    this.scene.add(this.playerMesh);
    this.scene.add(this.aiMesh);

    // 初回更新前にボールを中央に置く（update() が毎フレーム上書きする）
    this.ballMesh.position.set(0, BALL_R, toWorldZ(W / 2));
  }

  // 毎フレーム呼び出し（メニュー中も呼ぶので、テーブルは常時表示される）
  update(game: Game, now: number, playing: boolean): void {
    const g = game;

    // パドル位置（移動軸 = シムの y → ワールド X。z は固定）
    this.playerMesh.position.x = toWorldX(g.player.y);
    this.aiMesh.position.x = toWorldX(g.ai.y);

    // ボール位置（シム x → 奥行き Z、シム y → 左右 X）
    const b = g.ball;
    const inFlight = b.vx !== 0 || b.vy !== 0;

    let bounceY = 0;
    if (playing && inFlight) {
      // ホップ位相を進める（待機中・ポーズ中は進めない）
      if (!this.prevInFlight) this.hopPhase = 0; // サーブ開始時は接地から
      const dtFrames = Math.min(Math.max((now - this.lastNow) / (1000 / 60), 0), 3);
      this.hopPhase += dtFrames / HOP_PERIOD_FRAMES;
      if (this.hopPhase >= 1) this.hopPhase -= Math.floor(this.hopPhase);
      const u = this.hopPhase; // 放物運動風の弧：4·u·(1-u) で着地時に速度が最大
      bounceY = BOUNCE_AMP * 4 * u * (1 - u);
    } else {
      this.hopPhase = 0;
    }
    this.prevInFlight = inFlight && playing;

    this.ballMesh.position.set(toWorldX(b.y), BALL_R + bounceY, toWorldZ(b.x));

    // 非プレイ中も時刻は最新に保つ（復帰時の dt スパイク防止）
    this.lastNow = now;

    this.renderer.render(this.scene, this.camera);
  }

  // コンテナサイズ変化時のリサイズ（アスペクト比と描画バッファを更新）
  resize(container: HTMLElement): void {
    const width = container.clientWidth || W;
    const height = container.clientHeight || H;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // StrictMode の二重マウント・アンマウント対応：リソースを完全に破棄する
  dispose(): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
