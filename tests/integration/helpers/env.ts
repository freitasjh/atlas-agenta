// Variáveis de ambiente da suíte de integração (ADR-13). Chaves e URL do banco vêm do ambiente,
// nunca do código. A suíte só aceita stack local (127.0.0.1 ou localhost).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface IntegrationEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** Caminho do `.env` das Edge Functions (ignorado pelo git). Nenhum valor é impresso. */
export const FUNCTIONS_ENV_PATH = fileURLToPath(
  new URL("../../../supabase/functions/.env", import.meta.url),
);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável ${name} ausente. Exporte as credenciais do stack local antes de rodar a suíte.`,
    );
  }
  return value;
}

function assertLocal(label: string, rawUrl: string): void {
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error(`${label} não é uma URL válida.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`${label} não aponta para o stack local. A suíte recusa host remoto.`);
  }
}

let cached: IntegrationEnv | undefined;

/** Lê e valida o ambiente da suíte. Falha cedo, com mensagem pt-BR, se algo faltar. */
export function loadEnv(): IntegrationEnv {
  if (cached) return cached;
  const apiUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  const dbUrl = requiredEnv("SUPABASE_DB_URL");
  assertLocal("SUPABASE_URL", apiUrl);
  assertLocal("SUPABASE_DB_URL", dbUrl);
  cached = {
    apiUrl,
    anonKey: requiredEnv("SUPABASE_ANON_KEY"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    dbUrl,
  };
  return cached;
}

/**
 * Lê o `.env` das Edge Functions como mapa `CHAVE=valor`. Linhas vazias e comentários saem.
 * O arquivo é ignorado pelo git e nunca deve ser ecoado: os valores são segredos locais.
 */
export function readFunctionsEnv(): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(FUNCTIONS_ENV_PATH, "utf8");
  } catch {
    throw new Error(
      "Arquivo supabase/functions/.env ausente. Copie o .env.example e preencha os segredos locais.",
    );
  }

  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}
