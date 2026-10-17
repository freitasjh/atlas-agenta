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

/** Resultado da leitura das envs: os valores + se a configuração é válida. */
interface EnvReadResult {
  /** Envs validadas (ou cruas, em modo degradado, quando inválidas). */
  env: Env;
  /** `true` só quando AMBAS as envs passam no schema zod. */
  isConfigured: boolean;
}

/**
 * Lê e valida as envs. Em caso de falha NÃO lança exceção que derrube a SPA:
 * loga um aviso claro em pt-BR no console e devolve os valores crus (strings
 * vazias quando ausentes), para que as rotas-casca continuem navegáveis mesmo
 * sem `.env`. Nenhum dado sensível é logado (a anon key é pública).
 *
 * O `safeParse` é chamado UMA única vez; seu `success` é a fonte de verdade
 * tanto para o `console.warn` quanto para o sinal `isSupabaseConfigured`
 * exportado abaixo — garantindo coerência (o sinal é `false` exatamente quando
 * o aviso é emitido).
 */
function readEnv(): EnvReadResult {
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
    return { env: raw, isConfigured: false };
  }

  return { env: result.data, isConfigured: true };
}

const result = readEnv();

/** Envs validadas (ou cruas, em modo degradado, quando inválidas). */
export const env: Env = result.env;

/**
 * Sinal explícito e tipado de configuração do Supabase: `true` só quando AMBAS
 * `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` passam na validação zod (URL
 * válida + não-vazias). Fonte única de verdade para "o Supabase está
 * configurado?" — qualquer consumidor que rode no load deve checar este sinal
 * antes de tocar o client real.
 */
export const isSupabaseConfigured: boolean = result.isConfigured;
