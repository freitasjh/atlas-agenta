import { spawnSync } from "node:child_process";
import { loadEnv } from "./env.ts";

/**
 * Executa SQL no banco local via psql. O SQL vai por stdin e os valores entram como variáveis
 * psql (`:'nome'`), que o psql escapa. Nada é concatenado como texto na query.
 * O erro do psql sai junto na mensagem, sem a URL do banco.
 */
export function sql(query: string, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(vars)) {
    args.push("-v", `${name}=${value}`);
  }
  args.push(loadEnv().dbUrl);
  const result = spawnSync("psql", args, { input: query, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`psql falhou: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim();
}
