import { defineConfig } from "vitest/config";

/**
 * Config do Vitest para a suíte de integração de segurança (ADR-10). Roda contra o stack local
 * (`supabase start` + `supabase functions serve`). Separada de `vitest.config.ts`, que continua
 * só com os testes unitários de `src/**`. Execução sequencial: os casos mexem no mesmo banco.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
