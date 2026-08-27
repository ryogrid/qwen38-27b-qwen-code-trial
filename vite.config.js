import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MoonBit シミュレーションはブラウザ実行時にコンパイルする方式（predev/prebuild が
// scripts/copy-moonbit-assets.mjs で moonc-web.cjs と std/core アセットを
// public/mb-runtime/ へ配置し、Web Worker が buildPackage/linkCore を呼ぶ）。
export default defineConfig({
  plugins: [react()],
});
