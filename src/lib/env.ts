import { z } from "zod";

/**
 * Validação das variáveis de ambiente do frontend na borda (zod).
 *
 * Só chaves `VITE_*` chegam ao cliente — todas são embutidas no bundle público
 * pelo Vite. Por isso aqui só pode existir segredo PÚBLICO (a anon key do
 * Supabase). Nunca adicionar service role key, chave Asaas, token Evolution ou
 * qualquer segredo privilegiado como `VITE_*`: eles ficariam expostos no
 * navegador. Esses segredos vivem só em Edge Functions / env do Supabase.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .trim()
    .min(1, "VITE_SUPABASE_URL não pode ser vazia.")
    .url("VITE_SUPABASE_URL deve ser uma URL válida."),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .trim()
    .min(1, "VITE_SUPABASE_ANON_KEY não pode ser vazia."),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Lê e valida as envs. Em caso de falha NÃO lança exceção que derrube a SPA:
 * loga um aviso claro em pt-BR no console e devolve os valores crus (strings
 * vazias quando ausentes), para que as rotas-casca continuem navegáveis mesmo
 * sem `.env`. Nenhum dado sensível é logado (a anon key é pública).
 */
function readEnv(): Env {
  const raw = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL ?? "",
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  };

  const result = envSchema.safeParse(raw);

  if (!result.success) {
    console.warn(
      "Configuração ausente ou inválida: defina VITE_SUPABASE_URL e " +
        "VITE_SUPABASE_ANON_KEY no arquivo .env — veja .env.example. " +
        "A aplicação segue navegável, mas chamadas ao Supabase não funcionarão " +
        "até a configuração ser corrigida.",
    );
    return raw;
  }

  return result.data;
}

/** Envs validadas (ou cruas, em modo degradado, quando inválidas). */
export const env: Env = readEnv();
