// ===== three.js シーン構築と毎フレーム更新（3D 描画層）=====
import * as THREE from "three";
import { W, H, PADDLE_W, PADDLE_H, BALL_R, PX, AX, BASE_BALL_SPEED, FLOW_N, FLOW_M } from "../game/constants";

// シーンが読むシムの最小構造（wasmSim の WasmGame が適合する）
interface SimView {
  player: { y: number };
  ai: { y: number };
  ball: { x: number; y: number; vx: number; vy: number; spin: number };
  flowArrows: { x: number; y: number; fx: number; fy: number }[]; // コート全面の水面格子・セル単位のプロブ点（各セル中心）。描画のみ
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

// ===== 水流力矢印（表示のみ）。sim/sim.mbt の update_ball 水結合のミラー——片側を変えたら両方変えること =====
const WF_DRAG_REL_K = 0.011; // = DRAG_REL_K_D (sim/sim.mbt)
const WF_SPEED_SCALE_MAX = 2.5; // = DRAG_SPEED_SCALE_MAX_D (sim/sim.mbt)
const WF_ABS_RATE = 0.0006; // = DRAG_ABS_RATE_D (sim/sim.mbt)
const WF_STILL_EPS = 0.1; // = FLOW_STILL_EPS_D (sim/sim.mbt)。この流速未満の軸には力を加えない
const FORCE_ARROW_Y_OFFSET = 30; // ボール中心からの高さ（ワールド単位）
const FA_HEAD_LEN = 7; // 矢じりの長さ（下の幾何構築と一致させること）
const FORCE_ARROW_MIN_DV = 0.01; // Δv(px/フレーム²) がこれ未満は非表示（≈静水の減衰分のみ）
const FORCE_ARROW_MIN_LEN = 16;
const FORCE_ARROW_MAX_LEN = 48;

/** spin → RPM 表示値。+ は右回転（上から見て時計回り）、− は左回転。表示専用 */
export function spinToRpm(spin: number): number {
  // update() は +spin を上から見て時計回り（マグヌス方向）に見える回転にするため、符号はそのまま換算する
  return spin * SPIN_VIS_RATE * (3600 / (2 * Math.PI));
}

// sim.mbt の bilinear_flow_at と同一計算。probes はセル中心配置・x メジャー（index = j*FLOW_N + i）
function sampleFlowAt(
  probes: { fx: number; fy: number }[],
  sx: number,
  sy: number,
): [number, number] {
  if (sx < 0 || sx > W || sy < 0 || sy > H) return [0, 0]; // キャンバス外は流れなし
  const u = Math.min(Math.max((sy / H) * FLOW_N - 0.5, 0), FLOW_N - 1); // y → 行 i
  const v = Math.min(Math.max((sx / W) * FLOW_M - 0.5, 0), FLOW_M - 1); // x → 列 j
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const i1 = Math.min(i0 + 1, FLOW_N - 1); // 端セルでは隣を自分自身へ（fu=0 で安全）
  const j1 = Math.min(j0 + 1, FLOW_M - 1);
  const fu = u - i0;
  const fv = v - j0;
  const at = (j: number, i: number): [number, number] => {
    const p = probes[j * FLOW_N + i];
    return [p.fx, p.fy];
  };
  const [x00, y00] = at(j0, i0);
  const [x10, y10] = at(j0, i1);
  const [x01, y01] = at(j1, i0);
  const [x11, y11] = at(j1, i1);
  const topX = x00 + (x10 - x00) * fu;
  const botX = x01 + (x11 - x01) * fu;
  const topY = y00 + (y10 - y00) * fu;
  const botY = y01 + (y11 - y01) * fu;
  return [topX + (botX - topX) * fv, topY + (botY - topY) * fv];
}

// パドルメッシュの高さ（装飾用。シムの PADDLE_W/H は X/Z 方向の寸法に使う）
const PADDLE_MESH_H = 18;

// E2: 水面流れグリッドタイル（方向=色、濃淡=強さ。テーブル上のセル単位 InstancedMesh・装飾のみ）
const FLOW_TILE_COVER = 0.75; // タイル辺の長さを1セル幅に対する比率（すき間でグリッドの目地を表示）
const FLOW_TILE_THICK = 1; // タイルの厚み（ワールド単位）
const FLOW_TILE_Y = 4.6; // タイル中心の高さ。スラブ上面(y=4)よりわずかに浮かせ、水面に埋もれなくする
const FLOW_COLOR_REF = 4; // 「満色」に対応する流速(px/フレーム)。以上はここでクランプ
const FLOW_STILL_EPS = 0.05; // この流速未満は静水とみなしグリッド基調色を使う（±微動の色ノイズ防止）
// 方向→色のマッピング：+fy=画面右=赤系、-fy=左=青系（どちらも明るい色）。強さで濃い(高彩度)⇔薄い(淡い)を連続的に lerp
const FLOW_PALE_R = new THREE.Color(0xfde8e4); // 右・弱い（淡い赤）
const FLOW_FULL_R = new THREE.Color(0xff3524); // 右・強い（鮮やかな赤）
const FLOW_PALE_B = new THREE.Color(0xdfeaff); // 左・弱い（淡い青）
const FLOW_FULL_B = new THREE.Color(0x2b6bff); // 左・強い（鮮やかな青）
const FLOW_STILL_C = new THREE.Color(0xc9d4e2); // 静水・グリッド基調色（明るい無彩色）

export class PongScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ballMesh: THREE.Mesh;
  private readonly ballSeamMat: THREE.MeshStandardMaterial; // スピンを可視化するボール表面のマーカー素材
  private readonly playerMesh: THREE.Mesh;
  private readonly aiMesh: THREE.Mesh;
  private flowTileInst: THREE.InstancedMesh | null = null; // E2: 水面流れグリッドタイル（全セル分・インスタンス化。テーブル上・装飾のみ）
  private readonly tileMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // 無照明+白ベース：インスタンス色がそのまま乗算され常に明るい
  private readonly tmpColor = new THREE.Color(); // タイル色の lerp に使う作業用色（毎フレームの確保を避ける）
  private readonly waterMesh: THREE.Mesh; // E2: コート全面ウォーターのスラブ（半透明。テーブル上・装飾のみ）
  private readonly forceArrow!: THREE.Group; // ボール上の水流力矢印（表示のみ。ローカル +Z = 力の向き）
  private readonly faShaft!: THREE.Mesh; // 軸（単位高さの円柱を毎フレーム z スケールで伸縮）
  private readonly faHead!: THREE.Mesh; // 矢じり（+Z 先頭）
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
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35 }),
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

    // E2: コート全面ウォーターのスラブ（テーブル全面 sim x ∈ [0, W] × 全高を覆う半透明板。静的配置）
    this.waterMesh = new THREE.Mesh(
      new THREE.BoxGeometry(H, 4, W),
      new THREE.MeshStandardMaterial({ color: 0x3f8fd6, transparent: true, opacity: 0.3, roughness: 0.25 }),
    );
    this.waterMesh.position.set(0, 2, 0);
    this.scene.add(this.waterMesh);

    // ボール上の水流力矢印（表示のみ）。ローカル +Z が力の向き、長さは Δv の強さに比例
    const faMat = new THREE.MeshBasicMaterial({ color: 0x8ff2ff });
    this.forceArrow = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(1.4, 1.4, 1, 8);
    shaftGeo.rotateX(Math.PI / 2); // 軸を +Z 方向へ（中心原点・単位高さ → z スケールで伸縮）
    this.faShaft = new THREE.Mesh(shaftGeo, faMat);
    this.forceArrow.add(this.faShaft);
    const headGeo = new THREE.ConeGeometry(4.5, FA_HEAD_LEN, 12);
    headGeo.rotateX(Math.PI / 2); // 先頭を +Z 方向へ（中心原点）
    this.faHead = new THREE.Mesh(headGeo, faMat);
    this.forceArrow.add(this.faHead);
    this.forceArrow.visible = false;
    this.scene.add(this.forceArrow);

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

      // A: スピンを回転演出として表現（テーブル法線軸回り。シームで視認）。- 符号は +spin を上から見て時計回り（マグヌス効果の曲がり方向と整合）にするため
      this.ballMesh.rotation.y -= b.spin * SPIN_VIS_RATE * dtF;
    } else {
      this.hopPhase = 0;
    }
    this.prevInFlight = inFlight && playing;

    this.ballMesh.position.set(toWorldX(b.y), BALL_R + bounceY, toWorldZ(b.x));

    // E2: 水面流れグリッドタイル（方向=色、濃淡=強さ。位置は静的なので毎フレーム色のみ更新）
    const probes = g.flowArrows;
    this.ensureFlowTiles(probes); // 行列は一度だけ確保（プロブレイアウトは wasmSim の構築時に固定）
    const tiles = this.flowTileInst;
    if (tiles !== null) {
      for (let i = 0; i < probes.length; i++) {
        const s = probes[i].fy; // +simY=+worldX=画面右：正→赤、負→青（fx は奥行き成分で現在常にゼロ）
        let c: THREE.Color;
        if (Math.abs(s) < FLOW_STILL_EPS) {
          c = FLOW_STILL_C;
        } else {
          const t = Math.min(Math.abs(s) / FLOW_COLOR_REF, 1); // 強=濃い(高彩度)、弱=薄い：|流速|で連続的に lerp
          if (s > 0) this.tmpColor.lerpColors(FLOW_PALE_R, FLOW_FULL_R, t);
          else this.tmpColor.lerpColors(FLOW_PALE_B, FLOW_FULL_B, t);
          c = this.tmpColor;
        }
        tiles.setColorAt(i, c);
      }
      if (tiles.instanceColor !== null) {
        tiles.instanceColor.needsUpdate = true;
      }
    }

    // ボール上の水流力矢印（表示のみ）。sim.mbt の水結合 Δv をミラーして向き・強さを示す。物理には影響しない
    let dvx = 0;
    let dvy = 0;
    if (playing && inFlight && b.x >= 0 && b.x <= W) { // キャンバス外の結合ガードは sim.mbt の update_ball と同一
      const [flx, fly] = sampleFlowAt(probes, b.x, b.y);
      const sp0 = Math.hypot(b.vx, b.vy);
      const scaleD = Math.min(Math.max(sp0 / BASE_BALL_SPEED, 0), WF_SPEED_SCALE_MAX);
      const relK = Math.min(Math.max(WF_DRAG_REL_K * dtF * scaleD, 0), 0.95);
      const damp = 1 / (1 + WF_ABS_RATE * dtF);
      if (Math.abs(flx) > WF_STILL_EPS) dvx = (b.vx + relK * (flx - b.vx)) * damp - b.vx;
      if (Math.abs(fly) > WF_STILL_EPS) dvy = (b.vy + relK * (fly - b.vy)) * damp - b.vy;
    }
    const fmag = Math.hypot(dvx, dvy);
    if (fmag > FORCE_ARROW_MIN_DV) {
      const len = Math.min(Math.max(fmag * 160, FORCE_ARROW_MIN_LEN), FORCE_ARROW_MAX_LEN);
      this.faShaft.scale.z = Math.max(len - FA_HEAD_LEN, 1); // 単位高さの円柱 → z スケールで軸長に
      this.faShaft.position.z = (len - FA_HEAD_LEN) / 2;
      this.faHead.position.z = len - FA_HEAD_LEN / 2;
      const fa = this.forceArrow;
      fa.rotation.y = Math.atan2(dvy, -dvx); // シム y→ワールド +X、シム x→−Z（toWorldX/Z と同一）
      fa.position.set(toWorldX(b.y), BALL_R + bounceY + FORCE_ARROW_Y_OFFSET, toWorldZ(b.x));
      fa.visible = true;
    } else {
      this.forceArrow.visible = false;
    }

    // 非プレイ中も時刻は最新に保つ（復帰時の dt スパイク防止）
    this.lastNow = now;

    this.renderer.render(this.scene, this.camera);
  }

  // E2: 水面流れグリッドタイル（単一の InstancedMesh・1セル1タイル。位置は不変のため行列と初期色をここで一度だけ設定）
  private ensureFlowTiles(probes: { x: number; y: number }[]): void {
    if (this.flowTileInst !== null || probes.length === 0) return;
    const sizeX = ((H / FLOW_N) * FLOW_TILE_COVER); // タイル幅（画面 X=シムの y セル × 比率）
    const sizeZ = ((W / FLOW_M) * FLOW_TILE_COVER); // 奥行き Z=シムの x セル × 比率
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(sizeX, FLOW_TILE_THICK, sizeZ), this.tileMat, probes.length);
    const obj = new THREE.Object3D();
    for (let i = 0; i < probes.length; i++) {
      obj.position.set(toWorldX(probes[i].y), FLOW_TILE_Y, toWorldZ(probes[i].x));
      obj.updateMatrix();
      inst.setMatrixAt(i, obj.matrix);
      inst.setColorAt(i, FLOW_STILL_C); // 初期値=静水色（同時に instanceColor バッファも作成される）
    }
    if (inst.instanceColor !== null) {
      inst.instanceColor.setUsage(THREE.DynamicDrawUsage); // 色は毎フレーム更新する
    }
    inst.frustumCulled = false; // コート全面に散在するためバウンディングによる一括カリングを無効化
    this.flowTileInst = inst;
    this.scene.add(inst);
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
    // E2: インスタンスバッファは geometry 配下ではないため明示的に解放（リマウント毎に溜めない）
    this.flowTileInst?.instanceMatrix.dispose();
    this.flowTileInst?.instanceColor?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
