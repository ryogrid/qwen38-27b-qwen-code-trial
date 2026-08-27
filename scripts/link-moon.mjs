// postinstall: node_modules/.bin にローカル moon をリンクする。
// npm exec / 手動コマンドから spawn("moon", ...) でツールチェーンを起動する場合、
// npm スクリプト（およびその子プロセス）から解決できる場所に置かなければならない。
// 本プロジェクトのコンパイラ本体は npm パッケージとしては配布されていないため、
// ローカルインストール（既定 %USERPROFILE%\.moon\bin）を node_modules/.bin にリンクする。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isWin = process.platform === "win32";
const binDir = path.join(process.cwd(), "node_modules", ".bin");
const linkName = isWin ? "moon.exe" : "moon";

function findMoon() {
  if (process.env.MOON_BIN) return process.env.MOON_BIN;
  const home = os.homedir();
  const candidates = isWin
    ? [path.join(home, ".moon", "bin", "moon.exe")]
    : [
        path.join(home, ".moon", "bin", "moon"),
        "/usr/local/bin/moon",
      ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function removeOldShims() {
  // 旧版が作った .cmd シムは spawn("moon") から解決できないので削除する。
  for (const name of ["moon.cmd", "moon.bat"]) {
    const p = path.join(binDir, name);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

function writeFallbackShim(target) {
  // シンボリックリンクが作れない環境向けのフォールバック（Windows の .cmd は
  // Node の spawn では解決できないため、ここでは POSIX のみ有効）。
  const p = path.join(binDir, linkName);
  fs.writeFileSync(p, `#!/bin/sh\nexec "${target}" "$@"\n`);
  fs.chmodSync(p, 0o755);
}

const target = findMoon();
if (!target) {
  console.warn(
    "[link-moon] WARNING: moon を見つけられませんでした（MOON_BIN / ~/.moon/bin を確認）。\n" +
      "            MoonBit ツールチェーンをインストールしてください: https://moonbitlang.com/installation.html",
  );
  process.exit(0); // インストール自体は通す（vite dev ではエラーログが出る）
}

fs.mkdirSync(binDir, { recursive: true });
removeOldShims();

const link = path.join(binDir, linkName);
try {
  fs.rmSync(link, { force: true });
  if (isWin) {
    // Windows: シンボリックリンク（開発者モード等で有効な場合）
    fs.symlinkSync(target, link);
  } else {
    fs.symlinkSync(target, link);
  }
  console.log(`[link-moon] リンクを作成しました: ${link} -> ${target}`);
} catch (e) {
  if (!isWin) {
    writeFallbackShim(target);
    console.log(`[link-moon] シムを作成しました（symlink 不可のため）: ${link} -> ${target}`);
  } else {
    // Windows で symlink が作れない場合の最終手段は .cmd。
    // spawn("moon") は解決できないが、シェル手動実行・npm の cmd シェル経由では使える。
    const shim = path.join(binDir, "moon.cmd");
    fs.writeFileSync(shim, `@ECHO off\r\n"${target}" %*\r\n`);
    console.warn(
      `[link-moon] WARNING: symlink を作成できませんでした（${e.code}）。\n` +
        "            代わりに .cmd シムを作成しました: moon.cmd\n" +
        "            Node から spawn(\"moon\") で使うには開発者モードを有効にしてください。",
    );
  }
}
