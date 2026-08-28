// ===== three.js シーン構築と毎フレーム更新（3D 描画層）=====
import * as THREE from "three";
import { W, H, PADDLE_W, PADDLE_H, BALL_R, PX, AX } from "../game/constants";

// シーンが読むシムの最小構造（wasmSim の WasmGame が適合する）
interface SimView {
  player: { y: number };
  ai: { y: number };
  ball: { x: number; y: number; vx: number; vy: number; spin: number };
  waterY: number; // 水面線（sim y 座標）。描画のみ
  flowArrows: { x: number; y: number; fx: number; fy: number }[]; // 水面流れのプロブ点。描画のみ
}

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
// スピン可視化の回転速度（見た目専用。spin=1 での rad/フレーム相当）
const SPIN_VIS_RATE = 0.5;

// パドルメッシュの高さ（装飾用。シムの PADDLE_W/H は X/Z 方向の寸法に使う）
const PADDLE_MESH_H = 18;

// E2: 水面流れ矢じりの基準寸法（グループの scale.x で流速に応じて伸び縮みする）
const ARROW_SHAFT_LEN = 20; // 軸（箱）の長さ
const ARROW_HEAD_LEN = 14; // 頭（コーン）の高さ。合計が基準全長

export class PongScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ballMesh: THREE.Mesh;
  private readonly ballSeamMat: THREE.MeshStandardMaterial; // スピンを可視化するボール表面のマーカー素材
  private readonly playerMesh: THREE.Mesh;
  private readonly aiMesh: THREE.Mesh;
  private readonly windGroup: THREE.Group; // E2: 水面流れのスパース矢じり（テーブル上・装飾のみ）
  private readonly arrowShaftGeo: THREE.BoxGeometry;
  private readonly arrowHeadGeo: THREE.ConeGeometry;
  private readonly arrowMat: THREE.MeshStandardMaterial;
  private readonly waterMesh: THREE.Mesh; // E2: 水帯のスラブ（半透明。テーブル上・装飾のみ）
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
    // A: ボール表面の「シーム」（子メッシュ）。球体を回転させるだけでスピンが視認できる
    const seamGeo = new THREE.SphereGeometry(BALL_R * 0.3, 16, 8);
    this.ballSeamMat = new THREE.MeshStandardMaterial({ color: 0x2b4d74, roughness: 0.5 });
    for (const [sx, sy] of [
      [BALL_R * 0.7, BALL_R * 0.3],
      [-BALL_R * 0.7, -BALL_R * 0.3],
    ] as const) {
      const seam = new THREE.Mesh(seamGeo, this.ballSeamMat);
      seam.position.set(sx, sy, 0);
      this.ballMesh.add(seam);
    }
    this.scene.add(this.ballMesh);

    // E2: 水帯のスラブ（テーブル上に sim y ∈ [waterY, H] を覆う半透明板。位置・幅は update() で g.waterY から）
    this.waterMesh = new THREE.Mesh(
      new THREE.BoxGeometry(H, 4, W),
      new THREE.MeshStandardMaterial({ color: 0x3f8fd6, transparent: true, opacity: 0.3, roughness: 0.25 }),
    );
    this.waterMesh.position.set(0, 2, 0); // update() が scale/position を水帯幅に合わせる（未同期時は 0 に見える）
    this.scene.add(this.waterMesh);

    // E2: 水面流れのスパース矢じり（+X を向く基準長 ARROW_LEN のグループを game.flowArrows 分だけ動的生成する）
    this.windGroup = new THREE.Group();
    this.arrowShaftGeo = new THREE.BoxGeometry(ARROW_SHAFT_LEN, 3, 5);
    this.arrowHeadGeo = new THREE.ConeGeometry(7, ARROW_HEAD_LEN, 12);
    this.arrowMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.75 });
    this.scene.add(this.windGroup);

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
  update(game: SimView, now: number, playing: boolean): void {
    const g = game;

    // パドル位置（移動軸 = シムの y → ワールド X。z は固定）
    this.playerMesh.position.x = toWorldX(g.player.y);
    this.aiMesh.position.x = toWorldX(g.ai.y);

    // ボール位置（シム x → 奥行き Z、シム y → 左右 X）
    const b = g.ball;
    const inFlight = b.vx !== 0 || b.vy !== 0;
    const dtF = Math.min(Math.max((now - this.lastNow) / (1000 / 60), 0), 3);

    let bounceY = 0;
    if (playing && inFlight) {
      // ホップ位相を進める（待機中・ポーズ中は進めない）
      if (!this.prevInFlight) this.hopPhase = 0; // サーブ開始時は接地から
      this.hopPhase += dtF / HOP_PERIOD_FRAMES;
      if (this.hopPhase >= 1) this.hopPhase -= Math.floor(this.hopPhase);
      const u = this.hopPhase; // 放物運動風の弧：4·u·(1-u) で着地時に速度が最大
      bounceY = BOUNCE_AMP * 4 * u * (1 - u);

      // A: スピンを回転演出として表現（テーブル法線軸回り。シームで視認）
      this.ballMesh.rotation.y += b.spin * SPIN_VIS_RATE * dtF;
    } else {
      this.hopPhase = 0;
    }
    this.prevInFlight = inFlight && playing;

    this.ballMesh.position.set(toWorldX(b.y), BALL_R + bounceY, toWorldZ(b.x));

    // E2: 水帯スラブ（幅 = H - waterY を世界 X 方向に。未同期の waterY=H では見えない）
    const dWater = H - g.waterY;
    this.waterMesh.scale.x = Math.max(dWater / H, 0);
    this.waterMesh.position.set(toWorldX(g.waterY + dWater / 2), 2, 0);

    // E2: ボールが浸水中は青みにかすかに色を変える（見た目専用。シミュレーションには影響しない）
    const subF = Math.min(Math.max((b.y + BALL_R - g.waterY) / (2 * BALL_R), 0), 1);
    (this.ballMesh.material as THREE.MeshStandardMaterial).color.setRGB(1 - 0.3 * subF, 1 - 0.15 * subF, 1);

    // E2: 水面流れの矢じり（game.flowArrows の数に合わせて動的生成。流れがほぼゼロでは非表示）
    const probes = g.flowArrows;
    while (this.windGroup.children.length < probes.length) {
      this.windGroup.add(this.makeArrow());
    }
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i];
      const m = this.windGroup.children[i] as THREE.Group;
      const mag = Math.hypot(p.fx, p.fy);
      if (!playing || mag < 0.15) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      // sim の流れ (fx,fy) → 世界の方向：+simY=+worldX、+simX=-worldZ（yaw θ: cosθ=fy, sinθ=fx）
      m.position.set(toWorldX(p.y), 4, toWorldZ(p.x));
      m.rotation.y = Math.atan2(p.fx, p.fy);
      // 流速に応じた見かけの長さ（px/フレーム@60fps → ワールド長）
      const len = Math.min(Math.max(mag * 22, 12), 55);
      m.scale.set(len / (ARROW_SHAFT_LEN + ARROW_HEAD_LEN), 1, 1);
    }

    // 非プレイ中も時刻は最新に保つ（復帰時の dt スパイク防止）
    this.lastNow = now;

    this.renderer.render(this.scene, this.camera);
  }

  // E2: +X を向く基準長（ARROW_SHAFT_LEN+ARROW_HEAD_LEN）の矢じりグループを1つ作る
  private makeArrow(): THREE.Group {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(this.arrowShaftGeo, this.arrowMat);
    shaft.position.x = ARROW_SHAFT_LEN / 2; // グループ原点（矢じりの尾）を軸に scale.x で伸び縮みする
    const head = new THREE.Mesh(this.arrowHeadGeo, this.arrowMat);
    head.rotation.z = -Math.PI / 2; // コーンの +Y を +X（矢じりの先）へ向ける
    head.position.x = ARROW_SHAFT_LEN + ARROW_HEAD_LEN / 2;
    g.add(shaft, head);
    return g;
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
