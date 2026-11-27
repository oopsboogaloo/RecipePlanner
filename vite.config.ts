import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  build: { outDir: "../../dist", emptyOutDir: true },
  test: { root: ".", include: ["test/**/*.test.ts"] },
} as any);
