// Pré-checagem do stack local antes da suíte de integração (ADR-10).
//
// Pré-requisitos (ver também a Decisão da ADR-10):
//   1. `supabase start` ativo (Postgres, Auth, PostgREST, Docker);
//   2. `supabase functions serve` ativo (change-password e admin-subscription);
//   3. variáveis no ambiente: SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
//      (e opcionalmente SUPABASE_URL, padrão http://127.0.0.1:54321). Os valores saem de
//      `supabase status -o env`; nunca são escritos no repositório.
//
// Se alguma Edge Function não estiver servida, o gateway responde 503 e a suíte para aqui com
// a instrução, em vez de falhar caso a caso.
import { loadEnv } from "./helpers/env.ts";

const FUNCTIONS_REQUIRED = ["change-password", "admin-subscription"] as const;

export default async function setup(): Promise<void> {
  const env = loadEnv();

  const health = await fetch(`${env.apiUrl}/auth/v1/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      "Stack local inacessível em /auth/v1/health. Rode `supabase start` antes da suíte.",
    );
  }

  for (const name of FUNCTIONS_REQUIRED) {
    const probe = await fetch(`${env.apiUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: { apikey: env.anonKey, "Content-Type": "application/json" },
      body: "{}",
    });
    if (probe.status === 503 || probe.status === 404) {
      throw new Error(
        `Edge Function ${name} não está servida. Rode \`supabase functions serve\` antes da suíte.`,
      );
    }
  }
}
