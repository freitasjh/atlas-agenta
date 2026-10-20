import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config do Vitest para os testes unitários puros (ex.: o gerador de slots,
 * ADR-05). Reusa o alias `@` do Vite; ambiente `node` (sem DOM) por serem
 * funções puras. Rodar em single-run via `npm run test` (script `vitest run`).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
