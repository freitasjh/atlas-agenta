import { spawnSync } from "node:child_process";
import { loadEnv } from "./env.ts";

/**
 * Converte a URL do banco nas variáveis PG* que o libpq lê do ambiente. Assim a URL, que contém
 * a senha do banco, não entra em argv (visível em `ps` para outros usuários do host).
 */
function pgEnvFromUrl(dbUrl: string): Record<string, string> {
  const url = new URL(dbUrl);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, "") || "postgres",
  };
  return env;
}

/**
 * Valores de variável psql vão por `\set` no stdin, não por `-v` no argv. Aspas simples e barra
 * invertida são recusadas: os valores usados pela suíte (e-mail e senha de teste) não as contêm.
 */
function setCommands(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => {
      if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Nome de variável inválido: ${name}`);
      if (/['\\\r\n]/.test(value)) throw new Error(`Valor da variável ${name} com caractere não suportado.`);
      return `\\set ${name} '${value}'\n`;
    })
    .join("");
}

/**
 * Executa SQL no banco local via psql. O SQL vai por stdin e os valores entram como variáveis
 * psql (`:'nome'`), que o psql escapa. Nada é concatenado como texto na query.
 * O erro do psql sai junto na mensagem, sem a URL do banco.
 */
export function sql(query: string, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  const { dbUrl } = loadEnv();
  const result = spawnSync("psql", args, {
    input: `${setCommands(vars)}${query}`,
    encoding: "utf8",
    env: { ...process.env, ...pgEnvFromUrl(dbUrl) },
  });
  if (result.status !== 0) {
    throw new Error(`psql falhou: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim();
}
