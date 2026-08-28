// ===== ブラウザ内 MoonBit コンパイラ（Web Worker）=====
// メインスレッドから sim.mbt ソースとアセットの baseUrl を受け取り、
// moonc-web.cjs（CJS バンドル）を eval して buildPackage + linkCore で
// wasm-gc モジュールを生成し、バイト列を返す。ツールチェーン不要で完結する。
//
// アセットは scripts/copy-moonbit-assets.mjs が public/mb-runtime/ へ配置済み:
//   {baseUrl}moonc-web.cjs | manifest.json | fs/wasm-gc/std/** | fs/wasm-gc/cores/{コア3点}

type CompileRequest = { source: string; baseUrl: string };
type CompileResponse =
  | { ok: true; wasmBytes: Uint8Array }
  | { ok: false; error: string };

// moonc-web.d.ts と同一構造（型のみ。バンドルは実行時に eval で取得するため）
type Target = "wasm-gc" | "wasm" | "js" | "native" | "llvm";
interface BuildPackageParams {
  mbtFiles: [string, string][];
  miFiles: [string, Uint8Array][];
  indirectImportMiFiles: [string, Uint8Array][];
  stdMiFiles: [string, Uint8Array][];
  target: Target;
  pkg: string;
  pkgSources: string[];
  isMain: boolean;
  errorFormat: "human" | "json";
  enableValueTracing: boolean;
  noOpt: boolean;
}
interface LinkCoreParams {
  coreFiles: Uint8Array[];
  main: string;
  pkgSources: string[];
  target: Target;
  useJsBuiltinString?: boolean;
  importedStringConstants?: string;
  exportedFunctions: string[];
  outputFormat: "wasm" | "wat";
  testMode: boolean;
  debug: boolean;
  noOpt: boolean;
  sourceMap: boolean;
  sources: { [key: string]: string };
  stopOnMain: boolean;
}
interface MooncApi {
  buildPackage(
    p: BuildPackageParams,
  ): { core?: Uint8Array; mi?: Uint8Array; diagnostics: string[] };
  linkCore(p: LinkCoreParams): { result: Uint8Array };
}

// Worker グローバル（self は DOM 型では Window とみなされるため最小接口にキャスト）
type WorkerScope = {
  onmessage: ((e: MessageEvent<CompileRequest>) => void) | null;
  postMessage(msg: CompileResponse, transfer?: Transferable[]): void;
};
const scope = self as unknown as WorkerScope;

// ---- CJS シム（moonc-web.cjs の module.exports 代入を回収するための下準備）----
type CjsGlobal = Record<string, unknown> & {
  process: { versions: Record<string, string>; platform: string; cwd(): string; exit(): void; env: Record<string, string> };
  module: { exports: unknown };
  exports: unknown;
  require: (id: string) => unknown;
};
const g = scope as unknown as CjsGlobal;
g.process = { versions: {}, platform: "browser", cwd: () => "/", exit: () => {}, env: {} };
g.module = { exports: {} };
g.exports = g.module.exports;
g.require = (id) => {
  if (id === "constants") return {};
  throw new Error(`[simCompiler] ワーカー内で予期しない require: ${id}`);
};

// linkCore に必要なコアファイル（検証済み最小サブセット。順不同で問題ないが既定順を維持）
const CORE_NAMES = ["000_abort_abort.core", "001_bundle_core.core", "002_core_core.core"];

// sim/moon.pkg の wasm exports と一致させること（_start は自動追加される）
export const EXPORTED_FUNCTIONS = [
  "step",
  "seed",
  "prepare_serve",
  "center_paddles",
  "reset_scores",
  "ball_x",
  "ball_y",
  "player_y",
  "ai_y",
  "vx",
  "vy",
  "spin",
  "water_x",
  "flow_sample_x",
  "flow_sample_y",
  "p_score",
  "a_score",
];

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`アセット取得失敗 (${r.status}): ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function compile(source: string, baseUrl: string): Promise<Uint8Array> {
  // 1) コンパイラ本体を CJS シム上で eval（Node 実験・tutuca と同一の手順）
  const compilerText = await (await fetch(`${baseUrl}moonc-web.cjs`)).text();
  if (!compilerText) throw new Error("moonc-web.cjs が空でした");
  (0, eval)(compilerText); // グローバルスコープ実行 → g.module.exports に API が載る
  const moonc = g.module.exports as unknown as MooncApi;

  // 2) manifest と標準ライブラリ .mi を取得（バージョン一致が必須なペア）
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const manifestUrlResponse = await fetch(`${base}manifest.json`);
  if (!manifestUrlResponse.ok) throw new Error("manifest.json の取得に失敗しました");
  const manifest = (await manifestUrlResponse.json()) as {
    targets: Record<string, { std: string[] }>;
  };
  const stdPaths = manifest.targets["wasm-gc"]?.std ?? [];
  if (stdPaths.length === 0) throw new Error("manifest に wasm-gc の std 一覧がありません");
  const [stdMiFiles, coreFiles] = await Promise.all([
    Promise.all(
      stdPaths.map(async (p): Promise<[string, Uint8Array]> => {
        return [p, await fetchBytes(`${base}fs/wasm-gc/${p}`)];
      }),
    ),
    Promise.all(CORE_NAMES.map((n) => fetchBytes(`${base}fs/wasm-gc/cores/${n}`))),
  ]);

  // 3) パッケージコンパイル（_boot.mbt の main は空。エクスポートは linkCore が指定）
  const built = moonc.buildPackage({
    mbtFiles: [["sim.mbt", source], ["_boot.mbt", "fn main {\n\n}\n"]],
    miFiles: [],
    indirectImportMiFiles: [],
    stdMiFiles: stdMiFiles,
    target: "wasm-gc",
    pkg: "internal/sim",
    pkgSources: ["internal/sim:."],
    isMain: true,
    errorFormat: "human",
    enableValueTracing: false,
    noOpt: false,
  });
  if (built.diagnostics.length > 0) {
    throw new Error(`MoonBit コンパイルエラー:\n${built.diagnostics.join("\n")}`);
  }
  if (!built.core) throw new Error("buildPackage が core を返却しませんでした");

  // 4) リンクして wasm バイト列を生成（import 0 / export = EXPORTED_FUNCTIONS + _start）
  const linked = moonc.linkCore({
    coreFiles: [...coreFiles, built.core],
    main: "internal/sim",
    pkgSources: ["internal/sim:."],
    target: "wasm-gc",
    useJsBuiltinString: true,
    importedStringConstants: "_",
    exportedFunctions: EXPORTED_FUNCTIONS,
    outputFormat: "wasm",
    testMode: false,
    debug: false,
    noOpt: false,
    sourceMap: false,
    sources: {},
    stopOnMain: false,
  });
  return linked.result;
}

scope.onmessage = (e) => {
  const { source, baseUrl } = e.data;
  compile(source, baseUrl)
    .then((wasmBytes) => {
      scope.postMessage({ ok: true, wasmBytes }, [wasmBytes.buffer]);
    })
    .catch((err) => {
      // メインスレッド側でコンソールにも出るよう詳細を添えて返す
      const error = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error("[simCompiler] コンパイルに失敗しました:", err);
      scope.postMessage({ ok: false, error });
    });
};
