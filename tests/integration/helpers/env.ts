// Variáveis de ambiente da suíte de integração (ADR-10). Chaves e URL do banco vêm do ambiente,
// nunca do código. A suíte só aceita stack local (127.0.0.1 ou localhost).

export interface IntegrationEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

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
