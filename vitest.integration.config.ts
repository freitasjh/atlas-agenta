import { defineConfig } from "vitest/config";

/**
 * Config do Vitest para a suíte de integração de segurança (ADR-13). Roda contra o stack local
 * (`supabase start`, banco de `supabase db reset`). Separada de `vitest.config.ts`, que continua
 * só com os testes unitários de `src/**`. Execução sequencial: os casos mexem no mesmo banco e o
 * global setup sobe/encerra o `supabase functions serve`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    // 300s: pior caso do restart do `supabase start` no global setup (reset + subir funções).
    hookTimeout: 300_000,
  },
});
